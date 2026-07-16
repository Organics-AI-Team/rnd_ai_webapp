/**
 * POST /api/ai/runs/[runId]/resume — resume a run from an interrupt (G4.9g).
 *
 * Verifies the Clerk principal and `ai:run` permission, screens the body,
 * derives the tenant context, then delegates to the pure resume handler. The
 * handler accepts ONLY a strict clarification response or approval decision
 * (never arbitrary graph state), persists it on the tenant-scoped run, and
 * enqueues a resume job — the private worker resumes the graph, never this HTTP
 * request. Approval authority (manager-only) is enforced by the governor when
 * the worker resumes.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { type NextRequest } from "next/server";

import {
  is_credential_free_commercial_test_runtime,
  resume_commercial_test_run,
} from "@/lib/server/commercial-test-run-adapter";
import { with_request_principal } from "@/lib/server/with-request-principal";
import { resolve_tenant_context } from "@/lib/server/tenant-context-route";
import { handle_resume_run } from "@/server/services/ai-gateway/run-api-handlers";
import { resolve_run_api_runtime } from "@/server/services/ai-gateway/run-api-runtime";

/** Run on Node.js (Mongo), always dynamic (per-request identity). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resume a run with a strict interrupt response.
 *
 * @param request - Incoming route request carrying the resume payload.
 * @param context - Route params carrying the target run id.
 * @returns 202 accepted, or 400/401/403/404 on a typed failure.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  if (is_credential_free_commercial_test_runtime()) {
    const { runId } = await context.params;
    const tenant_id = request.cookies.get("commercial_test_tenant")?.value ?? "tenant_a";
    const role = request.cookies.get("commercial_test_role")?.value === "manager"
      ? "manager"
      : "student";
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    return resume_commercial_test_run(runId, tenant_id, role, body);
  }
  return with_request_principal(request, "ai:run", async (principal, body) => {
    const scope = resolve_tenant_context(principal);
    if (scope.status === "error") return scope.response;
    const { runId } = await context.params;
    const collaborators = await resolve_run_api_runtime();
    return handle_resume_run(scope.tenant, runId, body, collaborators);
  });
}
