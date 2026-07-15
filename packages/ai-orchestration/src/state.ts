/**
 * AgentLoopState: the durable channel set of the governed agentic loop.
 *
 * There is deliberately NO phase channel — OODA is emergent loop behavior,
 * not graph topology; UI stage display derives from typed events. Channels
 * hold IDs, version pins, counters, and normalized records only: no provider
 * credentials, no raw Clerk token, no hidden reasoning.
 */
import { Annotation } from "@langchain/langgraph";
import type {
  ActionResultV1,
  AgentRunEventV1,
  AgentRunInputV1,
  AgentRunOutputV1,
  ApprovalResultV1,
  DecisionRecordV1,
  LoopUsageV1,
  ProposedActionV1,
  RunBudgetV1,
  RunErrorV1,
  RunPinsV1,
} from "./contracts";
import { empty_loop_usage } from "./contracts";
import type { ContextPackV1 } from "./context/context-pack";
import type { ObservationV1 } from "./schemas/observation";

/**
 * Append-only reducer channel factory.
 *
 * @returns Annotation whose updates concatenate onto the existing list.
 */
function appending<T>() {
  return Annotation<T[]>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  });
}

/**
 * Replaceable nullable channel factory (last write wins, default null).
 *
 * @returns Annotation whose updates replace the previous value.
 */
function replaceable<T>() {
  return Annotation<T | null>({
    reducer: (_current, update) => update,
    default: () => null,
  });
}

export const AgentLoopState = Annotation.Root({
  run_id: Annotation<string>,
  thread_id: Annotation<string>,
  tenant_id: Annotation<string>,
  actor_profile_id: Annotation<string>,
  agent_key: Annotation<string>,
  input: Annotation<AgentRunInputV1>,
  context_pack: Annotation<ContextPackV1>,
  pins: Annotation<RunPinsV1>,
  iteration: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
  started_at: Annotation<string>,
  deadline_at: Annotation<string>,
  budget: Annotation<RunBudgetV1>,
  usage: Annotation<LoopUsageV1>({
    reducer: (_current, update) => update,
    default: () => empty_loop_usage,
  }),
  observations: appending<ObservationV1>(),
  action_results: appending<ActionResultV1>(),
  decision_log: appending<DecisionRecordV1>(),
  events: appending<AgentRunEventV1>(),
  warnings: appending<string>(),
  pending_action: replaceable<ProposedActionV1>(),
  approval_result: replaceable<ApprovalResultV1>(),
  output: replaceable<AgentRunOutputV1>(),
  error: replaceable<RunErrorV1>(),
});

/** Materialized state type consumed by every node. */
export type AgentLoopStateType = typeof AgentLoopState.State;

/** Partial state update returned by nodes. */
export type AgentLoopStateUpdate = typeof AgentLoopState.Update;

/** Arguments for constructing the initial loop state at run start. */
export interface InitialLoopStateArgs {
  readonly run_id: string;
  readonly thread_id: string;
  readonly tenant_id: string;
  readonly actor_profile_id: string;
  readonly input: AgentRunInputV1;
  readonly context_pack: ContextPackV1;
  readonly pins: RunPinsV1;
  readonly budget: RunBudgetV1;
  readonly started_at: string;
  readonly deadline_at: string;
}

/**
 * Build the initial graph input for one run from gateway-resolved values.
 *
 * @param args - Identifiers, validated input, pinned context pack, pins,
 *               budget, and the deterministic start/deadline timestamps.
 * @returns Initial state accepted by the compiled loop graph.
 */
export function build_initial_loop_state(
  args: InitialLoopStateArgs,
): AgentLoopStateUpdate {
  return {
    run_id: args.run_id,
    thread_id: args.thread_id,
    tenant_id: args.tenant_id,
    actor_profile_id: args.actor_profile_id,
    agent_key: args.input.agent_key,
    input: args.input,
    context_pack: args.context_pack,
    pins: args.pins,
    iteration: 0,
    started_at: args.started_at,
    deadline_at: args.deadline_at,
    budget: args.budget,
    usage: empty_loop_usage,
    observations: [],
    action_results: [],
    decision_log: [],
    events: [],
    warnings: [],
    pending_action: null,
    approval_result: null,
    output: null,
    error: null,
  };
}
