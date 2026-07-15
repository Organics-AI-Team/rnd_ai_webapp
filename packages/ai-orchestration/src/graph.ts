/**
 * The governed agentic loop graph.
 *
 * Exactly one reasoning node (`agent`) may call the ModelGateway; every other
 * node is deterministic code. LangGraph is used for durability (checkpoints,
 * interrupts, streaming, replay) — not flow control. The graph can never
 * switch to a legacy executor during a run.
 *
 * Topology:
 *   START -> ingress -> agent
 *   agent -> { gate, request_clarification, finalize, fail }
 *   gate  -> { act, request_approval, agent (typed denial), fail (loop trip) }
 *   act -> agent; request_clarification -> agent; request_approval -> gate
 *   finalize -> END; fail -> END
 *
 * request_clarification / request_approval are typed stubs until durable
 * interrupts land in plan Task 7; finalize is a deterministic minimal
 * implementation until full artifact validators land in plan Task 8.
 */
import { Command, END, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { build_run_event } from "./events";
import { agent } from "./nodes/agent";
import { act } from "./nodes/act";
import { fail } from "./nodes/fail";
import { gate } from "./nodes/gate";
import { ingress } from "./nodes/ingress";
import { request_approval } from "./nodes/request-approval";
import { request_clarification } from "./nodes/request-clarification";
import { build_output_document } from "./output";
import type { AgentLoopRuntime } from "./ports";
import { log_loop_event } from "./ports";
import { LOOP_NODE, build_run_error } from "./routing";
import { AgentLoopState } from "./state";
import type { AgentLoopStateType, AgentLoopStateUpdate } from "./state";

/**
 * Interim deterministic finalize: builds a schema-validated output from the
 * model's finalize proposal, records completion, and reconciles usage.
 * Plan Task 8 replaces this with artifact validators, evidence-coverage
 * checks, and computed quality dimensions.
 *
 * @param state - Current loop state carrying the finalize proposal.
 * @param runtime - Injected ports and trusted context.
 * @returns State update with the validated output and run.completed event,
 *          or a typed error update on an invariant violation.
 */
async function finalize_minimal(
  state: AgentLoopStateType,
  runtime: AgentLoopRuntime,
): Promise<AgentLoopStateUpdate> {
  log_loop_event(runtime, "info", "finalize.start");
  const action = state.pending_action;
  if (!action || action.kind !== "finalize") {
    log_loop_event(runtime, "error", "finalize.missing_request");
    return {
      error: build_run_error(
        runtime,
        "ORCHESTRATOR_INVARIANT_VIOLATION",
        "Finalize was reached without a finalize proposal.",
      ),
    };
  }
  const output = build_output_document(state, runtime, {
    status: "completed",
    answer: action.request.answer,
    citations: action.request.citations,
    uncertainty: action.request.uncertainty,
  });
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
  await runtime.ports.runs.mark_completed(
    state.run_id,
    output,
    runtime.context,
  );
  const events = [
    build_run_event(
      state,
      { clock: runtime.ports.clock, ids: runtime.ports.ids },
      0,
      "run.completed",
      { status: "completed", output_schema_version: "1" },
    ),
  ];
  log_loop_event(runtime, "info", "finalize.finish");
  return { output, pending_action: null, events };
}

/**
 * Build the uncompiled governed-loop StateGraph with the exact topology.
 *
 * @param runtime - Injected ports, policy, trusted context, and config; the
 *                  runtime is bound per run by the gateway, never global.
 * @returns StateGraph wired with the loop nodes and allowed edges only.
 */
export function build_agent_loop_graph(runtime: AgentLoopRuntime) {
  log_loop_event(runtime, "debug", "graph.build.start");
  const graph = new StateGraph(AgentLoopState)
    .addNode(LOOP_NODE.ingress, (state: AgentLoopStateType) =>
      ingress(state, runtime),
    )
    .addNode(
      LOOP_NODE.agent,
      (state: AgentLoopStateType): Promise<Command> => agent(state, runtime),
      { ends: ["gate", "request_clarification", "finalize", "fail"] },
    )
    .addNode(
      LOOP_NODE.gate,
      (state: AgentLoopStateType): Promise<Command> => gate(state, runtime),
      { ends: ["act", "request_approval", "agent", "fail"] },
    )
    .addNode(LOOP_NODE.act, (state: AgentLoopStateType) => act(state, runtime))
    .addNode(LOOP_NODE.request_clarification, (state: AgentLoopStateType) =>
      request_clarification(state, runtime),
    )
    .addNode(LOOP_NODE.request_approval, (state: AgentLoopStateType) =>
      request_approval(state, runtime),
    )
    .addNode(LOOP_NODE.finalize, (state: AgentLoopStateType) =>
      finalize_minimal(state, runtime),
    )
    .addNode(LOOP_NODE.fail, (state: AgentLoopStateType) =>
      fail(state, runtime),
    )
    .addEdge(START, LOOP_NODE.ingress)
    .addEdge(LOOP_NODE.ingress, LOOP_NODE.agent)
    .addEdge(LOOP_NODE.act, LOOP_NODE.agent)
    .addEdge(LOOP_NODE.request_clarification, LOOP_NODE.agent)
    .addEdge(LOOP_NODE.request_approval, LOOP_NODE.gate)
    .addEdge(LOOP_NODE.finalize, END)
    .addEdge(LOOP_NODE.fail, END);
  log_loop_event(runtime, "debug", "graph.build.finish");
  return graph;
}

/**
 * Compile the governed loop graph, optionally with a durable checkpointer.
 *
 * @param runtime - Injected ports, policy, trusted context, and config.
 * @param checkpointer - Optional saver (MongoDBSaver in production, plan Task 7).
 * @returns Compiled graph ready for invoke/stream.
 */
export function compile_agent_loop_graph(
  runtime: AgentLoopRuntime,
  checkpointer?: BaseCheckpointSaver,
) {
  return build_agent_loop_graph(runtime).compile(
    checkpointer ? { checkpointer } : undefined,
  );
}
