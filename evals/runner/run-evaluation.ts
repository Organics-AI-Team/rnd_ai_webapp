/** Aggregate commercial scorer for one immutable corpus case and recorded run. */
import type { EvalCaseV1 } from "../schemas/eval-case";
import { score_evidence_coverage } from "../scorers/evidence-coverage";
import { score_formula_correctness } from "../scorers/formula-correctness";
import { score_performance_cost } from "../scorers/performance-cost";
import { score_security } from "../scorers/security";
import { score_task_success } from "../scorers/task-success";
import { unique_failures } from "../scorers/types";
import { recorded_run_v1_schema, type RecordedRun } from "./recorded-run";

export type { RecordedRun } from "./recorded-run";

export interface CaseScore {
  readonly passed: boolean;
  readonly failures: string[];
  readonly rubric_applied: boolean;
  readonly formula_valid: boolean;
  readonly evidence_coverage: number;
  readonly supported_claims: number;
  readonly evaluated_claims: number;
  readonly accepted_latency_ms: number | null;
  readonly active_completion_latency_ms: number | null;
  readonly cost_usd: string | null;
}

/**
 * Normalize the historical plan label into the canonical G4 executor name.
 *
 * The released G4 contract persists `agentic`; `ooda` remains accepted only at
 * evaluation import boundaries so older benchmark metadata stays readable.
 *
 * @param value - Executor label from recorded evaluation metadata.
 * @returns Canonical executor label, or null for an unsupported executor.
 */
export function normalize_executor_name(value: string): "legacy" | "agentic" | null {
  if (value === "legacy") return "legacy";
  if (value === "agentic" || value === "ooda") return "agentic";
  return null;
}

/**
 * Score one run with deterministic gates before considering rubric judgment.
 *
 * @param test_case - Immutable, validated corpus case.
 * @param input - Unknown adapter output; parsed fail-closed before scoring.
 * @returns Case-level result with stable failures and report-ready metrics.
 */
export function score_case(test_case: EvalCaseV1, input: unknown): CaseScore {
  const parsed = recorded_run_v1_schema.safeParse(input);
  if (!parsed.success) {
    return {
      passed: false,
      failures: ["RECORDED_RUN_SCHEMA_INVALID"],
      rubric_applied: false,
      formula_valid: false,
      evidence_coverage: 0,
      supported_claims: 0,
      evaluated_claims: 0,
      accepted_latency_ms: null,
      active_completion_latency_ms: null,
      cost_usd: null,
    };
  }

  const run: RecordedRun = parsed.data;
  const task = score_task_success(test_case, run);
  const security = score_security(test_case, run);
  const formula = score_formula_correctness(test_case, run.formula);
  const evidence = score_evidence_coverage(test_case, run);
  const performance = score_performance_cost(run);
  const rubric_applied =
    task.deterministic_passed && security.passed && formula.passed;
  const failures = unique_failures([
    ...task.deterministic_failures,
    ...security.failures,
    ...formula.failures,
    ...evidence.failures,
    ...performance.failures,
    ...(rubric_applied ? task.rubric_failures : []),
  ]);

  return {
    passed: failures.length === 0 && rubric_applied && task.rubric_passed,
    failures,
    rubric_applied,
    formula_valid: formula.passed,
    evidence_coverage: evidence.coverage,
    supported_claims: evidence.supported_claims,
    evaluated_claims: evidence.evaluated_claims,
    accepted_latency_ms: performance.accepted_latency_ms,
    active_completion_latency_ms: performance.active_completion_latency_ms,
    cost_usd: performance.cost_usd,
  };
}
