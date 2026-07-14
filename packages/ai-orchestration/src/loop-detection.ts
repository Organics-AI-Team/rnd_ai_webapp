/**
 * Deterministic normalized-action loop detection.
 *
 * The gate normalizes every proposed action to tool name + canonical
 * arguments hash; when the same normalized action has been proposed at or
 * beyond the configured threshold (counting both denied and executed
 * proposals in the decision log), the run fails with LOOP_DETECTED instead
 * of burning budget on a stuck model.
 */
import type { DecisionRecordV1 } from "./contracts";

/** Minimal normalized reference to one proposed tool action. */
export interface NormalizedActionRef {
  readonly tool_name: string;
  readonly arguments_hash: string;
}

/**
 * Normalize an action to its loop-detection signature.
 *
 * @param action - Tool name plus canonical arguments hash.
 * @returns Stable signature string; identical semantics yield identical
 *          signatures because arguments are hashed canonically.
 */
export function normalize_action_signature(
  action: NormalizedActionRef,
): string {
  return `${action.tool_name}#${action.arguments_hash}`;
}

/**
 * Count how many logged tool decisions match a normalized signature.
 *
 * @param decision_log - Derived decision records for the run so far.
 * @param signature - Normalized action signature to count.
 * @returns Occurrences among kind="tool" decisions (denials included, since
 *          denied proposals are logged like any other decision).
 */
export function count_identical_proposals(
  decision_log: readonly DecisionRecordV1[],
  signature: string,
): number {
  let count = 0;
  for (const decision of decision_log) {
    if (
      decision.kind === "tool" &&
      decision.tool_name !== null &&
      normalize_action_signature({
        tool_name: decision.tool_name,
        arguments_hash: decision.arguments_hash,
      }) === signature
    ) {
      count += 1;
    }
  }
  return count;
}

/**
 * Decide whether the pending action trips loop detection.
 *
 * @param decision_log - Decision records including the pending proposal.
 * @param action - Pending normalized action.
 * @param threshold - Configured identical-proposal threshold (>=1).
 * @returns True when the identical-proposal count reaches the threshold.
 */
export function is_loop_detected(
  decision_log: readonly DecisionRecordV1[],
  action: NormalizedActionRef,
  threshold: number,
): boolean {
  return (
    count_identical_proposals(
      decision_log,
      normalize_action_signature(action),
    ) >= threshold
  );
}
