import { describe, expect, it } from "vitest";

import {
  AIExecutionContextInvalidError,
  create_ai_execution_context,
  type AgentDeploymentSnapshot,
} from "../../apps/ai/server/services/ai-control/create-ai-execution-context";
import type { EffectiveAIPolicy, TenantExecutionContext } from "@rnd-ai/shared-types";

const tenant = Object.freeze({
  tenant_id: "507f1f77bcf86cd799439011",
  actor_profile_id: "507f1f77bcf86cd799439012",
  correlation_id: "corr-request-1",
}) as TenantExecutionContext;

const policy = Object.freeze({
  tenant_id: tenant.tenant_id,
  version: 3,
  hash: "a".repeat(64),
  enabled: true,
  provider_models: Object.freeze({ google: Object.freeze(["gemini-2.5-flash"]) }),
  allowed_tools: Object.freeze(["knowledge.search"]),
  approval_rules: Object.freeze({}),
}) as unknown as EffectiveAIPolicy;

const deployment: AgentDeploymentSnapshot = {
  deployment_id: "507f1f77bcf86cd799439013",
  tenant_id: tenant.tenant_id,
  agent_key: "raw_material_research",
  revision: 4,
  status: "active",
  agent_definition_version: "1.0.0",
  orchestrator_version: "1.0.0",
  prompt_version_id: "507f1f77bcf86cd799439014",
  input_schema_version: "1",
  output_schema_version: "1",
};

describe("create_ai_execution_context", () => {
  it("builds and deeply freezes the trusted per-run context", () => {
    const signal = new AbortController().signal;
    const context = create_ai_execution_context({
      tenant,
      policy,
      deployment,
      run_id: "507f1f77bcf86cd799439015",
      reservation_id: "reservation-1",
      prompt_version_id: deployment.prompt_version_id,
      correlation_id: "corr-run-1",
      signal,
    });

    expect(context).toMatchObject({
      tenant,
      policy,
      deployment,
      run_id: "507f1f77bcf86cd799439015",
      reservation_id: "reservation-1",
      prompt_version_id: deployment.prompt_version_id,
      correlation_id: "corr-run-1",
      signal,
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.policy)).toBe(true);
    expect(Object.isFrozen(context.deployment)).toBe(true);
    expect(Object.isFrozen(context.policy.provider_models)).toBe(true);
  });

  it.each([
    ["policy tenant", { policy: { ...policy, tenant_id: "tenant-b" } }],
    ["deployment tenant", { deployment: { ...deployment, tenant_id: "tenant-b" } }],
    ["inactive deployment", { deployment: { ...deployment, status: "retired" } }],
    ["prompt pin", { prompt_version_id: "different-prompt" }],
  ])("fails closed for a mismatched %s", (_label, override) => {
    expect(() =>
      create_ai_execution_context({
        tenant,
        policy,
        deployment,
        run_id: "run-1",
        reservation_id: "reservation-1",
        prompt_version_id: deployment.prompt_version_id,
        correlation_id: "corr-run-1",
        signal: new AbortController().signal,
        ...override,
      }),
    ).toThrow(AIExecutionContextInvalidError);
  });
});
