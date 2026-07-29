/** Platform emergency-disable admission and active-action verification (G5.8). */

import { Command } from "@langchain/langgraph";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { build_tenant_execution_context } from "../../apps/ai/server/auth/tenant-execution-context";
import { create_ai_run_repository } from "../../apps/ai/server/repositories/ai-run-repository";
import {
  AIDisabledError,
  create_ai_gateway,
  type AIGatewayDeps,
  type CompiledRunPolicy,
  type GatewayPolicySource,
} from "../../apps/ai/server/services/ai-gateway/ai-gateway";
import { create_run_job_queue } from "../../apps/ai/server/services/ai-gateway/run-job-queue";
import { gate } from "../../packages/ai-orchestration/src/nodes/gate";
import type { EffectiveAIPolicy } from "../../packages/shared-types/src/ai/policy";
import { TENANT_ROLE_PERMISSIONS, type RequestPrincipal } from "../../packages/shared-types/src/auth";
import type { TenantExecutionContext } from "../../packages/shared-types/src/tenant";
import {
  FakePolicyEngine,
  goto_targets,
  make_fake_runtime,
  make_loop_state,
  make_pending_tool_action,
  make_tool_decision,
} from "../orchestration/helpers/fake_runtime";

const TENANT = "507f1f77bcf86cd7994390a1";
const PROFILE = "507f1f77bcf86cd79943a001";
const T0 = new Date("2026-07-15T00:00:00.000Z");

let repl: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
let emergency_disabled = false;

const EFFECTIVE_POLICY: EffectiveAIPolicy = Object.freeze({
  tenant_id: TENANT,
  version: 1,
  hash: "a".repeat(64),
  enabled: true,
  provider_models: { gemini: ["gemini-2.5-flash"] },
  allowed_tools: ["knowledge.search"],
  monthly_request_limit: 10_000n,
  monthly_token_limit: 10_000_000n,
  monthly_cost_limit_microusd: 100_000_000n,
  per_user_monthly_request_limit: 1_000n,
  per_user_monthly_token_limit: 1_000_000n,
  per_user_monthly_cost_limit_microusd: 10_000_000n,
  per_run_token_limit: 100_000n,
  per_run_cost_limit_microusd: 1_000_000n,
  max_concurrent_runs: 100,
  default_locale: "en-US",
  max_iterations: 8,
  approval_rules: {},
});

/** Policy source reading the injected emergency switch on every admission. */
class EmergencyPolicySource implements GatewayPolicySource {
  async compile(): Promise<CompiledRunPolicy> {
    return {
      enabled: !emergency_disabled,
      disabled_reason: emergency_disabled
        ? "AI is disabled by the platform emergency control."
        : undefined,
      effective_policy: { ...EFFECTIVE_POLICY, enabled: !emergency_disabled },
      pins: {
        policyVersion: 1,
        policySnapshot: { emergency_disabled },
        deploymentId: "507f1f77bcf86cd79943d001",
        agentDefinitionVersion: "v1",
        orchestratorVersion: "2026.07.0",
        promptVersionId: "507f1f77bcf86cd79943f001",
        inputSchemaVersion: "1",
        outputSchemaVersion: "1",
        provider: "gemini",
        model: "gemini-2.5-flash",
      },
      budget_estimate: { tokens: 100 },
      request_budget: {
        max_iterations: 8,
        max_total_tokens: 10_000,
        max_cost_microusd: 100_000,
      },
    };
  }
}

/** Build a verified synthetic manager context. */
function tenant_context(): TenantExecutionContext {
  const principal: RequestPrincipal = {
    auth_provider: "clerk",
    provider_user_id: "user_synthetic_emergency",
    internal_user_id: PROFILE,
    active_tenant_id: TENANT,
    platform_role: null,
    tenant_role: "manager",
    permissions: TENANT_ROLE_PERMISSIONS.manager,
    membership_status: "active",
  };
  return build_tenant_execution_context(principal, null, {
    clerk_organization_id: "org_synthetic_emergency",
    membership_id: "mem_synthetic_emergency",
  });
}

