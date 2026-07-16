/**
 * Framework-free browser client for the governed AI run API.
 *
 * Fetch and EventSource are injected so create, resume, named-event delivery,
 * reconnection behavior, and stream cancellation can be unit tested without a
 * browser session or model credentials.
 */

import {
  agent_run_event_v1_schema,
  type AgentKeyV1,
  type AgentRunEventV1,
} from "@rnd-ai/shared-types/src/ai/contracts";

/** Every named SSE event emitted by `format_sse_frame`. */
export const AGENT_RUN_EVENT_TYPES = [
  "run.accepted",
  "stage.changed",
  "observation.added",
  "decision.recorded",
  "action.started",
  "action.completed",
  "clarification.required",
  "approval.required",
  "artifact.updated",
  "usage.updated",
  "run.completed",
  "run.failed",
] as const satisfies readonly AgentRunEventV1["type"][];

/** Run input supplied by a page; version and idempotency are client-owned. */
export interface AgentRunStartInput {
  readonly thread_id: string;
  readonly agent_key: AgentKeyV1;
  readonly message: string;
  readonly attachment_source_ids: readonly string[];
  readonly response_preferences: {
    readonly language: "en" | "th";
    readonly detail: "concise" | "standard" | "detailed";
  };
}

/** Validated create response needed by the browser client. */
export interface AcceptedAgentRun {
  readonly run_id: string;
  readonly status: "accepted";
  readonly executor: string;
  readonly events_url: string;
  readonly already_accepted: boolean;
}

/** Operation that produced a client-visible transport error. */
export type AgentRunClientOperation = "create" | "resume" | "stream";

/** Stable typed error surfaced by create, resume, validation, or SSE handling. */
export class AgentRunClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly operation: AgentRunClientOperation,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AgentRunClientError";
  }
}

/** Narrow EventSource surface used by the governed run client. */
export interface AgentRunEventSource {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  close(): void;
}

/** Browser primitives injected into the framework-free client. */
export interface AgentRunBrowserPrimitives {
  readonly fetch: typeof fetch;
  readonly create_event_source: (
    url: string,
    init: EventSourceInit,
  ) => AgentRunEventSource;
  readonly create_idempotency_key: () => string;
}

/** Callbacks bound to one newly-created run stream. */
export interface AgentRunCallbacks {
  readonly on_event: (event: AgentRunEventV1) => void;
  readonly on_reset?: () => void;
  readonly on_error?: (error: AgentRunClientError) => void;
}

/** Public imperative client owned by the React hook. */
export interface AgentRunClient {
  start_run(input: AgentRunStartInput, callbacks: AgentRunCallbacks): Promise<AcceptedAgentRun>;
  submit_clarification(answer: string): Promise<void>;
  submit_approval(approval_id: string, decision: "approve" | "deny"): Promise<void>;
  cancel_stream(): void;
}

/** JSON error shape returned by governed run endpoints. */
interface ErrorBody {
  readonly error?: unknown;
  readonly message?: unknown;
}

/** Parse JSON without leaking response-body failures to callers. */
async function response_json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Convert a non-2xx response into a stable typed client error. */
async function response_error(
  response: Response,
  operation: Exclude<AgentRunClientOperation, "stream">,
): Promise<AgentRunClientError> {
  const body = (await response_json(response)) as ErrorBody | null;
  const code = typeof body?.error === "string"
    ? body.error
    : operation === "create" ? "RUN_CREATE_FAILED" : "RUN_RESUME_FAILED";
  const message = typeof body?.message === "string"
    ? body.message
    : operation === "create" ? "The AI run could not be started." : "The AI run could not be resumed.";
  return new AgentRunClientError(code, message, operation, response.status, response.status === 429 || response.status >= 500);
}

/** Validate the minimum accepted-run response used by the browser. */
function accepted_run(value: unknown): AcceptedAgentRun | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.run_id !== "string"
    || candidate.status !== "accepted"
    || typeof candidate.executor !== "string"
    || typeof candidate.events_url !== "string"
    || typeof candidate.already_accepted !== "boolean"
  ) return null;
  return candidate as unknown as AcceptedAgentRun;
}

