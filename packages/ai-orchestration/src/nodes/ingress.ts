/**
 * Ingress: the deterministic entry node of the governed loop.
 *
 * Verifies the validated input, the pinned context pack, and the orchestrator
 * version pin; seeds trusted initial observations through injected ports; and
 * emits run.accepted. Authorization is never loaded from input — the gateway
 * resolves it server-side before the graph is invoked (program invariant 5).
 *
 * Ingress has a single fixed edge to agent; on any verification failure it
 * sets a typed error and the agent node routes to fail before any model call.
 */
import { validate_context_pack } from "../context/context-pack";
import { agent_run_input_v1_schema } from "../contracts";
import type { RunErrorV1 } from "../contracts";
import { build_run_event } from "../events";
import type { AgentLoopRuntime } from "../ports";
import { log_loop_event } from "../ports";
import { build_observation } from "../schemas/observation";
import type { ObservationV1 } from "../schemas/observation";
import type { AgentLoopStateType, AgentLoopStateUpdate } from "../state";
import { assert_supported_orchestrator_version } from "../version";

/**
 * Build a typed, safe ingress verification error.
 *
 * @param runtime - Node runtime (for the correlation ID).
 * @param code - Stable error code.
 * @param safe_message - Client-safe failure description.
 * @returns RunErrorV1 with no internal detail.
 */
function ingress_error(
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
 * Verify pins and input for one run and seed its initial observations.
 *
 * @param state - Initial loop state built by the gateway.
 * @param runtime - Injected ports, policy, trusted context, and config.
 * @returns State update with seeded observations and run.accepted event, or
 *          a typed error update when any verification fails (fail closed).
 */
export async function ingress(
  state: AgentLoopStateType,
  runtime: AgentLoopRuntime,
): Promise<AgentLoopStateUpdate> {
  log_loop_event(runtime, "info", "ingress.start", {
    thread_id: state.thread_id,
  });

  const input_check = agent_run_input_v1_schema.safeParse(state.input);
  if (!input_check.success) {
    log_loop_event(runtime, "warn", "ingress.invalid_input");
    return {
      error: ingress_error(
        runtime,
        "INPUT_INVALID",
        "The request input failed validation.",
      ),
    };
  }

  try {
    validate_context_pack(state.context_pack);
  } catch {
    log_loop_event(runtime, "warn", "ingress.invalid_context_pack");
    return {
      error: ingress_error(
        runtime,
        "CONTEXT_PACK_INVALID",
        "The pinned run context could not be verified.",
      ),
    };
  }

  try {
    assert_supported_orchestrator_version(state.pins.orchestrator_version);
  } catch {
    log_loop_event(runtime, "warn", "ingress.unsupported_orchestrator_version");
    return {
      error: ingress_error(
        runtime,
        "ORCHESTRATOR_VERSION_UNSUPPORTED",
        "This run is pinned to an unsupported orchestrator version.",
      ),
    };
  }

  if (state.pins.context_pack_hash !== state.context_pack.pack_hash) {
    log_loop_event(runtime, "warn", "ingress.context_pack_pin_mismatch");
    return {
      error: ingress_error(
        runtime,
        "CONTEXT_PACK_INVALID",
        "The pinned context pack hash does not match the supplied pack.",
      ),
    };
  }

  const { clock, ids, knowledge } = runtime.ports;
  const observations: ObservationV1[] = [
    build_observation({
      observation_id: ids.next_id(),
      run_id: state.run_id,
      iteration: 0,
      type: "user_message",
      source: {
        kind: "user",
        tool_name: null,
        source_ids: [...input_check.data.attachment_source_ids],
      },
      content: input_check.data.message,
      trust: "trusted_user",
      cost_usd: "0",
      latency_ms: 0,
      occurred_at: clock.now_iso(),
      metadata: {},
    }),
  ];

  const thread_summary = await knowledge.load_thread_summary(
    state.thread_id,
    runtime.context,
  );
  if (thread_summary) {
    observations.push(
      build_observation({
        observation_id: ids.next_id(),
        run_id: state.run_id,
        iteration: 0,
        type: "thread_summary",
        source: { kind: "system", tool_name: null, source_ids: [] },
        content: thread_summary,
        trust: "trusted_user",
        cost_usd: "0",
        latency_ms: 0,
        occurred_at: clock.now_iso(),
        metadata: {},
      }),
    );
  }

  const sources = { clock, ids };
  const events = [
    build_run_event(state, sources, 0, "run.accepted", {
      agent_key: input_check.data.agent_key,
      context_pack_hash: state.context_pack.pack_hash,
      orchestrator_version: state.pins.orchestrator_version,
    }),
    build_run_event(state, sources, 1, "stage.changed", {
      stage: "thinking",
    }),
    ...observations.map((observation, index) =>
      build_run_event(state, sources, 2 + index, "observation.added", {
        observation_id: observation.observation_id,
        observation_type: observation.type,
        trust: observation.trust,
        source_kind: observation.source.kind,
        tool_name: observation.source.tool_name,
        content_hash: observation.content_hash,
      }),
    ),
  ];

  log_loop_event(runtime, "info", "ingress.finish", {
    seeded_observations: observations.length,
  });
  return { observations, events };
}
