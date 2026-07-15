/**
 * G4.9g — governed AI run API handlers (credential-free subset).
 *
 * Proves the pure run-API handlers that the three Next.js routes delegate to:
 * create (idempotent 202, invalid -> 400, disabled -> 403, unwired -> 503),
 * events (tenant authorization -> 404, ordered SSE replay after Last-Event-ID,
 * heartbeat + abort), and resume (strict payload -> 400, cross-tenant -> 404,
 * accepted -> 202). Collaborators are injected as fakes so no Clerk session,
 * MongoDB, or provider credential is needed; the execution-path cases
 * (completion, provider failure) are deferred to the credentialed wiring.
 *
 * The anonymous/suspended-tenant auth cases are enforced by the reused
 * with_request_principal guard (G0) and are covered by its own tests, not here.
 */

import { describe, expect, it } from "vitest";

import type { TenantExecutionContext } from "@rnd-ai/shared-types";
import type { AgentRunEventV1 } from "@rnd-ai/shared-types/src/ai/contracts";

import { AIRunNotFoundError } from "../../apps/ai/server/repositories/ai-run-repository";
import {
  AIDisabledError,
  AIRunInputInvalidError,
  type AcceptedRun,
  type AIGateway,
} from "../../apps/ai/server/services/ai-gateway/ai-gateway";
import type { EventStore, RunRef } from "../../apps/ai/server/services/ai-gateway/event-store";
import { ResumeRequestInvalidError } from "../../apps/ai/server/services/ai-gateway/resume-handler";
import { SSE_HEARTBEAT } from "../../apps/ai/server/services/ai-gateway/sse";
import {
  handle_create_run,
  handle_resume_run,
  handle_run_events,
  RunApiNotWiredError,
  type RunApiCollaborators,
} from "../../apps/ai/server/services/ai-gateway/run-api-handlers";

const TENANT = "507f1f77bcf86cd7994390a1";

/** A minimal frozen tenant execution context; only tenant_id/correlation_id are read. */
const tenant: TenantExecutionContext = Object.freeze({
  tenant_id: TENANT,
  actor_profile_id: "profile_1",
  clerk_user_id: "clerk_1",
  clerk_organization_id: "",
  membership_id: null,
  tenant_role: "user",
  permissions: Object.freeze(["ai:run"]),
  access_mode: "member",
  support_grant_id: null,
  correlation_id: "corr_1",
  request_started_at: "2026-07-15T00:00:00.000Z",
}) as unknown as TenantExecutionContext;

const VALID_INPUT = {
  schema_version: "1",
  thread_id: "thread_1",
  agent_key: "formulation",
  message: "Draft a gentle cleanser.",
  attachment_source_ids: [],
  response_preferences: { language: "en", detail: "standard" },
  idempotency_key: "idem-key-123456",
};

/** Build a versioned run event for the fake event store. */
function event(sequence: number, type: AgentRunEventV1["type"], payload: unknown): AgentRunEventV1 {
  return {
    schema_version: "1",
    event_id: `e${sequence}`,
    run_id: "run_1",
    sequence,
    occurred_at: "2026-07-15T00:00:00.000Z",
    type,
    payload,
  } as AgentRunEventV1;
}

/** An in-memory event store returning a fixed ordered event list, filtered by cursor. */
function fake_event_store(events: readonly AgentRunEventV1[]): EventStore {
  return {
    async append() {
      return { appended: 0 };
    },
    async replay(_run: RunRef, after_sequence: number) {
      return events.filter((candidate) => candidate.sequence > after_sequence);
    },
    async latest_sequence() {
      return events.length === 0 ? -1 : events[events.length - 1].sequence;
    },
  };
}

/** Base collaborators; each test overrides only what it exercises. */
function collaborators(overrides: Partial<RunApiCollaborators>): RunApiCollaborators {
  return {
    gateway: { async create_run() { throw new Error("unexpected create_run"); } },
    events: fake_event_store([]),
    authorize_run: async () => undefined,
    submit_resume: async () => ({ run_id: "run_1", status: "accepted" }),
    ...overrides,
  };
}