/** Build an action fingerprint whose retry must reuse the same key. */
function resume_fingerprint(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

/**
 * Create the governed run browser client.
 *
 * @param browser - Injected authenticated fetch, EventSource factory, and key source.
 * @returns A client that owns at most one live stream.
 */
export function create_agent_run_client(browser: AgentRunBrowserPrimitives): AgentRunClient {
  let current_run_id: string | null = null;
  let source: AgentRunEventSource | null = null;
  let source_listeners: ReadonlyMap<string, EventListener> = new Map();
  let generation = 0;
  const resume_keys = new Map<string, string>();

  /** Convert browser/network rejection into the same typed error surface as HTTP failures. */
  async function request(
    url: string,
    init: RequestInit,
    operation: Exclude<AgentRunClientOperation, "stream">,
  ): Promise<Response> {
    try {
      return await browser.fetch(url, init);
    } catch {
      throw new AgentRunClientError(
        "RUN_NETWORK_ERROR",
        "The AI run service could not be reached.",
        operation,
        null,
        true,
      );
    }
  }

  /** Close the current client-side stream without cancelling the server run. */
  function cancel_stream(): void {
    generation += 1;
    if (!source) return;
    for (const [type, listener] of source_listeners) source.removeEventListener(type, listener);
    source.close();
    source = null;
    source_listeners = new Map();
    console.info("[agent_run_client] stream closed", { run_id: current_run_id });
  }

  /** Open and validate all named events for one accepted run. */
  function open_stream(accepted: AcceptedAgentRun, callbacks: AgentRunCallbacks): void {
    const next_source = browser.create_event_source(accepted.events_url, { withCredentials: true });
    const listeners = new Map<string, EventListener>();

    for (const type of AGENT_RUN_EVENT_TYPES) {
      const listener: EventListener = (raw): void => {
        try {
          const data = JSON.parse((raw as MessageEvent).data as string);
          const parsed = agent_run_event_v1_schema.safeParse(data);
          if (!parsed.success) {
            callbacks.on_error?.(new AgentRunClientError(
              "RUN_EVENT_INVALID",
              "The AI run returned an invalid event.",
              "stream",
              null,
              false,
            ));
            return;
          }
          callbacks.on_event(parsed.data);
          if (parsed.data.type === "run.completed" || parsed.data.type === "run.failed") {
            cancel_stream();
          }
        } catch {
          callbacks.on_error?.(new AgentRunClientError(
            "RUN_EVENT_INVALID",
            "The AI run returned an invalid event.",
            "stream",
            null,
            false,
          ));
        }
      };
      listeners.set(type, listener);
      next_source.addEventListener(type, listener);
    }

    const error_listener: EventListener = (): void => {
      callbacks.on_error?.(new AgentRunClientError(
        "RUN_STREAM_DISCONNECTED",
        "The live update stream was interrupted and is reconnecting.",
        "stream",
        null,
        true,
      ));
    };
    listeners.set("error", error_listener);
    next_source.addEventListener("error", error_listener);
    source = next_source;
    source_listeners = listeners;
    console.info("[agent_run_client] stream opened", { run_id: accepted.run_id });
  }

  /** Submit one strict, actor-free resume payload. */
  async function submit_resume(payload: Record<string, unknown>): Promise<void> {
    if (!current_run_id) {
      throw new AgentRunClientError("RUN_NOT_ACTIVE", "There is no active AI run.", "resume", null, false);
    }
    const fingerprint = resume_fingerprint(payload);
    const idempotency_key = resume_keys.get(fingerprint) ?? browser.create_idempotency_key();
    resume_keys.set(fingerprint, idempotency_key);
    const response = await request(`/api/ai/runs/${encodeURIComponent(current_run_id)}/resume`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, idempotency_key }),
    }, "resume");
    if (!response.ok) throw await response_error(response, "resume");
    // A received 202 proves this action was durably accepted. Release its key
    // so a later checkpoint with an identical human answer is a new action;
    // transport failures retain the key and therefore retry idempotently.
    resume_keys.delete(fingerprint);
    console.info("[agent_run_client] resume accepted", { run_id: current_run_id, kind: payload.kind });
  }

  return {
    async start_run(input, callbacks) {
      cancel_stream();
      current_run_id = null;
      resume_keys.clear();
      callbacks.on_reset?.();
      const start_generation = generation;
      const response = await request("/api/ai/runs", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schema_version: "1",
          ...input,
          attachment_source_ids: [...input.attachment_source_ids],
          idempotency_key: browser.create_idempotency_key(),
        }),
      }, "create");
      if (!response.ok) throw await response_error(response, "create");
      const accepted = accepted_run(await response_json(response));
      if (!accepted) {
        throw new AgentRunClientError(
          "RUN_RESPONSE_INVALID",
          "The AI run returned an invalid create response.",
          "create",
          response.status,
          false,
        );
      }
      current_run_id = accepted.run_id;
      if (start_generation === generation) open_stream(accepted, callbacks);
      console.info("[agent_run_client] run accepted", { run_id: accepted.run_id });
      return accepted;
    },
    async submit_clarification(answer) {
      await submit_resume({ kind: "clarification", answer });
    },
    async submit_approval(approval_id, decision) {
      await submit_resume({ kind: "approval", approval_id, decision });
    },
    cancel_stream,
  };
}
