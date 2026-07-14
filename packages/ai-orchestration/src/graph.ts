/**
 * The governed agentic loop graph shell.
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
 * Tasks 1-5 ship typed stubs for request_clarification / request_approval /
 * finalize; durable interrupts land in plan Task 7 and artifact-validated
 * finalize in plan Task 8.
 */
import { Command, END, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { AgentLoopRuntime } from "./ports";
import { log_loop_event } from "./ports";
import { AgentLoopState } from "./state";
import type { AgentLoopStateType, AgentLoopStateUpdate } from "./state";

/**
 * Typed stub for the ingress node (implemented in plan Task 4).
 *
 * @param _state - Current loop state.
 * @returns Empty typed update.
 */
async function ingress_stub(
  _state: AgentLoopStateType,
): Promise<AgentLoopStateUpdate> {
  return {};
}

/**
 * Typed stub for the agent reasoning node (implemented in plan Task 4).
 *
 * @param _state - Current loop state.
 * @returns Command routing to finalize so the stub loop can terminate.
 */
async function agent_stub(_state: AgentLoopStateType): Promise<Command> {
  return new Command({ goto: "finalize" });
}

/**
 * Typed stub for the gate node (implemented in plan Task 5).
 *
 * @param _state - Current loop state.
 * @returns Command routing to act.
 */
async function gate_stub(_state: AgentLoopStateType): Promise<Command> {
  return new Command({ goto: "act" });
}

/**
 * Typed stub for the act node (implemented in plan Task 5).
 *
 * @param _state - Current loop state.
 * @returns Empty typed update (act -> agent is a fixed edge).
 */
async function act_stub(
  _state: AgentLoopStateType,
): Promise<AgentLoopStateUpdate> {
  return {};
}

/**
 * Typed stub for the clarification interrupt node (plan Task 7).
 *
 * @param _state - Current loop state.
 * @returns Empty typed update (fixed edge returns to agent).
 */
async function request_clarification_stub(
  _state: AgentLoopStateType,
): Promise<AgentLoopStateUpdate> {
  return {};
}

/**
 * Typed stub for the approval interrupt node (plan Task 7).
 *
 * @param _state - Current loop state.
 * @returns Empty typed update (fixed edge returns to gate).
 */
async function request_approval_stub(
  _state: AgentLoopStateType,
): Promise<AgentLoopStateUpdate> {
  return {};
}

/**
 * Typed stub for the finalize node (deterministic validators land in Task 8).
 *
 * @param _state - Current loop state.
 * @returns Empty typed update.
 */
async function finalize_stub(
  _state: AgentLoopStateType,
): Promise<AgentLoopStateUpdate> {
  return {};
}

/**
 * Typed stub for the fail node (implemented in plan Task 5).
 *
 * @param _state - Current loop state.
 * @returns Empty typed update.
 */
async function fail_stub(
  _state: AgentLoopStateType,
): Promise<AgentLoopStateUpdate> {
  return {};
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
    .addNode("ingress", ingress_stub)
    .addNode("agent", agent_stub, {
      ends: ["gate", "request_clarification", "finalize", "fail"],
    })
    .addNode("gate", gate_stub, {
      ends: ["act", "request_approval", "agent", "fail"],
    })
    .addNode("act", act_stub)
    .addNode("request_clarification", request_clarification_stub)
    .addNode("request_approval", request_approval_stub)
    .addNode("finalize", finalize_stub)
    .addNode("fail", fail_stub)
    .addEdge(START, "ingress")
    .addEdge("ingress", "agent")
    .addEdge("act", "agent")
    .addEdge("request_clarification", "agent")
    .addEdge("request_approval", "gate")
    .addEdge("finalize", END)
    .addEdge("fail", END);
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
