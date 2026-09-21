/** Deterministic task/clarification scorer plus a pinned structured rubric input. */
import type { EvalCaseV1 } from "../schemas/eval-case";
import type { RecordedRun } from "../runner/recorded-run";
import type { DeterministicScore } from "./types";
import { unique_failures } from "./types";

export interface TaskSuccessScore extends DeterministicScore {
  readonly deterministic_passed: boolean;
  readonly deterministic_failures: string[];
  readonly rubric_passed: boolean;
  readonly rubric_failures: string[];
}

/**
 * Score terminal behavior, exact checks, and clarification discipline.
 *
 * @param test_case - Corpus case carrying deterministic expectations.
 * @param run - Strict normalized run trace.
 * @returns Deterministic task failure codes.
 */
function deterministic_task_failures(test_case: EvalCaseV1, run: RecordedRun): string[] {
  const failures: string[] = [];
  if (run.terminal_status !== test_case.expected_behavior.terminal_status) {
    failures.push("TERMINAL_STATUS_MISMATCH");
  }
  if (run.response_mode !== test_case.expected_behavior.response_mode) {
    failures.push("RESPONSE_MODE_MISMATCH");
  }
  if (run.error_code !== test_case.expected_behavior.expected_error_code) {
    failures.push("ERROR_CODE_MISMATCH");
  }
  if (test_case.deterministic_checks.some((check) => run.exact_checks[check] !== true)) {
    failures.push("DETERMINISTIC_CHECK_FAILED");
  }
  if (run.performance.timed_out) failures.push("RUN_TIMED_OUT");

  if (test_case.expected_behavior.response_mode === "clarify") {
    if (run.clarification_interrupts.length !== 1) {
      failures.push("CLARIFICATION_NOT_BATCHED");
    }
    if (
      run.clarification_interrupts.some(
        ({ tool_calls_before_interrupt }) => tool_calls_before_interrupt > 0,
      )
    ) {
      failures.push("TOOL_CALLED_BEFORE_CLARIFICATION");
    }
  } else if (run.clarification_interrupts.length > 0) {
    failures.push("UNEXPECTED_CLARIFICATION");
  }
  return unique_failures(failures);
}

/**
 * Validate the blinded structured grader record against the case rubric.
 *
 * @param test_case - Corpus case carrying the minimum rubric score.
 * @param run - Strict normalized run trace with an optional grader record.
 * @returns Stable rubric failure codes.
 */
function rubric_failures(test_case: EvalCaseV1, run: RecordedRun): string[] {
  if (run.grader === null) return ["RUBRIC_GRADER_MISSING"];
  if (!run.grader.blinded) return ["RUBRIC_GRADER_NOT_BLINDED"];
  if (run.grader.score < test_case.rubric.minimum_score) return ["RUBRIC_SCORE_BELOW_MINIMUM"];
  return [];
}

/**
 * Score task completion and the pinned, blinded rubric result.
 *
 * @param test_case - Strict commercial evaluation case.
 * @param run - Strict normalized run trace.
 * @returns Split deterministic/rubric results for safe aggregate gating.
 */
export function score_task_success(test_case: EvalCaseV1, run: RecordedRun): TaskSuccessScore {
  const deterministic = deterministic_task_failures(test_case, run);
  const rubric = rubric_failures(test_case, run);
  return {
    passed: deterministic.length === 0 && rubric.length === 0,
    failures: [...deterministic, ...rubric],
    deterministic_passed: deterministic.length === 0,
    deterministic_failures: deterministic,
    rubric_passed: rubric.length === 0,
    rubric_failures: rubric,
  };
}
