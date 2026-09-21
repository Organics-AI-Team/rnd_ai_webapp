/**
 * Clarification interrupt node (G4.7).
 *
 * When the model asks the user a bounded question, this node durably interrupts
 * the run (LangGraph `interrupt`) with the ClarificationRequestV1 questions. On
 * resume it validates the answer and appends it as a trusted-user observation,
 * then returns to the agent node (fixed edge). The interrupt is never wrapped in
 * try/catch — its control-flow signal must propagate to the graph runtime.
 */

import { interrupt } from "@langchain/langgraph";
import { clarification_resume_v1_schema } from "../contracts";
import { build_observation } from "../schemas/observation";
import type { AgentLoopRuntime } from "../ports";
import { log_loop_event } from "../ports";
import { build_run_error } from "../routing";
import type { AgentLoopStateType, AgentLoopStateUpdate } from "../state";

/**
 * Interrupt for a clarification and re-enter the agent with the user's answer.
 *
 * @param state - Current loop state (pending_action must be a clarification).
 * @param runtime - Injected ports and trusted context.
 * @returns A trusted-user observation update, or a typed error on invalid input.
 */
export async function request_clarification(
  state: AgentLoopStateType,
  runtime: AgentLoopRuntime,
): Promise<AgentLoopStateUpdate> {
  const action = state.pending_action;
  if (!action || action.kind !== "clarification") {
    log_loop_event(runtime, "error", "request_clarification.missing_request");
    return {
      error: build_run_error(
        runtime,
        "ORCHESTRATOR_INVARIANT_VIOLATION",
        "Clarification was reached without a clarify proposal.",
      ),
    };
  }

  const resumed = interrupt({
    schema_version: "1",
    questions: action.request.questions,
  });

  const parsed = clarification_resume_v1_schema.safeParse(resumed);
  if (!parsed.success) {
    log_loop_event(runtime, "warn", "request_clarification.invalid_resume");
    return {
      error: build_run_error(
        runtime,
        "ORCHESTRATOR_INVARIANT_VIOLATION",
        "The clarification answer was invalid.",
      ),
    };
  }

  const { clock, ids } = runtime.ports;
  const observation = build_observation({
    observation_id: ids.next_id(),
    run_id: state.run_id,
    iteration: state.iteration,
    type: "user_message",
    source: { kind: "user", tool_name: null, source_ids: [] },
    content: parsed.data.answer,
    trust: "trusted_user",
    cost_usd: "0",
    latency_ms: 0,
    occurred_at: clock.now_iso(),
    metadata: { clarification: true },
  });
  log_loop_event(runtime, "info", "request_clarification.answered");
  return { observations: [observation], pending_action: null };
}
