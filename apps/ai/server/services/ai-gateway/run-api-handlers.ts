/**
 * Pure request handlers for the governed AI run API (G4.9g).
 *
 * All run-specific routing, validation, and error mapping for the three run
 * routes lives here, decoupled from Next.js, Clerk, and MongoDB so it is
 * exercised directly with fakes. The thin Next.js route files under
 * apps/web/app/api/ai/runs/** resolve the verified principal and tenant context,
 * assemble the production collaborators, and delegate to these functions.
 *
 * Contract (program invariants 1, 5, 9):
 * - create: idempotent 202; invalid input -> 400 AI_RUN_INPUT_INVALID; disabled
 *   tenant -> 403 AI_DISABLED; composition not yet wired -> 503 RUN_API_NOT_WIRED.
 * - events: authorize the run tenant-scoped first (cross-tenant/missing -> 404),
 *   then stream ordered SSE frames after Last-Event-ID with heartbeats; a
 *   terminal event closes the stream, otherwise it polls for new events until
 *   the request is aborted. The event `sequence` is the SSE `id:`, so a native
 *   EventSource reconnect resumes with no gaps or duplicates.
 * - resume: strict clarification/approval only (-> 400 RESUME_REQUEST_INVALID);
 *   cross-tenant/missing run -> 404; otherwise 202 accepted (the worker resumes).
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import type { TenantExecutionContext } from "@rnd-ai/shared-types";

import { AIRunNotFoundError } from "../../repositories/ai-run-repository";
import { AIDisabledError, AIRunInputInvalidError, type AIGateway } from "./ai-gateway";
import type { EventStore } from "./event-store";
import { ResumeRequestInvalidError, type ResumeAccepted } from "./resume-handler";
import { SSE_HEARTBEAT, format_sse_frame, parse_last_event_id } from "./sse";

/**
 * Thrown when the run API's create composition is not yet wired — the concrete
 * policy/context/budget gateway adapters (and provider credential rotation) are
 * a documented deployment gate. Surfaces as a 503 so callers can retry later.
 */
export class RunApiNotWiredError extends Error {
  /** Stable, client-safe error code. */
  readonly code = "RUN_API_NOT_WIRED";
  constructor() {
    super("The governed run API is not fully wired for run creation yet.");
    this.name = "RunApiNotWiredError";
  }
}

/** Event types that terminate a run's event stream. */
const TERMINAL_EVENT_TYPES: ReadonlySet<string> = new Set(["run.completed", "run.failed"]);

/** Default SSE heartbeat / tail-poll cadence in milliseconds. */
export const DEFAULT_HEARTBEAT_MS = 15_000;

/**
 * Collaborators the run handlers delegate to. All are injectable so the
 * handlers are tested with fakes and wired to Mongo-backed services in
 * production.
 */
