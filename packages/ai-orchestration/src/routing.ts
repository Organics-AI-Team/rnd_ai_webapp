/**
 * Governor routing helpers: typed denial observations, fail commands, and
 * the canonical node-name constants of the governed loop topology.
 */
import { Command } from "@langchain/langgraph";
import { run_error_code_v1 } from "./contracts";
import type {
  ProposedActionV1,
  RunErrorCodeV1,
  RunErrorV1,
} from "./contracts";
import { build_run_event } from "./events";
import type { AgentLoopRuntime } from "./ports";
import { log_loop_event } from "./ports";
import { build_observation } from "./schemas/observation";
import type { AgentLoopStateType, AgentLoopStateUpdate } from "./state";

/** Canonical node names of the governed loop topology. */
export const LOOP_NODE = Object.freeze({
  ingress: "ingress",
  agent: "agent",
  gate: "gate",
  act: "act",
  request_clarification: "request_clarification",
  request_approval: "request_approval",
  finalize: "finalize",
  fail: "fail",
});

/**
 * Map a policy denial reason code onto a stable public run error code.
 *
 * @param reason_code - Reason code reported by the injected policy engine.
 * @returns The matching RunErrorCodeV1, or ORCHESTRATOR_INVARIANT_VIOLATION
 *          when the policy engine reports an unknown code (fail closed).
 */
export function to_run_error_code(reason_code: string): RunErrorCodeV1 {
  const parsed = run_error_code_v1.safeParse(reason_code);
  return parsed.success ? parsed.data : "ORCHESTRATOR_INVARIANT_VIOLATION";
}

/**
 * Build a typed, safe run error.
 *
 * @param runtime - Node runtime (for the correlation ID).
 * @param code - Stable error code.
 * @param safe_message - Client-safe failure description.
 * @returns RunErrorV1 without partial output (the fail node attaches it).
 */
export function build_run_error(
  runtime: AgentLoopRuntime,
  code: RunErrorV1["code"],
  safe_message: string,
): RunErrorV1 {
  return {
    code,
    safe_message,
    retryable: false,
    correlation_id: runtime.context.correlation_id,
    partial_output: null,
  };
}

/**
 * Build a Command that routes to the fail node with a typed error.
 *
 * @param error - Typed run error to record.
 * @param extra_update - Optional additional state channels to update.
 * @returns Command targeting the fail node.
 */
export function fail_command(
  error: RunErrorV1,
  extra_update: AgentLoopStateUpdate = {},
): Command {
  return new Command({
    goto: LOOP_NODE.fail,
    update: { ...extra_update, error },
  });
}

/**
 * Route a non-fatal policy denial back to the agent as a typed, safe
 * policy_denied observation so the model can re-plan within the run.
 *
 * @param state - Current loop state.
 * @param runtime - Node runtime (ids, clock, logging).
 * @param action - The denied pending tool action.
 * @param verdict - Denial details from the policy engine.
 * @returns Command targeting the agent node with the denial observation.
 */
export function route_denial(
  state: AgentLoopStateType,
  runtime: AgentLoopRuntime,
  action: Extract<ProposedActionV1, { kind: "tool" }>,
  verdict: {
    readonly reason_code: string;
    readonly safe_reason: string;
  },
): Command {
  log_loop_event(runtime, "warn", "gate.denied", {
    tool_name: action.tool_name,
    reason_code: verdict.reason_code,
  });
  const { clock, ids } = runtime.ports;
  const observation = build_observation({
    observation_id: ids.next_id(),
    run_id: state.run_id,
    iteration: state.iteration,
    type: "policy_denied",
    source: { kind: "system", tool_name: action.tool_name, source_ids: [] },
    content: JSON.stringify({
      reason_code: verdict.reason_code,
      safe_reason: verdict.safe_reason,
      tool_name: action.tool_name,
      arguments_hash: action.arguments_hash,
    }),
    trust: "trusted_system",
    cost_usd: "0",
    latency_ms: 0,
    occurred_at: clock.now_iso(),
    metadata: { reason_code: verdict.reason_code },
  });
  const sources = { clock, ids };
  return new Command({
    goto: LOOP_NODE.agent,
    update: {
      pending_action: null,
      observations: [observation],
      events: [
        build_run_event(state, sources, 0, "observation.added", {
          observation_id: observation.observation_id,
          observation_type: observation.type,
          trust: observation.trust,
          source_kind: observation.source.kind,
          tool_name: action.tool_name,
          content_hash: observation.content_hash,
        }),
        build_run_event(state, sources, 1, "stage.changed", {
          stage: "thinking",
        }),
      ],
    },
  });
}
