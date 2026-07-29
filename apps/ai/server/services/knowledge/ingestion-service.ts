/**
 * Quarantined tenant knowledge ingestion (G3.5).
 *
 * The service coordinates independently testable ports for object inspection,
 * allowance, malware detection, parsing, chunking, embedding, persistence, and
 * governed Qdrant writes. A source is not marked indexing until every check and
 * transform succeeds, and is not marked ready until the vector write completes.
 */

import { createHash } from "node:crypto";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";

import type {
  GovernedKnowledgeVectorPort,
  KnowledgeQdrantPoint,
} from "./qdrant-collections";
import type {
  UploadAuthorizationClaims,
  UploadAuthorizationSigner,
} from "./upload-authorization";

/** Stable, safe ingestion failure codes persisted on a source. */
export type KnowledgeIngestionErrorCode =
  | "KNOWLEDGE_SOURCE_NOT_FOUND"
  | "KNOWLEDGE_SOURCE_NOT_QUARANTINED"
  | "KNOWLEDGE_UPLOAD_AUTH_INVALID"
  | "KNOWLEDGE_MIME_NOT_ALLOWED"
  | "KNOWLEDGE_FILE_TOO_LARGE"
  | "KNOWLEDGE_CONTENT_HASH_MISMATCH"
  | "KNOWLEDGE_STORAGE_LIMIT_EXCEEDED"
  | "KNOWLEDGE_MALWARE_DETECTED"
  | "KNOWLEDGE_MALWARE_SCAN_FAILED"
  | "KNOWLEDGE_VERSION_INVALID"
  | "KNOWLEDGE_PROVENANCE_REQUIRED"
  | "KNOWLEDGE_CONSENT_REQUIRED"
  | "KNOWLEDGE_IDEMPOTENCY_CONFLICT"
  | "KNOWLEDGE_INGESTION_FAILED";

/** Safe typed failure returned by ingestion. */
export class KnowledgeIngestionError extends Error {
  readonly code: KnowledgeIngestionErrorCode;

  /**
   * Create an ingestion failure safe to persist and return.
   *
   * @param code - Stable safe code.
   * @param message - Non-sensitive explanation.
   */
  constructor(code: KnowledgeIngestionErrorCode, message: string) {
    super(message);
    this.name = "KnowledgeIngestionError";
    this.code = code;
  }
}

/** Tenant source fields required by the ingestion pipeline. */
export interface IngestionSource {
  readonly source_id: string;
  readonly tenant_id: string;
  readonly status: string;
  readonly object_key: string | null;
  readonly content_hash: string;
  readonly visibility: "managers" | "all_members";
  readonly provenance: Record<string, unknown> | null;
  readonly consent_basis: string | null;
  readonly ingestion_idempotency_key: string | null;
}

/** Pinned versions for reproducible parsing and indexing. */
export interface IngestionVersions {
  readonly parser_version: string;
  readonly chunker_version: string;
  readonly embedding_version: string;
}

/** Successful ingestion metadata persisted with a ready source. */
export interface ReadyIngestionResult extends IngestionVersions {
  readonly indexed_points: number;
  readonly detected_mime: string;
  readonly byte_size: number;
  readonly content_hash: string;
  readonly idempotency_key: string;
}