/** Build one content-free synthetic run input. */
function run_input(index: number) {
  return {
    schema_version: "1",
    thread_id: "507f1f77bcf86cd79943e001",
    agent_key: "formulation",
    message: `Synthetic emergency verification ${index}`,
    attachment_source_ids: [],
    response_preferences: { language: "en", detail: "standard" },
    idempotency_key: `emergency-${index.toString().padStart(4, "0")}`,
  };
}

/** Build real gateway persistence with injected policy/budget seams. */
function gateway_deps(reservations: string[]): AIGatewayDeps {
  let correlation = 0;
  return {
    client,
    runs: create_ai_run_repository(db),
    jobs: create_run_job_queue(db),
    policy: new EmergencyPolicySource(),
    context: {
      async assemble() {
        return { pack_hash: "b".repeat(64) };
      },
    },
    budget: {
      async reserve(_tenant, _policy, _estimate, idempotency_key) {
        reservations.push(idempotency_key);
        return { reservation_id: "507f1f77bcf86cd79943b001" };
      },
    },
    rollout: { default_executor: "agentic" },
    now: () => T0,
    correlation_id: () => `corr-emergency-${(correlation += 1)}`,
    events_url: (run_id) => `/api/ai/runs/${run_id}/events`,
  };
}

beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = new MongoClient(repl.getUri());
  await client.connect();
  db = client.db("emergency_disable_resilience");
  await db.collection("ai_runs").createIndex({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
  await db.collection("ai_runs").createIndex({ correlationId: 1 }, { unique: true });
  await db.collection("ai_run_jobs").createIndex(
    { runId: 1, command: 1, idempotencyKey: 1 },
    { unique: true },
  );
}, 60_000);

afterAll(async () => {
  await client.close();
  await repl.stop();
});

beforeEach(async () => {
  emergency_disabled = false;
  await Promise.all([
    db.collection("ai_runs").deleteMany({}),
    db.collection("ai_run_jobs").deleteMany({}),
  ]);
});

describe("platform emergency disable", () => {
  it("prevents new reservations during a 50-request burst", async () => {
    const reservations: string[] = [];
    const gateway = create_ai_gateway(gateway_deps(reservations));
    await gateway.create_run(tenant_context(), run_input(0));
    emergency_disabled = true;

    const attempts = await Promise.allSettled(
      Array.from({ length: 50 }, (_unused, index) =>
        gateway.create_run(tenant_context(), run_input(index + 1)),
      ),
    );

    expect(attempts.every((attempt) => attempt.status === "rejected")).toBe(true);
    expect(
      attempts.every(
        (attempt) =>
          attempt.status === "rejected" && attempt.reason instanceof AIDisabledError,
      ),
    ).toBe(true);
    expect(reservations).toEqual(["emergency-0000"]);
    expect(await db.collection("ai_runs").countDocuments({})).toBe(1);
    expect(await db.collection("ai_run_jobs").countDocuments({})).toBe(1);
  });

  it("stops an active run at its next action gate without executing the tool", async () => {
    emergency_disabled = true;
    const action = make_pending_tool_action("knowledge.search", { query: "synthetic" });
    const policy = new FakePolicyEngine(() => ({
      kind: "denied",
      reason_code: "POLICY_EMERGENCY_DISABLED",
      safe_reason: "AI is disabled by the platform emergency control.",
      fatal: true,
    }));
    const { runtime, tools } = make_fake_runtime({ policy });
    const command = (await gate(
      make_loop_state({
        iteration: 1,
        pending_action: action,
        decision_log: [make_tool_decision("knowledge.search", { query: "synthetic" }, 1)],
      }),
      runtime,
    )) as Command;

    expect(goto_targets(command)).toEqual(["fail"]);
    expect((command.update as { error?: { code?: string } }).error?.code).toBe(
      "POLICY_EMERGENCY_DISABLED",
    );
    expect(tools.executions).toHaveLength(0);
  });
});