/** Drain a streaming Response body to a decoded string. */
async function read_stream(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

describe("handle_create_run", () => {
  it("returns 202 with the accepted run for valid input", async () => {
    const accepted: AcceptedRun = {
      run_id: "run_1",
      status: "accepted",
      executor: "agentic",
      events_url: "/api/ai/runs/run_1/events",
      already_accepted: false,
    };
    const gateway: AIGateway = { async create_run() { return accepted; } };
    const response = await handle_create_run(tenant, VALID_INPUT, collaborators({ gateway }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(accepted);
  });

  it("returns the same run for a repeated idempotency key", async () => {
    const seen = new Map<string, number>();
    const gateway: AIGateway = {
      async create_run(_tenant, raw) {
        const key = (raw as { idempotency_key: string }).idempotency_key;
        const first = !seen.has(key);
        if (first) seen.set(key, seen.size + 1);
        return {
          run_id: "run_stable",
          status: "accepted",
          executor: "agentic",
          events_url: "/api/ai/runs/run_stable/events",
          already_accepted: !first,
        };
      },
    };
    const deps = collaborators({ gateway });
    const first = await handle_create_run(tenant, VALID_INPUT, deps);
    const second = await handle_create_run(tenant, VALID_INPUT, deps);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    const first_body = await first.json();
    const second_body = await second.json();
    expect(first_body.run_id).toBe(second_body.run_id);
    expect(first_body.already_accepted).toBe(false);
    expect(second_body.already_accepted).toBe(true);
  });

  it("maps invalid input to 400 AI_RUN_INPUT_INVALID", async () => {
    const gateway: AIGateway = { async create_run() { throw new AIRunInputInvalidError(); } };
    const response = await handle_create_run(tenant, { bad: true }, collaborators({ gateway }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("AI_RUN_INPUT_INVALID");
  });

  it("maps a disabled tenant to 403 AI_DISABLED", async () => {
    const gateway: AIGateway = { async create_run() { throw new AIDisabledError("AI is disabled for this tenant."); } };
    const response = await handle_create_run(tenant, VALID_INPUT, collaborators({ gateway }));
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("AI_DISABLED");
  });

  it("maps an unwired composition to 503 RUN_API_NOT_WIRED", async () => {
    const gateway: AIGateway = { async create_run() { throw new RunApiNotWiredError(); } };
    const response = await handle_create_run(tenant, VALID_INPUT, collaborators({ gateway }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("RUN_API_NOT_WIRED");
  });
});

describe("handle_resume_run", () => {
  it("returns 202 for an accepted resume", async () => {
    const submit_resume = async () => ({ run_id: "run_1", status: "accepted" as const });
    const response = await handle_resume_run(tenant, "run_1", { kind: "clarification", answer: "Oily skin." }, collaborators({ submit_resume }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ run_id: "run_1", status: "accepted" });
  });

  it("maps an invalid resume payload to 400 RESUME_REQUEST_INVALID", async () => {
    const submit_resume = async () => { throw new ResumeRequestInvalidError(); };
    const response = await handle_resume_run(tenant, "run_1", { kind: "nope" }, collaborators({ submit_resume }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("RESUME_REQUEST_INVALID");
  });

  it("maps a cross-tenant run to 404 AI_RUN_NOT_FOUND", async () => {
    const submit_resume = async () => { throw new AIRunNotFoundError(); };
    const response = await handle_resume_run(tenant, "run_x", { kind: "clarification", answer: "hi" }, collaborators({ submit_resume }));
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("AI_RUN_NOT_FOUND");
  });
});

describe("handle_run_events", () => {
  it("replays the full ordered stream as SSE and closes on a terminal event", async () => {
    const events = [
      event(0, "run.accepted", { agent_key: "formulation" }),
      event(1, "stage.changed", { stage: "acting" }),
      event(2, "run.completed", { status: "completed" }),
    ];
    const response = await handle_run_events(tenant, "run_1", null, collaborators({ events: fake_event_store(events) }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const body = await read_stream(response);
    expect(body.indexOf("id: 0")).toBeLessThan(body.indexOf("id: 1"));
    expect(body.indexOf("id: 1")).toBeLessThan(body.indexOf("id: 2"));
    expect(body).toContain("event: run.completed");
  });

  it("replays only events after Last-Event-ID", async () => {
    const events = [
      event(0, "run.accepted", { agent_key: "formulation" }),
      event(1, "stage.changed", { stage: "acting" }),
      event(2, "run.completed", { status: "completed" }),
    ];
    const response = await handle_run_events(tenant, "run_1", "1", collaborators({ events: fake_event_store(events) }));
    const body = await read_stream(response);
    expect(body).not.toContain("id: 0");
    expect(body).not.toContain("id: 1");
    expect(body).toContain("id: 2");
  });

  it("returns 404 for a cross-tenant or missing run before streaming", async () => {
    const authorize_run = async () => { throw new AIRunNotFoundError(); };
    const response = await handle_run_events(tenant, "run_x", null, collaborators({ authorize_run }));
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("AI_RUN_NOT_FOUND");
  });

  it("emits a heartbeat while tailing and closes when the request aborts", async () => {
    const controller = new AbortController();
    const events = [event(0, "stage.changed", { stage: "thinking" })];
    const deps = collaborators({
      events: fake_event_store(events),
      // Deterministic tail: abort the request on the first heartbeat wait.
      sleep: async () => { controller.abort(); },
    });
    const response = await handle_run_events(tenant, "run_1", null, deps, controller.signal);
    const body = await read_stream(response);
    expect(body).toContain("id: 0");
    expect(body).toContain(SSE_HEARTBEAT.trim());
  });
});
