/**
 * G4.10 (core) — versioned run-event view reducer.
 *
 * Proves the UI derives progress, evidence, interrupts, artifacts, and terminal
 * state purely from typed AgentRunEventV1 events, and that a reconnect replaying
 * earlier events is idempotent (each event renders once). The live SSE hook and
 * React components land with the run/event API (G4.9).
 */

import { describe, expect, it } from "vitest";

import {
  apply_typed_run_event,
  initial_agent_run_view_state,
  reduce_run_event,
  type AgentRunViewState,
} from "../../apps/web/lib/agent_run_view";

/**
 * Build a raw wire event with the given sequence, type, and payload.
 *
 * @param sequence - Monotonic sequence number.
 * @param type - Event discriminator.
 * @param payload - Type-specific payload.
 * @returns A raw event object shaped like the SSE wire format.
 */
function evt(sequence: number, type: string, payload: unknown): unknown {
  return {
    schema_version: "1",
    event_id: `evt_${sequence}`,
    run_id: "run_1",
    sequence,
    occurred_at: "2026-07-15T00:00:00.000Z",
    type,
    payload,
  };
}

const HASH = "a".repeat(64);

/** Fold a list of raw events from the initial state. */
function fold(events: readonly unknown[]): AgentRunViewState {
  return events.reduce<AgentRunViewState>(
    (state, event) => reduce_run_event(state, event),
    initial_agent_run_view_state,
  );
}

const HAPPY_PATH: readonly unknown[] = [
  evt(0, "run.accepted", { agent_key: "formulation", context_pack_hash: HASH, orchestrator_version: "1.0.0" }),
  evt(1, "stage.changed", { stage: "thinking" }),
  evt(2, "observation.added", {
    observation_id: "obs_1",
    observation_type: "tool_result",
    trust: "trusted_system",
    source_kind: "tool",
    tool_name: "knowledge.search",
    content_hash: HASH,
  }),
  evt(3, "action.started", { action_id: "act_1", tool_name: "formula.draft", iteration: 1 }),
  evt(4, "action.completed", { action_id: "act_1", tool_name: "formula.draft", status: "ok", latency_ms: 20, cost_usd: "0.0003" }),
  evt(5, "artifact.updated", { artifact_id: "artf_1", artifact_type: "formula", version: 1 }),
  evt(6, "run.completed", { status: "completed", output_schema_version: "1" }),
];

