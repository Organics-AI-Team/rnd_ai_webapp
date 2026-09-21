/**
 * The agent reasoning node — the ONLY node that calls the ModelGateway.
 *
 * One native tool-calling turn per iteration. The model may propose exactly
 * one of: a catalogue tool call, a request_clarification call, or a finalize
 * call. DecisionRecordV1 is DERIVED from the native tool call — the model is
 * never asked to emit a decision schema.
 *
 * Budgets (iterations, deadline, tokens, cost) are checked deterministically
 * BEFORE the model is called; exhaustion routes to fail with a LIMIT_* code
 * and never falls back to any legacy executor.
 */
import { Command } from "@langchain/langgraph";
import Decimal from "decimal.js";
import {
  BUILTIN_TOOLS,
  clarification_request_v1_schema,
  finalize_request_v1_schema,
} from "../contracts";
import type {
  DecisionRecordV1,
  ProposedActionV1,
  RunErrorV1,
} from "../contracts";
import { build_run_event } from "../events";
import { hash_arguments } from "../hash";
import type {
  AgentLoopRuntime,
  LoopMessageV1,
  ModelTurnRequestV1,
  ModelTurnV1,
} from "../ports";
import { log_loop_event } from "../ports";
import type { AgentLoopStateType, AgentLoopStateUpdate } from "../state";
import {
  build_loop_messages,
  declared_tools,
  render_context_pack,
} from "./message-builder";

/**
 * Build a typed, safe run error for agent-node failures.
 *
 * @param runtime - Node runtime (for the correlation ID).
 * @param code - Stable error code.
 * @param safe_message - Client-safe failure description.
 * @returns RunErrorV1; the fail node may attach a safe partial output later.
 */
