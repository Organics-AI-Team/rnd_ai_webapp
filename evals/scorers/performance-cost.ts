/** Deterministic usage reconciliation, latency, timeout, and cost scorer. */
import Decimal from "decimal.js";
import type { RecordedRun } from "../runner/recorded-run";
import type { DeterministicScore } from "./types";
import { unique_failures } from "./types";

export interface PerformanceCostScore extends DeterministicScore {
  readonly accepted_latency_ms: number;
  readonly active_completion_latency_ms: number;
  readonly cost_usd: string;
}

/**
 * Compare usage counters and cost with decimal-safe equality.
 *
 * @param run - Strict normalized run trace.
 * @returns True when public usage and the append-only ledger agree exactly.
 */
function usage_reconciles(run: RecordedRun): boolean {
  const { reported, ledger } = run.usage;
  return (
    reported.model_calls === ledger.model_calls &&
    reported.tool_calls === ledger.tool_calls &&
    reported.input_tokens === ledger.input_tokens &&
    reported.output_tokens === ledger.output_tokens &&
    reported.total_tokens === ledger.total_tokens &&
    new Decimal(reported.cost_usd).equals(ledger.cost_usd)
  );
}

/**
 * Score measured performance and cost against the run's pinned limits.
 *
 * @param run - Strict trace containing measured and pinned limit values.
 * @returns Deterministic metrics with stable failure codes.
 */
export function score_performance_cost(run: RecordedRun): PerformanceCostScore {
  const failures: string[] = [];
  const active_completion_latency_ms =
    run.performance.completion_latency_ms - run.performance.human_wait_ms;

  if (run.performance.timed_out) failures.push("RUN_TIMED_OUT");
  if (run.performance.accepted_latency_ms > run.performance.maximum_accepted_latency_ms) {
    failures.push("ACCEPTED_LATENCY_EXCEEDED");
  }
  if (active_completion_latency_ms > run.performance.maximum_completion_latency_ms) {
    failures.push("COMPLETION_LATENCY_EXCEEDED");
  }
  if (!usage_reconciles(run)) failures.push("USAGE_LEDGER_MISMATCH");
  if (run.usage.reported.total_tokens !== run.usage.reported.input_tokens + run.usage.reported.output_tokens) {
    failures.push("USAGE_TOTAL_INVALID");
  }
  if (new Decimal(run.usage.reported.cost_usd).greaterThan(run.usage.approved_cost_usd)) {
    failures.push("APPROVED_COST_EXCEEDED");
  }

  const unique = unique_failures(failures);
  return {
    passed: unique.length === 0,
    failures: unique,
    accepted_latency_ms: run.performance.accepted_latency_ms,
    active_completion_latency_ms,
    cost_usd: run.usage.reported.cost_usd,
  };
}
