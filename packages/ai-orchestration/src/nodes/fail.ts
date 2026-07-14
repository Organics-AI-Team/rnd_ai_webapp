/**
 * Fail: the deterministic terminal error node.
 *
 * Attaches a safe partial output (evidence references, rationales, usage —
 * never hidden reasoning), reconciles usage, marks the run failed through
 * the injected repository, and emits run.failed. There is no fallback to any
 * legacy executor from here or anywhere else in the loop.
 */
import type { RunErrorV1 } from "../contracts";
import { build_run_event } from "../events";
import { build_output_document } from "../output";
import type { AgentLoopRuntime } from "../ports";
import { log_loop_event } from "../ports";
import { build_run_error } from "../routing";
import type { AgentLoopStateType, AgentLoopStateUpdate } from "../state";

/**
 * Terminate the run safely with a typed error and partial output.
 *
 * @param state - Current loop state carrying the typed error.
 * @param runtime - Injected ports and trusted context.
 * @returns State update with the enriched error and the run.failed event.
 */
export async function fail(
  state: AgentLoopStateType,
  runtime: AgentLoopRuntime,
): Promise<AgentLoopStateUpdate> {
  const base_error: RunErrorV1 =
    state.error ??
    build_run_error(
      runtime,
      "ORCHESTRATOR_INVARIANT_VIOLATION",
      "The run terminated without a recorded error.",
    );
  log_loop_event(runtime, "error", "fail.start", { code: base_error.code });

  const partial_output = build_output_document(state, runtime, {
    status: "failed",
    answer: null,
    citations: [],
    uncertainty: [
      "The run ended before completion; results are partial and unvalidated.",
    ],
  });
  const enriched_error: RunErrorV1 = { ...base_error, partial_output };

  await runtime.ports.usage.reconcile(
    state.run_id,
    {
      model_calls: state.usage.model_calls,
      tool_calls: state.usage.tool_calls,
      tokens_used: state.usage.tokens_used,
      cost_usd_used: state.usage.cost_usd_used,
    },
    runtime.context,
  );
  await runtime.ports.runs.mark_failed(
    state.run_id,
    enriched_error,
    runtime.context,
  );

  const events = [
    build_run_event(
      state,
      { clock: runtime.ports.clock, ids: runtime.ports.ids },
      0,
      "run.failed",
      {
        code: enriched_error.code,
        safe_message: enriched_error.safe_message,
        retryable: enriched_error.retryable,
      },
    ),
  ];

  log_loop_event(runtime, "error", "fail.finish", {
    code: enriched_error.code,
  });
  return { error: enriched_error, pending_action: null, events };
}
