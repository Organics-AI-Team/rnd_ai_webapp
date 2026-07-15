/**
 * Tenant AI usage ledger core (G3.3).
 *
 * Defines the append-only ledger entry shapes and the pure, deterministic
 * budget decision used before granting a reservation. All amounts are integer
 * micro-USD / token / request counts carried as bigint — never binary float or
 * Prisma Decimal (unsupported on the MongoDB connector).
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import type { EffectiveAIPolicy } from "@rnd-ai/shared-types";
import { ToolGovernanceError } from "./errors";

// ---------------------------------------------------------------------------
// Amounts and entries
// ---------------------------------------------------------------------------

/** A three-dimensional usage amount (all bigint). */
export interface UsageAmount {
  readonly requests: bigint;
  readonly tokens: bigint;
  readonly cost_microusd: bigint;
}

/** Zero usage amount. */
export const ZERO_USAGE: UsageAmount = Object.freeze({
  requests: BigInt(0),
  tokens: BigInt(0),
  cost_microusd: BigInt(0),
});

/** Kinds of ledger entry; the ledger is append-only. */
export type LedgerEntryKind = "reservation" | "actual" | "release" | "adjustment";

/** One immutable ledger entry. */
export interface LedgerEntry extends UsageAmount {
  readonly tenant_id: string;
  readonly actor_profile_id: string;
  readonly run_id: string;
  readonly kind: LedgerEntryKind;
  readonly idempotency_key: string;
  readonly rate_card_version: string;
  readonly reservation_id?: string;
  readonly released?: boolean;
  readonly created_at: Date;
}

/** Month-to-date committed + open-reservation totals for budget checks. */
export interface MonthTotals {
  readonly tenant: UsageAmount;
  readonly actor: UsageAmount;
  readonly active_runs: number;
}

/** The dimension a budget rejection was caused by (for diagnostics/tests). */
export type BudgetDimension =
  | "tenant_requests"
  | "tenant_tokens"
  | "tenant_cost"
  | "user_requests"
  | "user_tokens"
  | "user_cost"
  | "per_run_tokens"
  | "per_run_cost"
  | "max_concurrent_runs";

/** Typed budget rejection carrying the exceeded dimension. */
export class UsageBudgetError extends ToolGovernanceError {
  public readonly dimension: BudgetDimension;

  /**
   * @param dimension - The budget dimension that was exceeded.
   * @param message - Safe human-readable description.
   */
  constructor(dimension: BudgetDimension, message: string) {
    super("BUDGET_EXCEEDED", message);
    this.name = "UsageBudgetError";
    this.dimension = dimension;
  }
}

// ---------------------------------------------------------------------------
// Amount helpers
// ---------------------------------------------------------------------------

/**
 * Sum two usage amounts.
 *
 * @param left - First amount.
 * @param right - Second amount.
 * @returns The element-wise sum.
 */
export function add_usage(left: UsageAmount, right: UsageAmount): UsageAmount {
  return {
    requests: left.requests + right.requests,
    tokens: left.tokens + right.tokens,
    cost_microusd: left.cost_microusd + right.cost_microusd,
  };
}

/**
 * Subtract two usage amounts (may go negative; used for reconciliation deltas).
 *
 * @param left - Minuend.
 * @param right - Subtrahend.
 * @returns The element-wise difference.
 */
export function subtract_usage(
  left: UsageAmount,
  right: UsageAmount,
): UsageAmount {
  return {
    requests: left.requests - right.requests,
    tokens: left.tokens - right.tokens,
    cost_microusd: left.cost_microusd - right.cost_microusd,
  };
}

// ---------------------------------------------------------------------------
// Budget decision (pure)
// ---------------------------------------------------------------------------

/**
 * Assert that granting one more reservation of `estimate` keeps the tenant,
 * per-user, per-run, and concurrency budgets within the effective policy.
 * A single reservation counts as one request.
 *
 * @param totals - Committed + open reservation totals for tenant and actor.
 * @param estimate - The estimated usage of the new run.
 * @param policy - The effective, hash-pinned policy.
 * @throws UsageBudgetError with the exceeded dimension on any violation.
 */
export function assert_budget_available(
  totals: MonthTotals,
  estimate: UsageAmount,
  policy: EffectiveAIPolicy,
): void {
  const one = BigInt(1);

  // Per-run ceilings (independent of month-to-date).
  if (estimate.tokens > policy.per_run_token_limit) {
    throw new UsageBudgetError(
      "per_run_tokens",
      "The run token estimate exceeds the per-run token limit.",
    );
  }
  if (estimate.cost_microusd > policy.per_run_cost_limit_microusd) {
    throw new UsageBudgetError(
      "per_run_cost",
      "The run cost estimate exceeds the per-run cost limit.",
    );
  }

  // Tenant monthly ceilings.
  if (totals.tenant.requests + one > policy.monthly_request_limit) {
    throw new UsageBudgetError(
      "tenant_requests",
      "The tenant monthly request limit is reached.",
    );
  }
  if (totals.tenant.tokens + estimate.tokens > policy.monthly_token_limit) {
    throw new UsageBudgetError(
      "tenant_tokens",
      "The tenant monthly token limit would be exceeded.",
    );
  }
  if (
    totals.tenant.cost_microusd + estimate.cost_microusd >
    policy.monthly_cost_limit_microusd
  ) {
    throw new UsageBudgetError(
      "tenant_cost",
      "The tenant monthly cost limit would be exceeded.",
    );
  }

  // Per-user monthly ceilings.
  if (totals.actor.requests + one > policy.per_user_monthly_request_limit) {
    throw new UsageBudgetError(
      "user_requests",
      "The per-user monthly request limit is reached.",
    );
  }
  if (
    totals.actor.tokens + estimate.tokens >
    policy.per_user_monthly_token_limit
  ) {
    throw new UsageBudgetError(
      "user_tokens",
      "The per-user monthly token limit would be exceeded.",
    );
  }
  if (
    totals.actor.cost_microusd + estimate.cost_microusd >
    policy.per_user_monthly_cost_limit_microusd
  ) {
    throw new UsageBudgetError(
      "user_cost",
      "The per-user monthly cost limit would be exceeded.",
    );
  }

  // Concurrency ceiling.
  if (totals.active_runs + 1 > policy.max_concurrent_runs) {
    throw new UsageBudgetError(
      "max_concurrent_runs",
      "The maximum number of concurrent runs is reached.",
    );
  }
}
