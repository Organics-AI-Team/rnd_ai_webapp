/**
 * Effective tenant AI policy contract consumed by the tool catalogue,
 * tool executor, and context assembler.
 *
 * Shape mirrors the EffectiveAIPolicy anchor in
 * docs/superpowers/plans/2026-07-15-tenant-ai-control-plane.md (Task 1/2).
 * Once G3 Task 1 lands the canonical contract in
 * packages/shared-types/src/ai/policy.ts, this module should re-export it
 * instead of declaring its own copy (tracked integration TODO).
 *
 * @author AI Management System
 * @date 2026-07-15
 */

/** Approval strength ladder; "manager" always wins over "none". */
export type ApprovalRule = "none" | "manager";

/**
 * Immutable, compiled tenant AI policy snapshot.
 *
 * Monetary limits are integer micro-USD carried as bigint; token/request
 * limits are bigint because monthly aggregates can exceed 2^53.
 */
export interface EffectiveAIPolicy {
  readonly tenant_id: string;
  readonly version: number;
  readonly hash: string;
  readonly enabled: boolean;
  readonly provider_models: Readonly<Record<string, readonly string[]>>;
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
  readonly default_locale: string;
  readonly max_iterations: number;
  readonly approval_rules: Readonly<Record<string, ApprovalRule>>;
}
