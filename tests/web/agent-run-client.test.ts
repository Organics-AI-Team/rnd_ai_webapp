/**
 * G4.10 — governed run browser client.
 *
 * Uses injected fetch/EventSource primitives so the complete browser protocol is
 * verified without Clerk, MongoDB, or provider credentials.
 */

import { describe, expect, it, vi } from "vitest";

import type { AgentRunEventV1 } from "@rnd-ai/shared-types/src/ai/contracts";

import {
  AGENT_RUN_EVENT_TYPES,
  AgentRunClientError,
  create_agent_run_client,
  type AgentRunEventSource,
} from "../../apps/web/lib/agent_run_client";

const HASH = "a".repeat(64);

/** Minimal EventSource fake that can emit named server events. */
class FakeEventSource implements AgentRunEventSource {
  readonly listeners = new Map<string, Set<EventListener>>();
  close = vi.fn();

  /** Register a named event listener. */
  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  /** Remove a named event listener. */
  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** Deliver JSON data through a named SSE event. */
  emit(type: string, value: unknown): void {
    const event = { data: JSON.stringify(value) } as MessageEvent;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

/** Build a valid typed run event for one named SSE frame. */
function event(sequence: number, type: AgentRunEventV1["type"]): AgentRunEventV1 {
  const payloads: Record<AgentRunEventV1["type"], unknown> = {
    "run.accepted": {
      agent_key: "raw_material_research",
      context_pack_hash: HASH,
      orchestrator_version: "1.0.0",
    },
    "stage.changed": { stage: "thinking" },
    "observation.added": {
      observation_id: "obs_1",
      observation_type: "knowledge_result",
      trust: "trusted_system",
      source_kind: "knowledge",
      tool_name: "knowledge.search",
      content_hash: HASH,
    },
    "decision.recorded": {
      iteration: 1,
      kind: "tool",
      tool_name: "knowledge.search",
      arguments_hash: HASH,
      rationale_summary: "Find current material evidence.",
    },
    "action.started": { action_id: "act_1", tool_name: "knowledge.search", iteration: 1 },
    "action.completed": {
      action_id: "act_1",
      tool_name: "knowledge.search",
      status: "ok",
      latency_ms: 5,
      cost_usd: "0.001",
    },
    "clarification.required": { questions: ["Which region?"] },
    "approval.required": {
      approval_id: "approval_1",
      summary: "Confirm this formula.",
      tool_name: "formula.confirm",
    },
    "artifact.updated": { artifact_id: "artifact_1", artifact_type: "formula", version: 1 },
    "usage.updated": { model_calls: 1, tool_calls: 1, tokens_used: 20, cost_usd_used: "0.001" },
    "run.completed": { status: "completed", output_schema_version: "1" },
    "run.failed": { code: "PROVIDER_UNAVAILABLE", safe_message: "Try again later.", retryable: true },
  };
  return {
    schema_version: "1",
    event_id: `event_${sequence}`,
    run_id: "run_1",
    sequence,
    occurred_at: "2026-07-16T00:00:00.000Z",
    type,
    payload: payloads[type],
  } as AgentRunEventV1;
}

/** Return an accepted-run HTTP response. */
function accepted(run_id = "run_1"): Response {
  return Response.json(
    {
      run_id,
      status: "accepted",
      executor: "agentic",
      events_url: `/api/ai/runs/${run_id}/events`,
      already_accepted: false,
    },
    { status: 202 },
  );
}

describe("create_agent_run_client", () => {
  it("posts the versioned run input and subscribes to every named SSE event", async () => {
    const source = new FakeEventSource();
    const fetch_fn = vi.fn(async () => accepted());
    const create_event_source = vi.fn(() => source);
    const on_event = vi.fn();
    const client = create_agent_run_client({
      fetch: fetch_fn,
      create_event_source,
      create_idempotency_key: () => "create-key-123456",
    });

    await client.start_run(
      {
        thread_id: "thread_1",
        agent_key: "raw_material_research",
        message: "Find a gentle surfactant.",
        attachment_source_ids: [],
        response_preferences: { language: "en", detail: "standard" },
      },
      { on_event },
    );

    expect(fetch_fn).toHaveBeenCalledWith(
      "/api/ai/runs",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          schema_version: "1",
          thread_id: "thread_1",
          agent_key: "raw_material_research",
          message: "Find a gentle surfactant.",
          attachment_source_ids: [],
          response_preferences: { language: "en", detail: "standard" },
          idempotency_key: "create-key-123456",
        }),
      }),
    );
    expect(create_event_source).toHaveBeenCalledWith(
      "/api/ai/runs/run_1/events",
      { withCredentials: true },
    );
    expect([...source.listeners.keys()].sort()).toEqual([...AGENT_RUN_EVENT_TYPES, "error"].sort());

    const delivered_types = AGENT_RUN_EVENT_TYPES.filter((type) => type !== "run.failed");
    delivered_types.forEach((type, sequence) => source.emit(type, event(sequence, type)));
    expect(on_event.mock.calls.map(([value]) => value.type)).toEqual(delivered_types);
  });

  it("resets before a new run and closes both replaced and explicitly cancelled streams", async () => {
    const first_source = new FakeEventSource();
    const second_source = new FakeEventSource();
    const sources = [first_source, second_source];
    const on_reset = vi.fn();
    const client = create_agent_run_client({
      fetch: vi.fn()
        .mockResolvedValueOnce(accepted("run_1"))
        .mockResolvedValueOnce(accepted("run_2")),
      create_event_source: () => sources.shift()!,
      create_idempotency_key: vi.fn()
        .mockReturnValueOnce("create-key-000001")
        .mockReturnValueOnce("create-key-000002"),
    });
    const input = {
      thread_id: "thread_1",
      agent_key: "sales_rnd" as const,
      message: "Analyze this market.",
      attachment_source_ids: [],
      response_preferences: { language: "en" as const, detail: "standard" as const },
    };

    await client.start_run(input, { on_event: vi.fn(), on_reset });
    await client.start_run(input, { on_event: vi.fn(), on_reset });
    expect(on_reset).toHaveBeenCalledTimes(2);
    expect(first_source.close).toHaveBeenCalledTimes(1);

    client.cancel_stream();
    expect(second_source.close).toHaveBeenCalledTimes(1);
  });

  it("sends actor-free resume payloads and reuses the action key when a retry repeats the same action", async () => {
    const fetch_fn = vi.fn()
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(Response.json({ error: "TEMPORARY" }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ run_id: "run_1", status: "accepted" }, { status: 202 }));
    const keys = vi.fn()
      .mockReturnValueOnce("create-key-123456")
      .mockReturnValueOnce("resume-key-123456");
    const client = create_agent_run_client({
      fetch: fetch_fn,
      create_event_source: () => new FakeEventSource(),
      create_idempotency_key: keys,
    });
    await client.start_run(
      {
        thread_id: "thread_1",
        agent_key: "raw_material_research",
        message: "Draft it.",
        attachment_source_ids: [],
        response_preferences: { language: "en", detail: "standard" },
      },
      { on_event: vi.fn() },
    );

    await expect(client.submit_approval("approval_1", "approve")).rejects.toBeInstanceOf(AgentRunClientError);
    await client.submit_approval("approval_1", "approve");

    const resume_bodies = fetch_fn.mock.calls.slice(1).map(([, init]) => JSON.parse(String(init?.body)));
    expect(resume_bodies).toEqual([
      {
        kind: "approval",
        approval_id: "approval_1",
        decision: "approve",
        idempotency_key: "resume-key-123456",
      },
      {
        kind: "approval",
        approval_id: "approval_1",
        decision: "approve",
        idempotency_key: "resume-key-123456",
      },
    ]);
    expect(JSON.stringify(resume_bodies)).not.toContain("profile");
    expect(keys).toHaveBeenCalledTimes(2);
  });

  it("uses a fresh action key when the same answer is accepted again later in the run", async () => {
    const fetch_fn = vi.fn()
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(Response.json({ run_id: "run_1", status: "accepted" }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ run_id: "run_1", status: "accepted" }, { status: 202 }));
    const client = create_agent_run_client({
      fetch: fetch_fn,
      create_event_source: () => new FakeEventSource(),
      create_idempotency_key: vi.fn()
        .mockReturnValueOnce("create-key-123456")
        .mockReturnValueOnce("resume-key-first")
        .mockReturnValueOnce("resume-key-second"),
    });
    await client.start_run(
      {
        thread_id: "thread_1",
        agent_key: "formulation",
        message: "Draft it.",
        attachment_source_ids: [],
        response_preferences: { language: "en", detail: "standard" },
      },
      { on_event: vi.fn() },
    );

    await client.submit_clarification("Use the standard option.");
    await client.submit_clarification("Use the standard option.");
    const bodies = fetch_fn.mock.calls.slice(1).map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies.map((body) => body.idempotency_key)).toEqual([
      "resume-key-first",
      "resume-key-second",
    ]);
  });

  it("surfaces stable typed HTTP errors", async () => {
    const client = create_agent_run_client({
      fetch: vi.fn(async () => Response.json(
        { error: "RUN_API_NOT_WIRED", message: "Run creation is unavailable." },
        { status: 503 },
      )),
      create_event_source: () => new FakeEventSource(),
      create_idempotency_key: () => "create-key-123456",
    });

    await expect(client.start_run(
      {
        thread_id: "thread_1",
        agent_key: "sales_rnd",
        message: "Analyze this market.",
        attachment_source_ids: [],
        response_preferences: { language: "en", detail: "standard" },
      },
      { on_event: vi.fn() },
    )).rejects.toMatchObject({
      code: "RUN_API_NOT_WIRED",
      status: 503,
      retryable: true,
      operation: "create",
    });
  });

  it("surfaces network and stream failures as typed errors", async () => {
    const network_client = create_agent_run_client({
      fetch: vi.fn(async () => { throw new TypeError("offline"); }),
      create_event_source: () => new FakeEventSource(),
      create_idempotency_key: () => "create-key-123456",
    });
    const input = {
      thread_id: "thread_1",
      agent_key: "sales_rnd" as const,
      message: "Analyze this market.",
      attachment_source_ids: [],
      response_preferences: { language: "en" as const, detail: "standard" as const },
    };
    await expect(network_client.start_run(input, { on_event: vi.fn() })).rejects.toMatchObject({
      code: "RUN_NETWORK_ERROR",
      operation: "create",
      retryable: true,
    });

    const source = new FakeEventSource();
    const on_error = vi.fn();
    const stream_client = create_agent_run_client({
      fetch: vi.fn(async () => accepted()),
      create_event_source: () => source,
      create_idempotency_key: () => "create-key-123456",
    });
    await stream_client.start_run(input, { on_event: vi.fn(), on_error });
    source.emit("error", {});
    expect(on_error).toHaveBeenCalledWith(expect.objectContaining({
      code: "RUN_STREAM_DISCONNECTED",
      operation: "stream",
      retryable: true,
    }));
  });
});