export interface RunApiCollaborators {
  /** Creates a governed run idempotently (throws on invalid/disabled/unwired). */
  readonly gateway: AIGateway;
  /** Ordered, tenant-scoped event persistence to replay and tail. */
  readonly events: EventStore;
  /** Tenant-scoped run authorization; throws AIRunNotFoundError for cross-tenant/missing. */
  readonly authorize_run: (tenant_id: string, run_id: string) => Promise<void>;
  /** Validates + persists a resume payload and enqueues a resume job. */
  readonly submit_resume: (args: { tenant_id: string; run_id: string; payload: unknown }) => Promise<ResumeAccepted>;
  /** SSE heartbeat / tail-poll cadence; defaults to DEFAULT_HEARTBEAT_MS. */
  readonly heartbeat_ms?: number;
  /** Injectable timer so the tail loop is deterministic in tests. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Build a JSON Response with a stable content type.
 *
 * @param status - HTTP status code.
 * @param body - JSON-serializable payload.
 * @returns A Web Response.
 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * Map a typed error's stable code + message into a JSON error Response.
 *
 * @param status - HTTP status code.
 * @param error - Error carrying a stable `code` and safe `message`.
 * @returns A Web Response with `{ error, message }`.
 */
function error_json(status: number, error: { code: string; message: string }): Response {
  return json(status, { error: error.code, message: error.message });
}

/**
 * POST /api/ai/runs — create a governed run.
 *
 * @param tenant - Verified tenant execution context (built from the principal).
 * @param body - Parsed request body (untrusted AgentRunInputV1 candidate).
 * @param deps - Injected collaborators.
 * @returns 202 with the AcceptedRun, or 400/403/503 for a typed failure.
 * @throws Unexpected errors (never a typed run error) to the route boundary.
 */
export async function handle_create_run(
  tenant: TenantExecutionContext,
  body: unknown,
  deps: RunApiCollaborators,
): Promise<Response> {
  console.info({ boundary: "run-api", op: "create_run", phase: "start", tenant_id: tenant.tenant_id, correlation: tenant.correlation_id });
  try {
    const accepted = await deps.gateway.create_run(tenant, body);
    console.info({ boundary: "run-api", op: "create_run", phase: "accepted", run_id: accepted.run_id, already_accepted: accepted.already_accepted });
    return json(202, accepted);
  } catch (error) {
    if (error instanceof AIRunInputInvalidError) return error_json(400, error);
    if (error instanceof AIDisabledError) return error_json(403, error);
    if (error instanceof RunApiNotWiredError) return error_json(503, error);
    console.error({ boundary: "run-api", op: "create_run", phase: "error", tenant_id: tenant.tenant_id }, error);
    throw error;
  }
}

/**
 * POST /api/ai/runs/[runId]/resume — submit a strict interrupt response.
 *
 * @param tenant - Verified tenant execution context.
 * @param run_id - Target run id from the route parameter.
 * @param body - Parsed request body (untrusted resume payload).
 * @param deps - Injected collaborators.
 * @returns 202 accepted, or 400 for an invalid payload, 404 for a
 *          cross-tenant/missing run.
 */
export async function handle_resume_run(
  tenant: TenantExecutionContext,
  run_id: string,
  body: unknown,
  deps: RunApiCollaborators,
): Promise<Response> {
  console.info({ boundary: "run-api", op: "resume_run", phase: "start", tenant_id: tenant.tenant_id, run_id });
  try {
    const accepted = await deps.submit_resume({ tenant_id: tenant.tenant_id, run_id, payload: body });
    console.info({ boundary: "run-api", op: "resume_run", phase: "accepted", run_id });
    return json(202, accepted);
  } catch (error) {
    if (error instanceof ResumeRequestInvalidError) return error_json(400, error);
    if (error instanceof AIRunNotFoundError) return error_json(404, error);
    console.error({ boundary: "run-api", op: "resume_run", phase: "error", run_id }, error);
    throw error;
  }
}

/**
 * GET /api/ai/runs/[runId]/events — stream ordered run events as SSE.
 *
 * Authorizes the run tenant-scoped before opening the stream, replays every
 * event after the client's Last-Event-ID, then tails for new events, emitting a
 * heartbeat between polls. A terminal event (`run.completed`/`run.failed`) or an
 * aborted request closes the stream. A disconnected browser does not cancel the
 * server-side run — only the stream.
 *
 * @param tenant - Verified tenant execution context.
 * @param run_id - Target run id from the route parameter.
 * @param last_event_id - The client's Last-Event-ID (header or query), or null.
 * @param deps - Injected collaborators.
 * @param signal - Optional request-abort signal that ends the stream.
 * @returns 200 text/event-stream, or 404 for a cross-tenant/missing run.
 */
export async function handle_run_events(
  tenant: TenantExecutionContext,
  run_id: string,
  last_event_id: string | null | undefined,
  deps: RunApiCollaborators,
  signal?: AbortSignal,
): Promise<Response> {
  console.info({ boundary: "run-api", op: "run_events", phase: "start", tenant_id: tenant.tenant_id, run_id });
  try {
    await deps.authorize_run(tenant.tenant_id, run_id);
  } catch (error) {
    if (error instanceof AIRunNotFoundError) return error_json(404, error);
    console.error({ boundary: "run-api", op: "run_events", phase: "authorize_error", run_id }, error);
    throw error;
  }

  const run = { tenant_id: tenant.tenant_id, run_id };
  const heartbeat_ms = deps.heartbeat_ms ?? DEFAULT_HEARTBEAT_MS;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const encoder = new TextEncoder();
  let cursor = parse_last_event_id(last_event_id);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let terminal = false;
        while (!terminal && !signal?.aborted) {
          const batch = await deps.events.replay(run, cursor);
          for (const run_event of batch) {
            controller.enqueue(encoder.encode(format_sse_frame(run_event)));
            cursor = run_event.sequence;
            if (TERMINAL_EVENT_TYPES.has(run_event.type)) terminal = true;
          }
          if (terminal || signal?.aborted) break;
          controller.enqueue(encoder.encode(SSE_HEARTBEAT));
          await sleep(heartbeat_ms);
        }
      } catch (error) {
        console.error({ boundary: "run-api", op: "run_events", phase: "stream_error", run_id }, error);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Disable proxy buffering so events flush immediately.
      "x-accel-buffering": "no",
    },
  });
}
