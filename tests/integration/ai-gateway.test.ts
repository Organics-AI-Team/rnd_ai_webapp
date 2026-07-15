/**
 * G4.9e (part 2) — ai-gateway create_run.
 *
 * Proves the gateway compiles/pins policy, assembles/pins the context pack,
 * reserves budget, and creates the AIRun + enqueues exactly one worker job in a
 * single transaction — idempotently on the run's key (a retry returns the same
 * run, re-compiles/re-reserves/re-enqueues nothing) and fail-closed when AI is
 * disabled. Exercised against a real in-memory Mongo replica set (the create is
 * transactional).
 */

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { build_tenant_execution_context } from "../../apps/ai/server/auth/tenant-execution-context";
import { TENANT_ROLE_PERMISSIONS } from "../../packages/shared-types/src/auth";
import type { RequestPrincipal } from "../../packages/shared-types/src/auth";
import type { TenantExecutionContext } from "../../packages/shared-types/src/tenant";

import { create_ai_run_repository } from "../../apps/ai/server/repositories/ai-run-repository";
import { create_run_job_queue } from "../../apps/ai/server/services/ai-gateway/run-job-queue";
import {
  create_ai_gateway,
  AIDisabledError,
  AIRunInputInvalidError,
  type AIGatewayDeps,
  type CompiledRunPolicy,
  type GatewayBudgetReserver,
  type GatewayContextSource,
  type GatewayPolicySource,
} from "../../apps/ai/server/services/ai-gateway/ai-gateway";

let repl: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;

const TENANT = "507f1f77bcf86cd7994390a1";
const PROFILE = "507f1f77bcf86cd79943a001";
const T0 = new Date("2026-07-15T00:00:00.000Z");
const PACK_HASH = "b".repeat(64);

/** A manager-mode tenant execution context. */
function make_context(): TenantExecutionContext {
  const principal: RequestPrincipal = {
    auth_provider: "clerk",
    provider_user_id: `user_${PROFILE}`,
    internal_user_id: PROFILE,
    active_tenant_id: TENANT,
    platform_role: null,
    tenant_role: "manager",
    permissions: TENANT_ROLE_PERMISSIONS.manager,
    membership_status: "active",
  };
  return build_tenant_execution_context(principal, null, {
    clerk_organization_id: `org_${TENANT}`,
    membership_id: `mem_${PROFILE}`,
  });
}

/** A valid run input with the given idempotency key. */
function make_input(idempotency_key: string): Record<string, unknown> {
  return {
    schema_version: "1",
    thread_id: "507f1f77bcf86cd79943e001",
    agent_key: "formulation",
    message: "Draft a brightening serum.",
    attachment_source_ids: [],
    response_preferences: { language: "en", detail: "standard" },
    idempotency_key,
  };
}

const PINS: CompiledRunPolicy["pins"] = {
  policyVersion: 1,
  policySnapshot: { enabled: true },
  deploymentId: "507f1f77bcf86cd79943d001",
  agentDefinitionVersion: "v1",
  orchestratorVersion: "2026.07.0",
  promptVersionId: "507f1f77bcf86cd79943f001",
  inputSchemaVersion: "1",
  outputSchemaVersion: "1",
  provider: "gemini",
  model: "gemini-2.5-flash",
};

class FakePolicySource implements GatewayPolicySource {
  public compiled = 0;
  constructor(private readonly enabled = true) {}
  async compile(): Promise<CompiledRunPolicy> {
    this.compiled += 1;
    return {
      enabled: this.enabled,
      disabled_reason: this.enabled ? undefined : "AI is disabled for this tenant.",
      pins: PINS,
      budget_estimate: { tokens: 1000 },
      request_budget: { max_total_tokens: 200_000 },
    };
  }
}

class FakeContextSource implements GatewayContextSource {
  async assemble(): Promise<{ pack_hash: string }> {
    return { pack_hash: PACK_HASH };
  }
}

