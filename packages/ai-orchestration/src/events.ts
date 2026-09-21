/**
 * Typed run-event construction shared by every loop node.
 *
 * Every event is schema-validated at construction so an invalid payload can
 * never reach the event store or the UI stream.
 */
import { agent_run_event_v1_schema } from "./contracts";
import type { AgentRunEventV1 } from "./contracts";
import type { Clock, IdGenerator } from "./ports";

/** Minimal state slice needed to sequence a new event. */
export interface EventStateSlice {
  readonly run_id: string;
  readonly events: readonly AgentRunEventV1[];
}

/** Deterministic sources for event identity and time. */
export interface EventSources {
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/**
 * Build one validated run event with the next sequence number.
 *
 * @param state - Current run/event slice used for run_id and sequencing.
 * @param sources - Injected clock and ID generator.
 * @param offset - How many events this node has already appended this turn,
 *                 so a node emitting several events keeps sequences contiguous.
 * @param type - Event discriminator (one of the 12 typed events).
 * @param payload - Type-specific safe payload.
 * @returns Schema-validated AgentRunEventV1.
 * @throws ZodError when the payload violates the event contract (fail closed).
 */
export function build_run_event(
  state: EventStateSlice,
  sources: EventSources,
  offset: number,
  type: AgentRunEventV1["type"],
  payload: unknown,
): AgentRunEventV1 {
  return agent_run_event_v1_schema.parse({
    schema_version: "1",
    event_id: sources.ids.next_id(),
    run_id: state.run_id,
    sequence: state.events.length + offset,
    occurred_at: sources.clock.now_iso(),
    type,
    payload,
  });
}
