import { describe, expect, it } from "vitest";

import type { EffectiveAIPolicy } from "@rnd-ai/shared-types";
import type { TrustedRuntimeContext } from "@rnd-ai/ai-orchestration";
import {
  create_runtime_policy_engine,
  type CurrentRunAuthorizationState,
} from "../../apps/ai/server/services/ai-control/runtime-policy-engine";

const context: TrustedRuntimeContext = {
  tenant_id: "tenant-a",
  actor_profile_id: "profile-a",
  run_id: "run-a",
  parent_run_id: null,
  delegation_depth: 0,
  correlation_id: "corr-a",
};

const policy: EffectiveAIPolicy = {
  tenant_id: "tenant-a",
  version: 4,
  hash: "a".repeat(64),
  enabled: true,
  provider_models: { google: ["gemini-test"] },
  allowed_tools: ["knowledge.search", "formula.confirm"],
  monthly_request_limit: 10n,
  monthly_token_limit: 10n,
  monthly_cost_limit_microusd: 10n,
  per_user_monthly_request_limit: 10n,
  per_user_monthly_token_limit: 10n,
  per_user_monthly_cost_limit_microusd: 10n,
  per_run_token_limit: 10n,
  per_run_cost_limit_microusd: 10n,
  max_concurrent_runs: 1,
  default_locale: "en-US",
  max_iterations: 4,
  approval_rules: { "formula.confirm": "manager" },
};

const allowed_state: CurrentRunAuthorizationState = {
  emergency_disabled: false,
  tenant_ai_active: true,
  deployment_active: true,
  membership_active: true,
  reservation_open: true,
  permissions: ["tenant:knowledge:read", "formula:confirm"],
};

function engine(overrides: Partial<CurrentRunAuthorizationState> = {}) {
  return create_runtime_policy_engine({
    policy,
    describe_tool: (name) =>
      name === "knowledge.search"
        ? { required_permission: "tenant:knowledge:read", approval_requirement: "none" }
        : name === "formula.confirm"
          ? { required_permission: "formula:confirm", approval_requirement: "manager" }
          : null,
    authorization: {
      load_current: async () => ({ ...allowed_state, ...overrides }),
    },
  });
}

describe("runtime policy engine", () => {
  it("allows a currently authorized read action", async () => {
    await expect(
      engine().evaluate_action({ tool_name: "knowledge.search", arguments: { query: "x" } }, context),
    ).resolves.toEqual({ kind: "allowed" });
  });

  it.each([
    ["emergency_disabled", "POLICY_EMERGENCY_DISABLED"],
    ["tenant_ai_active", "POLICY_DEPLOYMENT_REVOKED"],
    ["deployment_active", "POLICY_DEPLOYMENT_REVOKED"],
    ["membership_active", "POLICY_PERMISSION_MISSING"],
    ["reservation_open", "BUDGET_RESERVATION_FAILED"],
  ] as const)("fails fatally when current %s is unsafe", async (field, code) => {
    const unsafe = field === "emergency_disabled" ? true : false;
    await expect(
      engine({ [field]: unsafe }).evaluate_action(
        { tool_name: "knowledge.search", arguments: { query: "x" } },
        context,
      ),
    ).resolves.toMatchObject({ kind: "denied", reason_code: code, fatal: true });
  });

  it("returns a non-fatal exact-permission denial", async () => {
    await expect(
      engine({ permissions: [] }).evaluate_action(
        { tool_name: "knowledge.search", arguments: { query: "x" } },
        context,
      ),
    ).resolves.toEqual({
      kind: "denied",
      reason_code: "POLICY_PERMISSION_MISSING",
      safe_reason: "The current membership lacks permission for this action.",
      fatal: false,
    });
  });

  it("requires approval for the strongest definition/policy rule", async () => {
    await expect(
      engine().evaluate_action(
        { tool_name: "formula.confirm", arguments: { formula_id: "f" } },
        context,
      ),
    ).resolves.toMatchObject({ kind: "approval_required" });
  });

  it("fails closed for a mismatched context or unknown/disallowed tool", async () => {
    await expect(
      engine().evaluate_action(
        { tool_name: "knowledge.search", arguments: {} },
        { ...context, tenant_id: "tenant-b" },
      ),
    ).resolves.toMatchObject({ kind: "denied", fatal: true });
    await expect(
      engine().evaluate_action({ tool_name: "web.search", arguments: {} }, context),
    ).resolves.toEqual({
      kind: "denied",
      reason_code: "POLICY_TOOL_NOT_ALLOWED",
      safe_reason: "The action is not allowed by the pinned policy.",
      fatal: false,
    });
  });
});
