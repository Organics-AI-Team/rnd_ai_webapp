/**
 * Tenant knowledge sources router (G3.6).
 *
 * Managers manage a tenant's knowledge sources; any member may list them.
 * Listing requires tenant:knowledge:read (returns metadata only — never
 * content); creating an upload intent or deleting a source requires
 * tenant:knowledge:manage. New sources are created quarantined (`pending`);
 * the ingestion verification pipeline (G3.5 write-path) promotes them to ready.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { ObjectId } from "mongodb";
import client_promise from "@rnd-ai/shared-database";

import { router, tenantPermissionProcedure } from "../trpc";

const SOURCES = "knowledge_sources";

/**
 * Build a tenantId match filter spanning both stored encodings.
 *
 * @param tenant_id - Verified tenant ID.
 * @returns Mongo filter.
 */
function tenant_filter(tenant_id: string): Record<string, unknown> {
  const values: (string | ObjectId)[] = [tenant_id];
  if (ObjectId.isValid(tenant_id)) values.push(new ObjectId(tenant_id));
  return { tenantId: { $in: values } };
}

export const knowledgeSourcesRouter = router({
  /** List the tenant's knowledge sources (metadata only, no content). */
  list: tenantPermissionProcedure("tenant:knowledge:read").query(async ({ ctx }) => {
    const db = (await client_promise).db();
    const docs = await db
      .collection(SOURCES)
      .find(
        { ...tenant_filter(ctx.tenant_context.tenant_id), scope: "tenant", deletedAt: null },
        { projection: { name: 1, status: 1, sourceType: 1, visibility: 1, createdAt: 1 } },
      )
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    return docs.map((doc) => ({
      source_id: String(doc._id),
      name: String(doc.name ?? ""),
      status: String(doc.status ?? "pending"),
      source_type: String(doc.sourceType ?? "document"),
      visibility: String(doc.visibility ?? "managers"),
      created_at: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : null,
    }));
  }),

  /**
   * Register a new knowledge source in the quarantined `pending` state. The
   * durable upload authorization + ingestion verification land with the G3.5
   * write-path; this creates the tracked source record only.
   */
  requestUpload: tenantPermissionProcedure("tenant:knowledge:manage")
    .input(
      z
        .object({
          name: z.string().trim().min(1).max(200),
          source_type: z.enum(["document", "url", "note"]),
          content_hash: z.string().min(1).max(128),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const db = (await client_promise).db();
      const result = await db.collection(SOURCES).insertOne({
        scope: "tenant",
        scopeKey: ctx.tenant_context.tenant_id,
        tenantId: ctx.tenant_context.tenant_id,
        sourceType: input.source_type,
        name: input.name,
        visibility: "managers",
        allowedRoles: [],
        contentHash: input.content_hash,
        sourceVersion: 1,
        status: "pending",
        createdByProfileId: ctx.principal.internal_user_id,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return { source_id: result.insertedId.toString(), status: "pending" };
    }),

  /** Soft-delete a tenant knowledge source (pinned to the caller's tenant). */
  remove: tenantPermissionProcedure("tenant:knowledge:manage")
    .input(z.object({ source_id: z.string().min(1) }).strict())
    .mutation(async ({ ctx, input }) => {
      if (!ObjectId.isValid(input.source_id)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Source not found." });
      }
      const db = (await client_promise).db();
      const result = await db.collection(SOURCES).updateOne(
        {
          _id: new ObjectId(input.source_id),
          ...tenant_filter(ctx.tenant_context.tenant_id),
          scope: "tenant",
          deletedAt: null,
        },
        { $set: { deletedAt: new Date(), updatedAt: new Date() } },
      );
      if (result.matchedCount === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Source not found." });
      }
      return { source_id: input.source_id, deleted: true };
    }),
});
