/**
 * Tenant-scoped repository over ai_artifacts (G4.8d-ii).
 *
 * The durable record of AI-produced tenant artifacts (currently formulas): a
 * draft is persisted before review, then confirmed on commit. Every method
 * takes a TenantExecutionContext and filters by tenant, so a draft can never be
 * read or mutated across tenants. Writes go exclusively through this repository
 * so the private-boundary scanner (G2.7) stays satisfied.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import type { Db, Document, WithId } from "mongodb";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";

import {
  get_scoped_document,
  insert_scoped_document,
  update_scoped_document,
} from "./tenant-repository-base";

/** Canonical not-found code for every artifact lookup failure mode. */
const NOT_FOUND = "AI_ARTIFACT_NOT_FOUND";

/** Tenant-scoped persistence for AI-produced artifacts. */
export interface AIArtifactRepository {
  /**
   * Persist a new draft artifact owned by the acting profile.
   *
   * @param context - Verified tenant execution context.
   * @param input - Artifact fields (runId, artifactType, schemaVersion, content,
   *                contentHash, validationResult, sourceEvidenceIds); status is
   *                forced to "draft" and tenant/owner are stamped from context.
   * @returns The inserted artifact document.
   */
  persist_draft(
    context: TenantExecutionContext,
    input: Record<string, unknown>,
  ): Promise<WithId<Document>>;

  /**
   * Fetch one tenant-scoped artifact by ID.
   *
   * @param context - Verified tenant execution context.
   * @param artifact_id - Caller-supplied artifact ID.
   * @returns The scoped artifact document.
   * @throws ResourceNotFoundError ("AI_ARTIFACT_NOT_FOUND") for cross-tenant,
   *   missing, or malformed IDs (identical shape by design).
   */
  get_artifact(
    context: TenantExecutionContext,
    artifact_id: string,
  ): Promise<WithId<Document>>;

  /**
   * Mark a draft artifact confirmed (idempotent), linking it to the committed
   * formula so a replayed commit can return the same formula. Setting the same
   * status again is a no-op that still returns the current document.
   *
   * @param context - Verified tenant execution context.
   * @param artifact_id - Caller-supplied artifact ID.
   * @param confirmed_formula_id - The formula this artifact was committed to.
   * @returns The updated artifact document.
   * @throws ResourceNotFoundError ("AI_ARTIFACT_NOT_FOUND").
   */
  mark_confirmed(
    context: TenantExecutionContext,
    artifact_id: string,
    confirmed_formula_id: string,
  ): Promise<WithId<Document>>;
}

/**
 * Create the ai_artifacts repository bound to a database handle.
 *
 * @param db - Connected MongoDB database.
 * @returns Repository instance; failures use "AI_ARTIFACT_NOT_FOUND".
 */
export function create_ai_artifact_repository(db: Db): AIArtifactRepository {
  const artifacts = db.collection("ai_artifacts");
  return {
    async persist_draft(context, input) {
      return insert_scoped_document(
        artifacts,
        context,
        { revision: 1, ...input, status: "draft" },
        "owner",
      );
    },

    async get_artifact(context, artifact_id) {
      return get_scoped_document(artifacts, context, artifact_id, NOT_FOUND);
    },

    async mark_confirmed(context, artifact_id, confirmed_formula_id) {
      return update_scoped_document(
        artifacts,
        context,
        artifact_id,
        NOT_FOUND,
        { status: "confirmed", confirmedFormulaId: confirmed_formula_id },
      );
    },
  };
}
