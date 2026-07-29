/**
 * Plan entitlements (G3.2) — the second policy layer.
 *
 * Each commercial plan grants a bounded slice of the platform universe: which
 * tools/providers it may use and its budget/iteration ceilings. A plan can only
 * narrow the platform layer; the compiler enforces that by intersection and
 * minimum, so a generous plan entry can never exceed a platform hard limit.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import type { AIApprovalRequirement } from "@rnd-ai/shared-types";
import { ToolGovernanceError } from "./errors";
import type { PolicyLayer } from "./policy-compiler";

/** Plan entitlement record (a superset of a PolicyLayer minus `enabled`). */
export interface PlanEntitlement {
  readonly allowed_providers: readonly string[];
  readonly allowed_models: readonly string[];
  readonly allowed_tools: readonly string[];
  readonly monthly_request_limit: bigint;
  readonly monthly_token_limit: bigint;
  readonly monthly_cost_limit_microusd: bigint;
  readonly per_user_monthly_request_limit: bigint;
  readonly per_user_monthly_token_limit: bigint;
  readonly per_user_monthly_cost_limit_microusd: bigint;
  readonly per_run_token_limit: bigint;
  readonly per_run_cost_limit_microusd: bigint;
  readonly max_concurrent_runs: number;
  readonly max_iterations: number;
  readonly approval_rules: Readonly<Record<string, AIApprovalRequirement>>;
}

/**
 * Static plan entitlement catalogue. Kept as data (not scattered literals) so
 * plan tuning is one edit; the compiler intersects these against the platform
 * universe, so an over-broad entry here can never widen the effective policy.
 */
export const PLAN_ENTITLEMENTS: Readonly<Record<string, PlanEntitlement>> =
  Object.freeze({
    starter: {
      allowed_providers: ["google"],
      allowed_models: ["gemini-3.5-flash", "gemini-2.5-flash"],
      allowed_tools: ["formula.search", "knowledge.search"],
      monthly_request_limit: BigInt(5_000),
      monthly_token_limit: BigInt(20_000_000),
      monthly_cost_limit_microusd: BigInt(200_000_000),
      per_user_monthly_request_limit: BigInt(1_000),
      per_user_monthly_token_limit: BigInt(5_000_000),
      per_user_monthly_cost_limit_microusd: BigInt(50_000_000),
      per_run_token_limit: BigInt(100_000),
      per_run_cost_limit_microusd: BigInt(1_000_000),
      max_concurrent_runs: 3,
      max_iterations: 8,
      approval_rules: { "formula.confirm": "manager" },
    },
    growth: {
      allowed_providers: ["google"],
      allowed_models: ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-3.1-pro-preview"],
      allowed_tools: [
        "formula.search",
        "formula.draft",
        "formula.revise",
        "formula.comment",
        "formula.confirm",
        "knowledge.search",
        "material.search",
      ],
      monthly_request_limit: BigInt(50_000),
      monthly_token_limit: BigInt(500_000_000),
      monthly_cost_limit_microusd: BigInt(5_000_000_000),
      per_user_monthly_request_limit: BigInt(10_000),
      per_user_monthly_token_limit: BigInt(50_000_000),
      per_user_monthly_cost_limit_microusd: BigInt(500_000_000),
      per_run_token_limit: BigInt(400_000),
      per_run_cost_limit_microusd: BigInt(4_000_000),
      max_concurrent_runs: 10,
      max_iterations: 16,
      approval_rules: { "formula.confirm": "manager" },
    },
    enterprise: {
      allowed_providers: ["google"],
      allowed_models: [
        "gemini-3.5-flash",
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-3.1-pro-preview",
      ],
      allowed_tools: [
        "formula.search",
        "formula.draft",
        "formula.revise",
        "formula.comment",
        "formula.confirm",
        "knowledge.search",
        "material.search",
        "web.search",
      ],
      monthly_request_limit: BigInt(1_000_000),
      monthly_token_limit: BigInt(5_000_000_000),
      monthly_cost_limit_microusd: BigInt(50_000_000_000),
      per_user_monthly_request_limit: BigInt(100_000),
      per_user_monthly_token_limit: BigInt(500_000_000),
      per_user_monthly_cost_limit_microusd: BigInt(5_000_000_000),
      per_run_token_limit: BigInt(2_000_000),
      per_run_cost_limit_microusd: BigInt(20_000_000),
      max_concurrent_runs: 50,
      max_iterations: 24,
      approval_rules: { "formula.confirm": "manager" },
    },
  });

/**
 * Build the plan entitlement layer for a plan key.
 *
 * @param plan_key - The tenant's plan key (from TenantAIProfile.planKey).
 * @param enabled - Whether the plan itself is enabled (default true).
 * @returns The plan policy layer.
 * @throws ToolGovernanceError POLICY_UNKNOWN_PLAN when the plan key is unknown.
 */
export function build_plan_layer(
  plan_key: string,
  enabled = true,
): PolicyLayer {
  const entitlement = PLAN_ENTITLEMENTS[plan_key];
  if (!entitlement) {
    throw new ToolGovernanceError(
      "POLICY_UNKNOWN_PLAN",
      `Unknown plan '${plan_key}'.`,
    );
  }
  return { enabled, ...entitlement };
}
