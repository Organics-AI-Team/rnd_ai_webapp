/**
 * POST /api/ai/runs — the one authenticated entry point for a governed run (G4.9g).
 *
 * Verifies the Clerk principal and the `ai:run` permission, screens the body for
 * client-supplied identity fields, derives the tenant execution context from the
 * verified session (never the body), and delegates to the pure create handler.
 * The handler returns 202 with the run id and events URL without depending on
 * this request staying alive — a private worker drains the queue and drives the
 * loop. Idempotent on the run's idempotency key.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { type NextRequest } from "next/server";

import { with_request_principal } from "@/lib/server/with-request-principal";
import { resolve_tenant_context } from "@/lib/server/tenant-context-route";
import { handle_create_run } from "@/server/services/ai-gateway/run-api-handlers";
import { resolve_run_api_runtime } from "@/server/services/ai-gateway/run-api-runtime";

/** Run on Node.js (Mongo + streaming), always dynamic (per-request identity). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create a governed agentic run.
 *
 * @param request - Incoming route request carrying the AgentRunInputV1 body.
 * @returns 202 with the accepted run, or 400/401/403/503 on a typed failure.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return with_request_principal(request, "ai:run", async (principal, body) => {
    const scope = resolve_tenant_context(principal);
    if (scope.status === "error") return scope.response;
    const collaborators = await resolve_run_api_runtime();
    return handle_create_run(scope.tenant, body, collaborators);
  });
}
