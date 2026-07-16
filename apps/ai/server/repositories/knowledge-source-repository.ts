/**
 * Knowledge source repository (G3.5).
 *
 * Tenant-scoped access to the knowledge_sources collection, used by the
 * citation builder to prove a retrieved point is traceable to a ready tenant
 * source or an approved platform source. Tenant lookups are always pinned to
 * the caller's tenant; a platform lookup never leaks a tenant source.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { Long, ObjectId, type Db, type Document } from "mongodb";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";
import type {
  Citation,
  CitationSource,
  CitationSourceLookup,
} from "../services/knowledge/citation-builder";
import {
  KnowledgeIngestionError,
  type IngestionSource,
  type IngestionSourcePort,
  type IngestionVersions,
  type KnowledgeIngestionErrorCode,
  type ReadyIngestionResult,
} from "../services/knowledge/ingestion-service";
import {
  UploadAuthorizationError,
  type UploadActorContext,
  type UploadAuthorizationSource,
  type UploadAuthorizationSourcePort,
} from "../services/knowledge/upload-authorization";

const SOURCES_COLLECTION = "knowledge_sources";

/** Repository surface (a CitationSourceLookup plus admin reads). */
export interface KnowledgeSourceRepository
  extends CitationSourceLookup,
    UploadAuthorizationSourcePort {
  get_source(
    source_id: string,
    scope: "platform" | "tenant",
    tenant_id: string | null,
  ): Promise<CitationSource | null>;
  get_tenant_source(
    tenant_id: string,
    source_id: string,
  ): Promise<IngestionSource | null>;
  bind_upload(
    context: UploadActorContext,
    source_id: string,
    object_key: string,
  ): Promise<void>;
  claim_ingestion(
    context: TenantExecutionContext,
    source_id: string,
    idempotency_key: string,
    versions: IngestionVersions,
  ): Promise<"claimed" | "already_ready" | "conflict">;
  mark_indexing(
    context: TenantExecutionContext,
    source_id: string,
  ): Promise<void>;
  mark_ready(
    context: TenantExecutionContext,
    source_id: string,
    result: ReadyIngestionResult,
  ): Promise<void>;
  mark_failed(
    context: TenantExecutionContext,
    source_id: string,
    safe_error_code: KnowledgeIngestionErrorCode,
  ): Promise<void>;
}

/**
 * Map a stored knowledge_sources document to a CitationSource.
 *
 * @param doc - The Mongo document.
 * @returns The mapped citation source.
 */
function to_citation_source(doc: Document): CitationSource {
  return {
    source_id: String(doc._id),
    source_name: String(doc.name ?? ""),
    status: String(doc.status ?? "pending"),
    scope: doc.scope === "tenant" ? "tenant" : "platform",
    tenant_id: doc.tenantId ? String(doc.tenantId) : null,
  };
}

/** Build a tenant-id query spanning string and ObjectId storage encodings. */
function tenant_match(tenant_id: string): Document {
  const values: (string | ObjectId)[] = [tenant_id];
  if (ObjectId.isValid(tenant_id)) values.push(new ObjectId(tenant_id));
  return { tenantId: { $in: values } };
}

/** Map a stored tenant source to the ingestion/upload contract. */
function to_ingestion_source(doc: Document): IngestionSource {
  const provenance =
    doc.provenance && typeof doc.provenance === "object"
      ? (doc.provenance as Record<string, unknown>)
      : null;
  return {
    source_id: String(doc._id),
    tenant_id: String(doc.tenantId),
    status: String(doc.status ?? "pending"),
    object_key: typeof doc.objectKey === "string" ? doc.objectKey : null,
    content_hash: String(doc.contentHash ?? ""),
    visibility: doc.visibility === "all_members" ? "all_members" : "managers",
    provenance,
    consent_basis:
      typeof doc.consentBasis === "string" ? doc.consentBasis : null,
    ingestion_idempotency_key:
      typeof doc.ingestionIdempotencyKey === "string"
        ? doc.ingestionIdempotencyKey
        : null,
  };
}

/** Build the immutable tenant/source base query. */
function tenant_source_query(
  tenant_id: string,
  source_id: string,
): Document | null {
  if (!ObjectId.isValid(source_id)) return null;
  return {
    _id: new ObjectId(source_id),
    ...tenant_match(tenant_id),
    scope: "tenant",
    deletedAt: null,
  };
}

/**
 * Create the knowledge source repository.
 *
 * @param db - Connected database exposing knowledge_sources.
 * @returns A tenant-scoped KnowledgeSourceRepository.
 */
