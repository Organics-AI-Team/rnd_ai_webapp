// ============================================
// TENANT AI CONTROL-PLANE POLICY CONTRACTS (G3.1)
// ============================================

/**
 * Approval strength for one side-effecting operation. "manager" always wins
 * over "none" when policy layers are merged, so tenants can only strengthen
 * (never relax) an approval requirement.
 */
export type AIApprovalRequirement = "none" | "manager";

/**
 * Compiled, immutable tenant AI policy produced by the policy compiler from
 * platform hard limits, plan entitlements, tenant settings, and the active
 * agent deployment. A canonical JSON snapshot of this object is hashed
 * (SHA-256) and pinned on every AIRun as policySnapshot/policyVersion, so a
 * run can never observe a policy other than the one it was admitted under.
 *
 * All budget limits are bigint: request/token counters can exceed 2^53 over
 * a billing period, and monetary limits are integer micro-USD (1 USD =
 * 1_000_000 micro-USD) because binary floats and Prisma Decimal are both
 * unavailable/unsafe on the MongoDB connector.
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
  readonly approval_rules: Readonly<Record<string, AIApprovalRequirement>>;
}

/**
 * Map of operation key (e.g. "formula.confirm") to the approval strength it
 * requires. Merging layers keeps the strongest requirement per key.
 */
export type AIApprovalRuleMap = EffectiveAIPolicy["approval_rules"];

/**
 * Provider identifier to the model identifiers a policy allows for it. An
 * empty intersection across layers must reject run creation, never widen.
 */
export type AIProviderModelMap = EffectiveAIPolicy["provider_models"];

/** Micro-USD per USD; monetary limits/costs are integer micro-USD bigint. */
export const MICROUSD_PER_USD = BigInt(1_000_000);
