/**
 * GET /api/ai/artifacts/[artifactId] — tenant-scoped artifact payload (M5).
 *
 * Verifies the Clerk principal and the `formula:read` permission, derives the
 * tenant context from the verified session (never the request), and delegates
 * to the pure artifact handler. Serves the FormulaArtifactV1 payload behind an
 * `artifact.updated` SSE reference for the Formulate review flow.
 *
 * @author AI Management System
 * @date 2026-07-28
 */

import { type NextRequest } from "next/server";
import client_promise from "@rnd-ai/shared-database";

import { with_request_principal } from "@/lib/server/with-request-principal";
import { resolve_tenant_context } from "@/lib/server/tenant-context-route";
import { create_ai_artifact_repository } from "@/server/repositories/ai-artifact-repository";
import { handle_get_artifact } from "@/server/services/ai-gateway/artifact-api-handler";

/** Run on Node.js (Mongo), always dynamic (per-request identity). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fetch one tenant-owned formula artifact.
 *
 * @param request - Incoming route request.
 * @param context - Route params carrying the target artifact id.
 * @returns 200 with the artifact payload, or 401/403/404/500 on a typed failure.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ artifactId: string }> },
): Promise<Response> {
  return with_request_principal(request, "formula:read", async (principal) => {
    const scope = resolve_tenant_context(principal);
    if (scope.status === "error") return scope.response;
    const { artifactId } = await context.params;
    const client = await client_promise;
    return handle_get_artifact(scope.tenant, artifactId, {
      artifacts: create_ai_artifact_repository(client.db()),
    });
  });
}
