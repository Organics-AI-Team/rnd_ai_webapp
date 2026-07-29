/**
 * Pure tenant-scoped artifact read handler (M5).
 *
 * Serves the payload behind an `artifact.updated` SSE reference so the
 * Formulate UI can populate the review form. The repository enforces the
 * tenant scope (cross-tenant/missing/malformed ids are one identical 404);
 * the stored content is re-validated against the canonical formula schema
 * before it is released to a browser.
 *
 * @author AI Management System
 * @date 2026-07-28
 */

import { formula_artifact_v1_schema } from "@rnd-ai/ai-orchestration/artifacts";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";
import type { Document, WithId } from "mongodb";

import type { AIArtifactRepository } from "../../repositories/ai-artifact-repository";

/** Collaborators for the artifact read handler. */
export interface ArtifactApiDeps {
  readonly artifacts: AIArtifactRepository;
}

/**
 * Fetch one tenant-owned formula artifact as safe JSON.
 *
 * @param context - Verified tenant execution context (never from the request).
 * @param artifact_id - Caller-supplied artifact id from the SSE reference.
 * @param deps - Injected artifact repository.
 * @returns 200 with {artifact_id, artifact_type, status, content}; 404 for
 *          cross-tenant/missing/malformed ids; 500 for invalid stored content.
 */
export async function handle_get_artifact(
  context: TenantExecutionContext,
  artifact_id: string,
  deps: ArtifactApiDeps,
): Promise<Response> {
  console.info("[artifact-api] handle_get_artifact — start", {
    correlation_id: context.correlation_id,
  });
  let document: WithId<Document>;
  try {
    document = await deps.artifacts.get_artifact(context, artifact_id);
  } catch {
    return Response.json(
      { error: "AI_ARTIFACT_NOT_FOUND", message: "The artifact was not found." },
      { status: 404 },
    );
  }
  const parsed = formula_artifact_v1_schema.safeParse(document.content);
  if (!parsed.success) {
    console.error("[artifact-api] handle_get_artifact — invalid stored content", {
      correlation_id: context.correlation_id,
    });
    return Response.json(
      {
        error: "AI_ARTIFACT_CONTENT_INVALID",
        message: "The stored artifact is not a valid formula artifact.",
      },
      { status: 500 },
    );
  }
  console.info("[artifact-api] handle_get_artifact — done", {
    correlation_id: context.correlation_id,
  });
  return Response.json({
    artifact_id: String(document._id),
    artifact_type: "formula",
    status: String(document.status ?? "draft"),
    content: parsed.data,
  });
}