export function create_knowledge_source_repository(
  db: Db,
): KnowledgeSourceRepository {
  const sources = db.collection(SOURCES_COLLECTION);

  return {
    async get_source(source_id, scope, tenant_id) {
      if (!ObjectId.isValid(source_id)) return null;
      const base: Document = {
        _id: new ObjectId(source_id),
        deletedAt: null,
      };
      if (scope === "platform") {
        const doc = await sources.findOne({ ...base, scope: "platform" });
        return doc ? to_citation_source(doc) : null;
      }
      // Tenant scope: pin to the caller's tenant, matching both encodings.
      if (!tenant_id) return null;
      const tenant_values: (string | ObjectId)[] = [tenant_id];
      if (ObjectId.isValid(tenant_id)) tenant_values.push(new ObjectId(tenant_id));
      const doc = await sources.findOne({
        ...base,
        scope: "tenant",
        tenantId: { $in: tenant_values },
      });
      return doc ? to_citation_source(doc) : null;
    },

    async get_tenant_source(tenant_id, source_id) {
      const query = tenant_source_query(tenant_id, source_id);
      if (!query) return null;
      const doc = await sources.findOne(query);
      return doc ? to_ingestion_source(doc) : null;
    },

    async bind_upload(context, source_id, object_key) {
      const query = tenant_source_query(context.tenant_id, source_id);
      const expected_key = `tenants/${context.tenant_id}/knowledge/${source_id}/source`;
      if (!query || object_key !== expected_key) {
        throw new UploadAuthorizationError(
          "KNOWLEDGE_SOURCE_NOT_FOUND",
          "The knowledge source was not found.",
        );
      }
      const result = await sources.updateOne(
        {
          ...query,
          status: { $in: ["pending", "quarantined"] },
        },
        {
          $set: {
            objectKey: object_key,
            status: "quarantined",
            errorCode: null,
            updatedAt: new Date(),
          },
        },
      );
      if (result.matchedCount === 0) {
        throw new UploadAuthorizationError(
          "KNOWLEDGE_SOURCE_NOT_FOUND",
          "The knowledge source was not found.",
        );
      }
    },

    async claim_ingestion(context, source_id, idempotency_key, versions) {
      const current = await this.get_tenant_source(context.tenant_id, source_id);
      if (!current) {
        throw new KnowledgeIngestionError(
          "KNOWLEDGE_SOURCE_NOT_FOUND",
          "The knowledge source was not found.",
        );
      }
      if (
        current.status === "ready" &&
        current.ingestion_idempotency_key === idempotency_key
      ) {
        return "already_ready";
      }
      if (
        current.ingestion_idempotency_key &&
        current.ingestion_idempotency_key !== idempotency_key
      ) {
        return "conflict";
      }
      const query = tenant_source_query(context.tenant_id, source_id)!;
      const result = await sources.updateOne(
        {
          ...query,
          status: "quarantined",
          $or: [
            { ingestionIdempotencyKey: { $exists: false } },
            { ingestionIdempotencyKey: null },
            { ingestionIdempotencyKey: idempotency_key },
          ],
        },
        {
          $set: {
            ingestionIdempotencyKey: idempotency_key,
            parserVersion: versions.parser_version,
            chunkerVersion: versions.chunker_version,
            embeddingVersion: versions.embedding_version,
            errorCode: null,
            updatedAt: new Date(),
          },
        },
      );
      if (result.matchedCount === 1) return "claimed";
      const after = await this.get_tenant_source(context.tenant_id, source_id);
      return after?.status === "ready" &&
        after.ingestion_idempotency_key === idempotency_key
        ? "already_ready"
        : "conflict";
    },

    async mark_indexing(context, source_id) {
      const query = tenant_source_query(context.tenant_id, source_id);
      const result = query
        ? await sources.updateOne(
            { ...query, status: "quarantined" },
            { $set: { status: "indexing", updatedAt: new Date() } },
          )
        : { matchedCount: 0 };
      if (result.matchedCount === 0) {
        throw new KnowledgeIngestionError(
          "KNOWLEDGE_SOURCE_NOT_FOUND",
          "The knowledge source was not found for indexing.",
        );
      }
    },

    async mark_ready(context, source_id, result) {
      const query = tenant_source_query(context.tenant_id, source_id);
      const update = query
        ? await sources.updateOne(
            { ...query, status: "indexing" },
            {
              $set: {
                status: "ready",
                parserVersion: result.parser_version,
                chunkerVersion: result.chunker_version,
                embeddingVersion: result.embedding_version,
                detectedMime: result.detected_mime,
                byteSize: Long.fromNumber(result.byte_size),
                contentHash: result.content_hash,
                indexedPoints: result.indexed_points,
                ingestionIdempotencyKey: result.idempotency_key,
                errorCode: null,
                updatedAt: new Date(),
              },
            },
          )
        : { matchedCount: 0 };
      if (update.matchedCount === 0) {
        throw new KnowledgeIngestionError(
          "KNOWLEDGE_SOURCE_NOT_FOUND",
          "The knowledge source was not found for completion.",
        );
      }
    },

    async mark_failed(context, source_id, safe_error_code) {
      const query = tenant_source_query(context.tenant_id, source_id);
      if (!query) return;
      await sources.updateOne(
        { ...query, status: { $nin: ["ready", "deleted"] } },
        {
          $set: {
            status: "failed",
            errorCode: safe_error_code,
            updatedAt: new Date(),
          },
        },
      );
    },
  };
}

/**
 * Adapt the repository's tenant-id lookup to the trusted-context ingestion port.
 *
 * @param repository - Concrete Mongo knowledge source repository.
 * @returns Ingestion lifecycle port with tenant scope derived from context.
 */
export function create_ingestion_source_port(
  repository: KnowledgeSourceRepository,
): IngestionSourcePort {
  return {
    async get_tenant_source(context, source_id) {
      return repository.get_tenant_source(context.tenant_id, source_id);
    },
    async claim_ingestion(context, source_id, idempotency_key, versions) {
      return repository.claim_ingestion(
        context,
        source_id,
        idempotency_key,
        versions,
      );
    },
    async mark_indexing(context, source_id) {
      await repository.mark_indexing(context, source_id);
    },
    async mark_ready(context, source_id, result) {
      await repository.mark_ready(context, source_id, result);
    },
    async mark_failed(context, source_id, safe_error_code) {
      await repository.mark_failed(context, source_id, safe_error_code);
    },
  };
}

export type { Citation };
