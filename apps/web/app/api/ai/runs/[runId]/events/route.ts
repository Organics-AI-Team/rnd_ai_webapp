/**
 * GET /api/ai/runs/[runId]/events — ordered, resumable run event stream (G4.9g).
 *
 * Verifies the Clerk principal and `ai:run` permission, derives the tenant
 * context, then delegates to the pure events handler which authorizes the run
 * tenant-scoped (cross-tenant/missing -> 404), replays every event after the
 * client's Last-Event-ID, and tails as Server-Sent Events with heartbeats. The
 * event `sequence` is the SSE `id:`, so a native EventSource reconnect resumes
 * with no gaps or duplicates. A disconnected browser ends only the stream, never
 * the server-side run.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { type NextRequest } from "next/server";

import { with_request_principal } from "@/lib/server/with-request-principal";
import { resolve_tenant_context } from "@/lib/server/tenant-context-route";
import { handle_run_events } from "@/server/services/ai-gateway/run-api-handlers";
import { resolve_run_api_runtime } from "@/server/services/ai-gateway/run-api-runtime";

/** Run on Node.js (Mongo + streaming), always dynamic (per-request identity). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stream a run's versioned events as SSE.
 *
 * @param request - Incoming route request (Last-Event-ID header or query param).
 * @param context - Route params carrying the target run id.
 * @returns 200 text/event-stream, or 401/403/404 on a typed failure.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  return with_request_principal(request, "ai:run", async (principal) => {
    const scope = resolve_tenant_context(principal);
    if (scope.status === "error") return scope.response;
    const { runId } = await context.params;
    const last_event_id =
      request.headers.get("last-event-id") ??
      new URL(request.url).searchParams.get("last_event_id");
    const collaborators = await resolve_run_api_runtime();
    return handle_run_events(scope.tenant, runId, last_event_id, collaborators, request.signal);
  });
}