describe("reduce_run_event", () => {
  it("folds a full run into completed view state", () => {
    const state = fold(HAPPY_PATH);
    expect(state.status).toBe("completed");
    expect(state.stage).toBe("thinking");
    expect(state.last_sequence).toBe(6);
    expect(state.observations).toHaveLength(1);
    expect(state.actions).toEqual([{ action_id: "act_1", tool_name: "formula.draft", status: "ok" }]);
    expect(state.artifacts).toEqual([{ artifact_id: "artf_1", artifact_type: "formula", version: 1 }]);
    expect(state.pending_approval).toBeNull();
    expect(state.error).toBeNull();
  });

  it("renders each event once — replayed earlier events do not double-apply", () => {
    const state = fold(HAPPY_PATH);
    // A reconnect replays observation (seq 2) and stage (seq 1); both are stale.
    let replayed = reduce_run_event(state, HAPPY_PATH[2]);
    replayed = reduce_run_event(replayed, HAPPY_PATH[1]);
    expect(replayed.observations).toHaveLength(1);
    expect(replayed.last_sequence).toBe(6);
    expect(replayed.status).toBe("completed");
  });

  it("ignores a duplicate observation id within a single stream", () => {
    const state = fold([
      HAPPY_PATH[0],
      evt(1, "observation.added", {
        observation_id: "obs_dup",
        observation_type: "tool_result",
        trust: "trusted_system",
        source_kind: "tool",
        tool_name: "x",
        content_hash: HASH,
      }),
      evt(2, "observation.added", {
        observation_id: "obs_dup",
        observation_type: "tool_result",
        trust: "trusted_system",
        source_kind: "tool",
        tool_name: "x",
        content_hash: HASH,
      }),
    ]);
    expect(state.observations).toHaveLength(1);
    expect(state.last_sequence).toBe(2);
  });

  it("surfaces a pending approval, then clears it when the loop resumes", () => {
    const paused = fold([
      HAPPY_PATH[0],
      evt(1, "approval.required", { approval_id: "apr_1", summary: "Confirm the formula", tool_name: "formula.confirm" }),
    ]);
    expect(paused.pending_approval).toEqual({ approval_id: "apr_1", summary: "Confirm the formula", tool_name: "formula.confirm" });
    const resumed = reduce_run_event(paused, evt(2, "action.started", { action_id: "act_9", tool_name: "formula.confirm", iteration: 2 }));
    expect(resumed.pending_approval).toBeNull();
  });

  it("surfaces pending clarification questions", () => {
    const state = fold([
      HAPPY_PATH[0],
      evt(1, "clarification.required", { questions: ["What skin type?", "What budget?"] }),
    ]);
    expect(state.pending_clarification).toEqual(["What skin type?", "What budget?"]);
  });

  it("records a terminal failure", () => {
    const state = fold([
      HAPPY_PATH[0],
      evt(1, "run.failed", { code: "LIMIT_MAX_ITERATIONS", safe_message: "Too many steps.", retryable: false }),
    ]);
    expect(state.status).toBe("failed");
    expect(state.error).toEqual({ code: "LIMIT_MAX_ITERATIONS", safe_message: "Too many steps.", retryable: false });
  });

  it("records typed decisions and usage for the activity trail", () => {
    const state = fold([
      HAPPY_PATH[0],
      evt(1, "decision.recorded", {
        iteration: 1,
        kind: "tool",
        tool_name: "knowledge.search",
        arguments_hash: HASH,
        rationale_summary: "Find source-backed material evidence.",
      }),
      evt(2, "usage.updated", {
        model_calls: 1,
        tool_calls: 1,
        tokens_used: 120,
        cost_usd_used: "0.004",
      }),
    ]);
    expect(state.decisions).toEqual([
      {
        iteration: 1,
        kind: "tool",
        tool_name: "knowledge.search",
        rationale_summary: "Find source-backed material evidence.",
      },
    ]);
    expect(state.usage).toEqual({
      model_calls: 1,
      tool_calls: 1,
      tokens_used: 120,
      cost_usd_used: "0.004",
    });
  });

  it("retains the typed terminal output for answer and citation rendering", () => {
    const output = {
      schema_version: "1" as const,
      run_id: "run_1",
      status: "completed" as const,
      answer: "Niacinamide is supported by the cited material record.",
      decision_summary: {
        facts_considered: ["The material record is current."],
        evidence_references: ["material:rm_1"],
        action_rationales: [],
        validation_results: [],
        uncertainty: [],
      },
      citations: [{
        source_id: "rm_1",
        source_type: "material" as const,
        reference: "/raw-materials/rm_1",
        retrieved_at: "2026-07-16T00:00:00.000Z",
      }],
      artifacts: [],
      quality_dimensions: {
        groundedness: 1,
        evidence_coverage: 1,
        source_quality: 1,
        source_freshness_days: 0,
        contradiction_state: "none" as const,
        validation_rate: 1,
        completeness: 1,
        risk_severity: "none" as const,
      },
      warnings: [],
      usage_summary: {
        model_calls: 1,
        tool_calls: 1,
        input_tokens: 10,
        output_tokens: 10,
        total_tokens: 20,
        cost_usd: "0.001",
      },
      started_at: "2026-07-16T00:00:00.000Z",
      completed_at: "2026-07-16T00:00:01.000Z",
    };
    const state = fold([
      HAPPY_PATH[0],
      evt(1, "run.completed", {
        status: "completed",
        output_schema_version: "1",
        output,
      }),
    ]);
    expect((state as AgentRunViewState & { output?: unknown }).output).toEqual(output);
  });

  it("ignores a malformed event without throwing", () => {
    const state = reduce_run_event(initial_agent_run_view_state, { type: "not.an.event" });
    expect(state).toBe(initial_agent_run_view_state);
  });

  it("keeps the latest artifact version on update", () => {
    const state = fold([
      HAPPY_PATH[0],
      evt(1, "artifact.updated", { artifact_id: "artf_1", artifact_type: "formula", version: 1 }),
      evt(2, "artifact.updated", { artifact_id: "artf_1", artifact_type: "formula", version: 2 }),
    ]);
    expect(state.artifacts).toEqual([{ artifact_id: "artf_1", artifact_type: "formula", version: 2 }]);
  });
});

describe("apply_typed_run_event", () => {
  it("advances last_sequence for an in-order event", () => {
    const next = apply_typed_run_event(initial_agent_run_view_state, {
      schema_version: "1",
      event_id: "e1",
      run_id: "run_1",
      sequence: 4,
      occurred_at: "2026-07-15T00:00:00.000Z",
      type: "stage.changed",
      payload: { stage: "acting" },
    });
    expect(next.stage).toBe("acting");
    expect(next.last_sequence).toBe(4);
  });
});