class FakeBudgetReserver implements GatewayBudgetReserver {
  public readonly reserves: string[] = [];
  async reserve(_t: unknown, _e: unknown, idempotency_key: string): Promise<void> {
    this.reserves.push(idempotency_key);
  }
}

/** Build gateway deps, returning handles to the fakes for assertions. */
function make_deps(policy = new FakePolicySource()): {
  deps: AIGatewayDeps;
  policy: FakePolicySource;
  budget: FakeBudgetReserver;
} {
  const budget = new FakeBudgetReserver();
  let corr = 0;
  const deps: AIGatewayDeps = {
    client,
    runs: create_ai_run_repository(db),
    jobs: create_run_job_queue(db),
    policy,
    context: new FakeContextSource(),
    budget,
    rollout: { default_executor: "agentic" },
    now: () => T0,
    correlation_id: () => `corr-${(corr += 1)}`,
    events_url: (run_id) => `/api/ai/runs/${run_id}/events`,
  };
  return { deps, policy, budget };
}

beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = new MongoClient(repl.getUri());
  await client.connect();
  db = client.db("test_gateway");
  await db.collection("ai_runs").createIndex({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
  await db.collection("ai_runs").createIndex({ correlationId: 1 }, { unique: true });
  await db.collection("ai_run_jobs").createIndex({ runId: 1, command: 1 }, { unique: true });
}, 60_000);

afterAll(async () => {
  await client.close();
  await repl.stop();
});

beforeEach(async () => {
  await db.collection("ai_runs").deleteMany({});
  await db.collection("ai_run_jobs").deleteMany({});
});

describe("ai-gateway create_run", () => {
  it("creates a pinned agentic run and enqueues exactly one job", async () => {
    const { deps, budget } = make_deps();
    const accepted = await create_ai_gateway(deps).create_run(make_context(), make_input("idem-run-0001"));

    expect(accepted.status).toBe("accepted");
    expect(accepted.executor).toBe("agentic");
    expect(accepted.already_accepted).toBe(false);
    expect(accepted.events_url).toBe(`/api/ai/runs/${accepted.run_id}/events`);

    const run = await db.collection("ai_runs").findOne({ _id: { $exists: true } });
    expect(run?.executor).toBe("agentic");
    expect(run?.contextPackHash).toBe(PACK_HASH);
    expect(run?.policyVersion).toBe(1);
    expect(run?.status).toBe("queued");

    expect(await db.collection("ai_run_jobs").countDocuments({})).toBe(1);
    expect(budget.reserves).toEqual(["idem-run-0001"]);
  });

  it("is idempotent — a retry returns the same run without re-compiling", async () => {
    const { deps, policy, budget } = make_deps();
    const gateway = create_ai_gateway(deps);
    const first = await gateway.create_run(make_context(), make_input("idem-run-0002"));
    const second = await gateway.create_run(make_context(), make_input("idem-run-0002"));

    expect(second.already_accepted).toBe(true);
    expect(second.run_id).toBe(first.run_id);
    expect(policy.compiled).toBe(1); // second call short-circuited
    expect(budget.reserves).toEqual(["idem-run-0002"]); // reserved once
    expect(await db.collection("ai_runs").countDocuments({})).toBe(1);
    expect(await db.collection("ai_run_jobs").countDocuments({})).toBe(1);
  });

  it("fails closed when AI is disabled for the tenant", async () => {
    const { deps } = make_deps(new FakePolicySource(false));
    await expect(
      create_ai_gateway(deps).create_run(make_context(), make_input("idem-run-0003")),
    ).rejects.toBeInstanceOf(AIDisabledError);
    expect(await db.collection("ai_runs").countDocuments({})).toBe(0);
  });

  it("rejects invalid run input before any write", async () => {
    const { deps } = make_deps();
    await expect(
      create_ai_gateway(deps).create_run(make_context(), { not: "valid" }),
    ).rejects.toBeInstanceOf(AIRunInputInvalidError);
    expect(await db.collection("ai_runs").countDocuments({})).toBe(0);
  });
});