function agent_error(
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
 * Deterministically check every run budget BEFORE any model call.
 *
 * @param state - Current loop state (iteration, usage, budget, deadline).
 * @param runtime - Node runtime (clock and correlation).
 * @returns A LIMIT_* error when a budget is exhausted, otherwise null.
 */
export function check_budgets(
  state: AgentLoopStateType,
  runtime: AgentLoopRuntime,
): RunErrorV1 | null {
  if (state.iteration >= state.budget.max_iterations) {
    return agent_error(
      runtime,
      "LIMIT_MAX_ITERATIONS",
      "The run reached its iteration budget before completing.",
    );
  }
  if (runtime.ports.clock.now_ms() >= Date.parse(state.deadline_at)) {
    return agent_error(
      runtime,
      "LIMIT_DEADLINE",
      "The run reached its deadline before completing.",
    );
  }
  if (state.usage.tokens_used >= state.budget.max_total_tokens) {
    return agent_error(
      runtime,
      "LIMIT_TOKENS",
      "The run reached its token budget before completing.",
    );
  }
  if (
    new Decimal(state.usage.cost_usd_used).gte(
      new Decimal(state.budget.max_cost_usd),
    )
  ) {
    return agent_error(
      runtime,
      "LIMIT_COST",
      "The run reached its cost budget before completing.",
    );
  }
  return null;
}

/** Outcome of interpreting one model turn. */
type TurnInterpretation =
  | { readonly ok: true; readonly action: ProposedActionV1 }
  | { readonly ok: false; readonly violation: string };

/**
 * Interpret a native model turn into exactly one proposed action.
 *
 * @param turn - Assistant turn from the ModelGateway.
 * @param state - Current loop state (for the allowed tool set).
 * @param runtime - Node runtime (clarification bounds).
 * @returns A proposed action, or a violation description for one bounded retry.
 */
function interpret_turn(
  turn: ModelTurnV1,
  state: AgentLoopStateType,
  runtime: AgentLoopRuntime,
): TurnInterpretation {
  if (turn.tool_calls.length === 0 || turn.tool_calls.length > 8) {
    return {
      ok: false,
      violation:
        turn.tool_calls.length === 0
          ? "You must respond with exactly one tool call (use the finalize tool to answer)."
          : "A reasoning turn may propose at most 8 independent read-only tool calls.",
    };
  }
  if (turn.tool_calls.length > 1) {
    const actions = [];
    for (const call of turn.tool_calls) {
      if (
        call.tool_name === BUILTIN_TOOLS.request_clarification
        || call.tool_name === BUILTIN_TOOLS.finalize
        || !(call.tool_name in state.context_pack.tool_cards)
      ) {
        return {
          ok: false,
          violation:
            "Parallel calls may contain only declared catalogue tools; clarification and finalize must be proposed alone.",
        };
      }
      actions.push({
        kind: "tool" as const,
        call_id: call.call_id,
        tool_name: call.tool_name,
        arguments: call.arguments,
        arguments_hash: hash_arguments(call.arguments),
      });
    }
    return { ok: true, action: { kind: "tool_batch", actions } };
  }
  const call = turn.tool_calls[0]!;
  const arguments_hash = hash_arguments(call.arguments);

  if (call.tool_name === BUILTIN_TOOLS.request_clarification) {
    const parsed = clarification_request_v1_schema.safeParse(call.arguments);
    if (
      !parsed.success ||
      parsed.data.questions.length > runtime.config.max_clarification_questions
    ) {
      return {
        ok: false,
        violation: `request_clarification requires 1-${runtime.config.max_clarification_questions} non-empty questions.`,
      };
    }
    return {
      ok: true,
      action: {
        kind: "clarification",
        call_id: call.call_id,
        request: parsed.data,
        arguments_hash,
      },
    };
  }

  if (call.tool_name === BUILTIN_TOOLS.finalize) {
    const parsed = finalize_request_v1_schema.safeParse(call.arguments);
    if (!parsed.success) {
      return {
        ok: false,
        violation:
          "finalize requires { answer: string, citations?: Citation[], uncertainty?: string[] }.",
      };
    }
    return {
      ok: true,
      action: {
        kind: "finalize",
        call_id: call.call_id,
        request: parsed.data,
        arguments_hash,
      },
    };
  }

  if (!(call.tool_name in state.context_pack.tool_cards)) {
    return {
      ok: false,
      violation: `Unknown tool "${call.tool_name}". Only tools declared in this turn may be called.`,
    };
  }
  return {
    ok: true,
    action: {
      kind: "tool",
      call_id: call.call_id,
      tool_name: call.tool_name,
      arguments: call.arguments,
      arguments_hash,
    },
  };
}

/**
 * Append a corrective instruction after a malformed turn for the single
 * bounded retry. The correction is system-authored, not model-authored.
 *
 * @param request - Original turn request.
 * @param violation - Safe description of the violation.
 * @returns New request with one extra corrective user message.
 */
function with_correction(
  request: ModelTurnRequestV1,
  violation: string,
): ModelTurnRequestV1 {
  const correction: LoopMessageV1 = {
    role: "user",
    content: `[orchestrator] Your previous response was invalid: ${violation}`,
    tool_call_id: null,
  };
  return { ...request, messages: [...request.messages, correction] };
}

/**
 * Accumulate model-turn usage into the run's usage counters.
 *
 * @param state - Current loop state.
 * @param turns - Model turns consumed this node execution (including retries).
 * @returns Updated usage counters with decimal-safe cost accumulation.
 */
function accumulate_usage(
  state: AgentLoopStateType,
  turns: readonly ModelTurnV1[],
) {
  let input_tokens = state.usage.input_tokens;
  let output_tokens = state.usage.output_tokens;
  let cost = new Decimal(state.usage.cost_usd_used);
  for (const turn of turns) {
    input_tokens += turn.usage.input_tokens;
    output_tokens += turn.usage.output_tokens;
    cost = cost.plus(new Decimal(turn.usage.cost_usd));
  }
  return {
    model_calls: state.usage.model_calls + turns.length,
    tool_calls: state.usage.tool_calls,
    input_tokens,
    output_tokens,
    tokens_used: input_tokens + output_tokens,
    cost_usd_used: cost.toString(),
  };
}

/**
 * Derive the audit decision record from the model's native tool call.
 *
 * @param action - Interpreted proposed action.
 * @param iteration - Iteration this decision belongs to.
 * @param rationale - Assistant text accompanying the call (safe summary only).
 * @param occurred_at - Deterministic decision timestamp.
 * @returns DecisionRecordV1 for the decision log and audit events.
 */
function derive_decision_record(
  action: ProposedActionV1,
  iteration: number,
  rationale: string | null,
  occurred_at: string,
): DecisionRecordV1 {
  const public_summary = rationale?.trim() || (
    action.kind === "tool"
      ? `Use ${action.tool_name} because the current request needs governed evidence or an authorized action.`
      : action.kind === "tool_batch"
        ? `Run ${action.actions.length} independent governed evidence lookups in parallel.`
      : action.kind === "clarification"
        ? "Ask for the missing information needed to choose a reliable next action."
        : "Finalize because the available conversation context and observations are sufficient to answer."
  );
  return {
    iteration,
    kind:
      action.kind === "tool" || action.kind === "tool_batch"
        ? "tool"
        : action.kind === "clarification"
          ? "clarify"
          : "finalize",
    tool_name: action.kind === "tool" ? action.tool_name : null,
    arguments_hash: action.kind === "tool_batch"
      ? hash_arguments(action.actions.map((item) => item.arguments_hash))
      : action.arguments_hash,
    rationale_summary: public_summary.slice(0, 600),
    occurred_at,
  };
}

/**
 * Execute one reasoning turn: budget checks, one model call (with a single
 * bounded retry on malformed output), decision derivation, and routing.
 *
 * @param state - Current loop state.
 * @param runtime - Injected ports, policy, trusted context, and config.
 * @returns Command routing to gate, request_clarification, finalize, or fail.
 */
export async function agent(
  state: AgentLoopStateType,
  runtime: AgentLoopRuntime,
): Promise<Command> {
  log_loop_event(runtime, "info", "agent.start", {
    iteration: state.iteration,
  });

  if (state.error) {
    log_loop_event(runtime, "warn", "agent.carrying_error", {
      code: state.error.code,
    });
    return new Command({ goto: "fail" });
  }

  const budget_stop = check_budgets(state, runtime);
  if (budget_stop) {
    log_loop_event(runtime, "warn", "agent.budget_exhausted", {
      code: budget_stop.code,
    });
    return new Command({ goto: "fail", update: { error: budget_stop } });
  }

  const base_request: ModelTurnRequestV1 = {
    system: render_context_pack(state.context_pack),
    messages: build_loop_messages(state),
    tools: declared_tools(state.context_pack),
  };

  const consumed_turns: ModelTurnV1[] = [];
  let model_latency_ms = 0;
  let request = base_request;
  let last_violation = "no valid tool call";
  const max_attempts = 1 + runtime.config.max_model_retries;

  for (let attempt = 1; attempt <= max_attempts; attempt += 1) {
    const model_started_ms = runtime.ports.clock.now_ms();
    const turn = await runtime.ports.model.complete_turn(
      request,
      runtime.context,
    );
    model_latency_ms += Math.max(
      0,
      runtime.ports.clock.now_ms() - model_started_ms,
    );
    consumed_turns.push(turn);
    const interpretation = interpret_turn(turn, state, runtime);
    if (!interpretation.ok) {
      last_violation = interpretation.violation;
      log_loop_event(runtime, "warn", "agent.invalid_turn", {
        attempt,
        violation: interpretation.violation,
      });
      request = with_correction(base_request, interpretation.violation);
      continue;
    }

    const iteration = state.iteration + 1;
    const occurred_at = runtime.ports.clock.now_iso();
    const usage = accumulate_usage(state, consumed_turns);
    const sources = { clock: runtime.ports.clock, ids: runtime.ports.ids };
    const stage =
      interpretation.action.kind === "tool" || interpretation.action.kind === "tool_batch"
        ? "acting"
        : interpretation.action.kind === "clarification"
          ? "waiting_user"
          : "finalizing";
    const goto =
      interpretation.action.kind === "tool" || interpretation.action.kind === "tool_batch"
        ? "gate"
        : interpretation.action.kind === "clarification"
          ? "request_clarification"
          : "finalize";
    const decisions = interpretation.action.kind === "tool_batch"
      ? interpretation.action.actions.map((action) =>
          derive_decision_record(action, iteration, turn.content, occurred_at))
      : [derive_decision_record(
          interpretation.action,
          iteration,
          turn.content,
          occurred_at,
        )];
    const decision_events = decisions.map((record, index) =>
      build_run_event(state, sources, index, "decision.recorded", {
        iteration: record.iteration,
        kind: record.kind,
        tool_name: record.tool_name,
        arguments_hash: record.arguments_hash,
        rationale_summary: record.rationale_summary,
      }));
    decision_events.push(
      build_run_event(state, sources, decisions.length, "stage.changed", { stage }),
      build_run_event(state, sources, decisions.length + 1, "usage.updated", {
        model_calls: usage.model_calls,
        tool_calls: usage.tool_calls,
        tokens_used: usage.tokens_used,
        cost_usd_used: usage.cost_usd_used,
        model_latency_ms,
      }),
    );
    if (interpretation.action.kind === "clarification") {
      decision_events.push(build_run_event(state, sources, decisions.length + 2, "clarification.required", {
        questions: interpretation.action.request.questions,
      }));
    }
    const update: AgentLoopStateUpdate = {
      iteration,
      usage,
      pending_action: interpretation.action,
      decision_log: decisions,
      events: decision_events,
    };
    log_loop_event(runtime, "info", "agent.finish", {
      iteration,
      kind: interpretation.action.kind,
      goto,
      model_latency_ms,
      message_count: base_request.messages.length,
      message_characters: base_request.messages.reduce(
        (total, message) => total + message.content.length,
        0,
      ),
      system_characters: base_request.system.length,
    });
    return new Command({ goto, update });
  }

  log_loop_event(runtime, "error", "agent.model_output_invalid", {
    attempts: max_attempts,
  });
  return new Command({
    goto: "fail",
    update: {
      usage: accumulate_usage(state, consumed_turns),
      error: agent_error(
        runtime,
        "MODEL_OUTPUT_INVALID",
        `The model did not produce a valid action after ${max_attempts} attempts: ${last_violation}`,
      ),
    },
  });
}
