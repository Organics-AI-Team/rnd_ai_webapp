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
 *   finalize -> END (or -> agent when a blocking validation still has budget)
 *   fail -> END
 *
 * finalize authoritatively validates any produced artifact and, while budget
 * remains, routes a blocking validation back to the agent as an observation.
 */
import { Command, END, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { agent } from "./nodes/agent";
import { act } from "./nodes/act";
import { fail } from "./nodes/fail";
import { finalize } from "./nodes/finalize";
import { gate } from "./nodes/gate";
import { ingress } from "./nodes/ingress";
import { request_approval } from "./nodes/request-approval";
import { request_clarification } from "./nodes/request-clarification";
import type { AgentLoopRuntime } from "./ports";
import { log_loop_event } from "./ports";
import { LOOP_NODE } from "./routing";
import { AgentLoopState } from "./state";
import type { AgentLoopStateType } from "./state";

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
    .addNode(
      LOOP_NODE.finalize,
      (state: AgentLoopStateType) => finalize(state, runtime),
      { ends: ["agent"] },
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
