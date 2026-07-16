/**
 * Versioned run-event view reducer (G4.10, core).
 *
 * A pure, framework-free state machine that folds the server's ordered
 * `AgentRunEventV1` stream into the view state the AI UI renders — progress,
 * evidence, questions, approvals, artifacts, and terminal outcome — WITHOUT ever
 * parsing model prose for control state. Every event is applied at most once
 * (strictly increasing `sequence`), so a reconnect that replays earlier events
 * is idempotent. The React hook and components that consume this land with the
 * run/event API (G4.9); this reducer is independently unit-tested here.
 */

import {
  agent_run_event_v1_schema,
  type AgentRunEventV1,
  type AgentRunOutputV1,
  type RunErrorCodeV1,
  type RunStageV1,
} from "@rnd-ai/shared-types/src/ai/contracts";

/** Lifecycle status derived purely from typed events. */
export type RunViewStatus = "pending" | "running" | "completed" | "failed";

/** One tool action the run has attempted, with its live status. */
export interface RunActionView {
  readonly action_id: string;
  readonly tool_name: string;
  readonly status: "running" | "ok" | "error" | "denied";
}

/** One safe, typed decision summary suitable for the activity trail. */
export interface RunDecisionView {
  readonly iteration: number;
  readonly kind: "tool" | "clarify" | "finalize";
  readonly tool_name: string | null;
  readonly rationale_summary: string;
}

/** Latest public usage counters emitted for a live run. */
export interface RunUsageView {
  readonly model_calls: number;
  readonly tool_calls: number;
  readonly tokens_used: number;
  readonly cost_usd_used: string;
}

/** One normalized observation reference surfaced as evidence. */
export interface RunObservationView {
  readonly observation_id: string;
  readonly observation_type: string;
  readonly trust: "trusted_system" | "trusted_user" | "untrusted_content";
  readonly source_kind: "user" | "tool" | "system" | "knowledge";
  readonly tool_name: string | null;
}

/** One produced artifact reference (latest version wins). */
export interface RunArtifactView {
  readonly artifact_id: string;
  readonly artifact_type: "formula";
  readonly version: number;
}

/** A pending human interrupt awaiting the user's answer. */
export interface RunApprovalView {
  readonly approval_id: string;
  readonly summary: string;
  readonly tool_name: string;
}

/** The immutable view state the UI renders for one run. */
export interface AgentRunViewState {
  readonly last_sequence: number;
  readonly status: RunViewStatus;
  readonly stage: RunStageV1 | null;
  readonly observations: readonly RunObservationView[];
  readonly decisions: readonly RunDecisionView[];
  readonly actions: readonly RunActionView[];
  readonly pending_clarification: readonly string[] | null;
  readonly pending_approval: RunApprovalView | null;
  readonly artifacts: readonly RunArtifactView[];
  readonly usage: RunUsageView | null;
  readonly output: AgentRunOutputV1 | null;
  readonly error: { readonly code: RunErrorCodeV1; readonly safe_message: string; readonly retryable: boolean } | null;
}

/** The view state before any event has been applied. */
export const initial_agent_run_view_state: AgentRunViewState = Object.freeze({
  last_sequence: -1,
  status: "pending",
  stage: null,
  observations: [],
  decisions: [],
  actions: [],
  pending_clarification: null,
  pending_approval: null,
  artifacts: [],
  usage: null,
  output: null,
  error: null,
});

/**
 * Apply one already-validated, in-order event to the view state.
 *
 * @param state - Current view state.
 * @param event - The typed run event to apply (sequence > last_sequence).
 * @returns The next immutable view state.
 */
export function apply_typed_run_event(
  state: AgentRunViewState,
  event: AgentRunEventV1,
): AgentRunViewState {
  const base = { ...state, last_sequence: event.sequence };
  switch (event.type) {
    case "run.accepted":
      return { ...base, status: "running" };
    case "stage.changed":
      return { ...base, stage: event.payload.stage };
    case "observation.added": {
      if (state.observations.some((o) => o.observation_id === event.payload.observation_id)) {
        return base;
      }
      return {
        ...base,
        observations: [
          ...state.observations,
          {
            observation_id: event.payload.observation_id,
            observation_type: event.payload.observation_type,
            trust: event.payload.trust,
            source_kind: event.payload.source_kind,
            tool_name: event.payload.tool_name,
          },
        ],
      };
    }
    case "decision.recorded":
      return {
        ...base,
        decisions: [
          ...state.decisions,
          {
            iteration: event.payload.iteration,
            kind: event.payload.kind,
            tool_name: event.payload.tool_name,
            rationale_summary: event.payload.rationale_summary,
          },
        ],
      };
    case "action.started":
      return {
        ...base,
        // The loop resumed and is acting: any pending interrupt is resolved.
        pending_clarification: null,
        pending_approval: null,
        actions: [
          ...state.actions,
          { action_id: event.payload.action_id, tool_name: event.payload.tool_name, status: "running" },
        ],
      };
    case "action.completed":
      return {
        ...base,
        actions: state.actions.map((action) =>
          action.action_id === event.payload.action_id
            ? { ...action, status: event.payload.status }
            : action,
        ),
      };
    case "clarification.required":
      return { ...base, pending_clarification: [...event.payload.questions] };
    case "approval.required":
      return {
        ...base,
        pending_approval: {
          approval_id: event.payload.approval_id,
          summary: event.payload.summary,
          tool_name: event.payload.tool_name,
        },
      };
    case "artifact.updated": {
      const others = state.artifacts.filter((a) => a.artifact_id !== event.payload.artifact_id);
      return {
        ...base,
        artifacts: [
          ...others,
          {
            artifact_id: event.payload.artifact_id,
            artifact_type: event.payload.artifact_type,
            version: event.payload.version,
          },
        ],
      };
    }
    case "usage.updated":
      return {
        ...base,
        usage: {
          model_calls: event.payload.model_calls,
          tool_calls: event.payload.tool_calls,
          tokens_used: event.payload.tokens_used,
          cost_usd_used: event.payload.cost_usd_used,
        },
      };
    case "run.completed":
      return {
        ...base,
        status: "completed",
        pending_clarification: null,
        pending_approval: null,
        output: event.payload.output ?? state.output,
      };
    case "run.failed":
      return {
        ...base,
        status: "failed",
        pending_clarification: null,
        pending_approval: null,
        error: {
          code: event.payload.code,
          safe_message: event.payload.safe_message,
          retryable: event.payload.retryable,
        },
      };
    default:
      return base;
  }
}

/**
 * Fold one raw wire event into the view state: validate it, drop stale/replayed
 * events (sequence already seen), then apply the typed transition.
 *
 * @param state - Current view state.
 * @param raw - The raw event payload from the SSE stream (untrusted shape).
 * @returns The next view state; unchanged for a stale or malformed event.
 */
export function reduce_run_event(
  state: AgentRunViewState,
  raw: unknown,
): AgentRunViewState {
  const parsed = agent_run_event_v1_schema.safeParse(raw);
  if (!parsed.success) return state;
  if (parsed.data.sequence <= state.last_sequence) return state;
  return apply_typed_run_event(state, parsed.data);
}