/** Durable source lifecycle and idempotency seam. */
export interface IngestionSourcePort {
  get_tenant_source(
    context: TenantExecutionContext,
    source_id: string,
  ): Promise<IngestionSource | null>;
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

/** Detected facts about the uploaded object (never caller-declared metadata). */
export interface UploadedObjectInspection {
  readonly detected_mime: string;
  readonly byte_size: number;
  readonly content_hash: string;
}

/** Object metadata and hash inspection seam. */
export interface KnowledgeObjectPort {
  inspect(object_key: string): Promise<UploadedObjectInspection>;
}

/** Tenant storage quota seam. */
export interface KnowledgeStorageAllowancePort {
  can_store(
    tenant_id: string,
    source_id: string,
    byte_size: number,
  ): Promise<boolean>;
}

/** Malware scanner outcome. */
export type MalwareScanResult = "clean" | "infected" | "error";

/** Malware scanning seam. */
export interface KnowledgeMalwarePort {
  scan(object_key: string): Promise<MalwareScanResult>;
}

/** Parsed document returned by a pinned parser. */
export interface ParsedKnowledgeDocument {
  readonly text: string;
}

/** Parser seam. */
export interface KnowledgeParserPort {
  parse(
    object_key: string,
    detected_mime: string,
    parser_version: string,
  ): Promise<ParsedKnowledgeDocument>;
}

/** One citable chunk produced by the pinned chunker. */
export interface KnowledgeChunk {
  readonly content: string;
  readonly locator: string;
}

/** Chunker seam. */
export interface KnowledgeChunkerPort {
  chunk(text: string, chunker_version: string): Promise<readonly KnowledgeChunk[]>;
}

/** Batch embedding seam. */
export interface KnowledgeIngestionEmbeddingPort {
  embed_many(
    chunks: readonly string[],
    embedding_version: string,
  ): Promise<readonly (readonly number[])[]>;
}

/** Upload authorization verifier subset used by ingestion. */
export interface UploadAuthorizationVerificationPort
  extends Pick<UploadAuthorizationSigner, "verify"> {}

/** Dependencies for the ingestion service. */
export interface IngestionServiceDeps {
  readonly source_port: IngestionSourcePort;
  readonly upload_authorization_port: UploadAuthorizationVerificationPort;
  readonly object_port: KnowledgeObjectPort;
  readonly storage_allowance_port: KnowledgeStorageAllowancePort;
  readonly malware_port: KnowledgeMalwarePort;
  readonly parser_port: KnowledgeParserPort;
  readonly chunker_port: KnowledgeChunkerPort;
  readonly embedding_port: KnowledgeIngestionEmbeddingPort;
  readonly vector_port: Pick<
    GovernedKnowledgeVectorPort,
    "upsert_tenant" | "delete_tenant_source"
  >;
  readonly versions: IngestionVersions;
}

/** Private ingestion request created after an authorized object upload. */
export interface IngestTenantSourceRequest {
  readonly source_id: string;
  readonly upload_authorization: string;
  readonly idempotency_key: string;
}

/** Ingestion completion result. */
export interface IngestTenantSourceResult {
  readonly source_id: string;
  readonly status: "ready";
  readonly indexed_points: number;
  readonly idempotent: boolean;
}

/** Governed ingestion surface. */
export interface IngestionService {
  ingest_tenant_source(
    context: TenantExecutionContext,
    request: IngestTenantSourceRequest,
  ): Promise<IngestTenantSourceResult>;
}

/** Assert that every transform version is pinned. */
function assert_versions(versions: IngestionVersions): void {
  if (
    !versions.parser_version.trim() ||
    !versions.chunker_version.trim() ||
    !versions.embedding_version.trim()
  ) {
    throw new KnowledgeIngestionError(
      "KNOWLEDGE_VERSION_INVALID",
      "Parser, chunker, and embedding versions must be pinned.",
    );
  }
}

/** Assert that signed upload claims match this exact source and context. */
function assert_upload_claims(
  claims: UploadAuthorizationClaims,
  context: TenantExecutionContext,
  source: IngestionSource,
): void {
  const expected_prefix = `tenants/${context.tenant_id}/knowledge/${source.source_id}/`;
  if (
    claims.tenant_id !== context.tenant_id ||
    claims.actor_profile_id !== context.actor_profile_id ||
    claims.source_id !== source.source_id ||
    claims.object_key !== source.object_key ||
    !claims.object_key.startsWith(expected_prefix)
  ) {
    throw new KnowledgeIngestionError(
      "KNOWLEDGE_UPLOAD_AUTH_INVALID",
      "The upload authorization does not match the source context.",
    );
  }
}

/** Convert a deterministic SHA-256 prefix into a Qdrant-compatible UUID. */
function point_id(source_id: string, chunk_index: number): string {
  const digest = createHash("sha256")
    .update(`${source_id}:${chunk_index}`)
    .digest("hex")
    .slice(0, 32);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join("-");
}

/** Build governed tenant points from chunks and aligned embeddings. */
function build_points(
  source: IngestionSource,
  context: TenantExecutionContext,
  chunks: readonly KnowledgeChunk[],
  vectors: readonly (readonly number[])[],
  versions: IngestionVersions,
): readonly KnowledgeQdrantPoint[] {
  if (
    chunks.length === 0 ||
    chunks.length !== vectors.length ||
    vectors.some((vector) => vector.length === 0)
  ) {
    throw new KnowledgeIngestionError(
      "KNOWLEDGE_INGESTION_FAILED",
      "The document could not be transformed into aligned knowledge points.",
    );
  }
  return chunks.map((chunk, index) => ({
    id: point_id(source.source_id, index),
    vector: vectors[index]!,
    payload: {
      tenant_id: context.tenant_id,
      is_tenant: true,
      source_id: source.source_id,
      content_hash: source.content_hash,
      visibility: source.visibility,
      content: chunk.content,
      locator: chunk.locator,
      parser_version: versions.parser_version,
      chunker_version: versions.chunker_version,
      embedding_version: versions.embedding_version,
    },
  }));
}

/** Normalize an arbitrary failure to a safe ingestion error. */
function safe_error(error: unknown): KnowledgeIngestionError {
  return error instanceof KnowledgeIngestionError
    ? error
    : new KnowledgeIngestionError(
        "KNOWLEDGE_INGESTION_FAILED",
        "Knowledge ingestion failed safely.",
      );
}

/**
 * Create the tenant ingestion service.
 *
 * @param deps - Injectable persistence, security, transform, and vector ports.
 * @returns Quarantine-preserving ingestion orchestration.
 */
export function create_ingestion_service(
  deps: IngestionServiceDeps,
): IngestionService {
  return {
    async ingest_tenant_source(context, request) {
      if (
        request.idempotency_key.trim().length < 8 ||
        request.idempotency_key.length > 128
      ) {
        throw new KnowledgeIngestionError(
          "KNOWLEDGE_IDEMPOTENCY_CONFLICT",
          "A valid ingestion idempotency key is required.",
        );
      }
      const source = await deps.source_port.get_tenant_source(
        context,
        request.source_id,
      );
      if (!source || source.tenant_id !== context.tenant_id) {
        throw new KnowledgeIngestionError(
          "KNOWLEDGE_SOURCE_NOT_FOUND",
          "The knowledge source was not found.",
        );
      }
      if (
        source.status === "ready" &&
        source.ingestion_idempotency_key === request.idempotency_key
      ) {
        return {
          source_id: source.source_id,
          status: "ready",
          indexed_points: 0,
          idempotent: true,
        };
      }
      if (source.status !== "quarantined" || !source.object_key) {
        throw new KnowledgeIngestionError(
          "KNOWLEDGE_SOURCE_NOT_QUARANTINED",
          "The knowledge source is not quarantined for ingestion.",
        );
      }

      let claimed = false;
      try {
        const claim = await deps.source_port.claim_ingestion(
          context,
          source.source_id,
          request.idempotency_key,
          deps.versions,
        );
        if (claim === "already_ready") {
          return {
            source_id: source.source_id,
            status: "ready",
            indexed_points: 0,
            idempotent: true,
          };
        }
        claimed = true;
        if (claim === "conflict") {
          throw new KnowledgeIngestionError(
            "KNOWLEDGE_IDEMPOTENCY_CONFLICT",
            "The source is already claimed by another ingestion request.",
          );
        }
        assert_versions(deps.versions);
        if (!source.provenance || Object.keys(source.provenance).length === 0) {
          throw new KnowledgeIngestionError(
            "KNOWLEDGE_PROVENANCE_REQUIRED",
            "Source provenance is required before ingestion.",
          );
        }
        if (!source.consent_basis?.trim()) {
          throw new KnowledgeIngestionError(
            "KNOWLEDGE_CONSENT_REQUIRED",
            "A source consent basis is required before ingestion.",
          );
        }

        let claims: UploadAuthorizationClaims;
        try {
          claims = await deps.upload_authorization_port.verify(
            request.upload_authorization,
          );
        } catch {
          throw new KnowledgeIngestionError(
            "KNOWLEDGE_UPLOAD_AUTH_INVALID",
            "The upload authorization could not be verified.",
          );
        }
        assert_upload_claims(claims, context, source);

        const inspection = await deps.object_port.inspect(source.object_key);
        if (!claims.allowed_detected_mime_types.includes(inspection.detected_mime)) {
          throw new KnowledgeIngestionError(
            "KNOWLEDGE_MIME_NOT_ALLOWED",
            "The detected file type is not allowed.",
          );
        }
        if (
          inspection.byte_size <= 0 ||
          inspection.byte_size > claims.maximum_bytes
        ) {
          throw new KnowledgeIngestionError(
            "KNOWLEDGE_FILE_TOO_LARGE",
            "The uploaded file exceeds the authorized size.",
          );
        }
        if (inspection.content_hash !== source.content_hash) {
          throw new KnowledgeIngestionError(
            "KNOWLEDGE_CONTENT_HASH_MISMATCH",
            "The uploaded file does not match the registered content hash.",
          );
        }
        const within_allowance = await deps.storage_allowance_port.can_store(
          context.tenant_id,
          source.source_id,
          inspection.byte_size,
        );
        if (!within_allowance) {
          throw new KnowledgeIngestionError(
            "KNOWLEDGE_STORAGE_LIMIT_EXCEEDED",
            "The tenant knowledge storage allowance would be exceeded.",
          );
        }
        const malware_result = await deps.malware_port.scan(source.object_key);
        if (malware_result === "infected") {
          throw new KnowledgeIngestionError(
            "KNOWLEDGE_MALWARE_DETECTED",
            "The uploaded file failed malware screening.",
          );
        }
        if (malware_result !== "clean") {
          throw new KnowledgeIngestionError(
            "KNOWLEDGE_MALWARE_SCAN_FAILED",
            "Malware screening did not complete successfully.",
          );
        }

        const parsed = await deps.parser_port.parse(
          source.object_key,
          inspection.detected_mime,
          deps.versions.parser_version,
        );
        const chunks = await deps.chunker_port.chunk(
          parsed.text,
          deps.versions.chunker_version,
        );
        const vectors = await deps.embedding_port.embed_many(
          chunks.map((chunk) => chunk.content),
          deps.versions.embedding_version,
        );
        const points = build_points(
          source,
          context,
          chunks,
          vectors,
          deps.versions,
        );

        await deps.source_port.mark_indexing(context, source.source_id);
        await deps.vector_port.upsert_tenant(context, points);
        await deps.source_port.mark_ready(context, source.source_id, {
          ...deps.versions,
          indexed_points: points.length,
          detected_mime: inspection.detected_mime,
          byte_size: inspection.byte_size,
          content_hash: inspection.content_hash,
          idempotency_key: request.idempotency_key,
        });
        return {
          source_id: source.source_id,
          status: "ready",
          indexed_points: points.length,
          idempotent: false,
        };
      } catch (error) {
        const failure = safe_error(error);
        if (claimed) {
          try {
            await deps.vector_port.delete_tenant_source(context, source.source_id);
          } catch {
            // The source remains failed/quarantined and therefore unsearchable;
            // cleanup can be retried by reconciliation without leaking details.
          }
          try {
            await deps.source_port.mark_failed(
              context,
              source.source_id,
              failure.code,
            );
          } catch {
            // Preserve the original safe failure code if persistence is degraded.
          }
        }
        throw failure;
      }
    },
  };
}
