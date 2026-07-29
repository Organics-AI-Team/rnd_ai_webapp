/**
 * Qdrant knowledge collection contracts (G3.5).
 *
 * Defines the platform/tenant collection names (versioned by embedding model)
 * and the server-authored payload filters that isolate tenant knowledge. These
 * filters are built internally by the KnowledgeGateway — a caller can never
 * supply a collection name or a raw filter — and are also used to validate
 * retrieved points, so a mislabeled payload in the store cannot cross tenants.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

/** Payload keys carried on every knowledge point. */
export const KNOWLEDGE_PAYLOAD_KEYS = Object.freeze({
  tenant_id: "tenant_id",
  is_tenant: "is_tenant",
  source_id: "source_id",
  content_hash: "content_hash",
  visibility: "visibility",
});

/** Keyword payload indexes created on each knowledge collection. */
export const KNOWLEDGE_PAYLOAD_INDEXES: readonly string[] = Object.freeze([
  KNOWLEDGE_PAYLOAD_KEYS.tenant_id,
  KNOWLEDGE_PAYLOAD_KEYS.is_tenant,
  KNOWLEDGE_PAYLOAD_KEYS.source_id,
  KNOWLEDGE_PAYLOAD_KEYS.content_hash,
  KNOWLEDGE_PAYLOAD_KEYS.visibility,
]);

/** A Qdrant filter shape (minimal subset used by the gateway). */
export interface QdrantFilter {
  readonly [key: string]: unknown;
  readonly must: ReadonlyArray<Record<string, unknown>>;
}

/** One governed knowledge point written to Qdrant. */
export interface KnowledgeQdrantPoint {
  readonly id: string;
  readonly vector: readonly number[];
  readonly payload: Record<string, unknown>;
}

/** One raw result returned by the low-level Qdrant driver. */
export interface KnowledgeQdrantResult {
  readonly id: string;
  readonly score: number;
  readonly payload: Record<string, unknown>;
}

/** Payload index schema understood by Qdrant. */
export type KnowledgePayloadIndexSchema =
  | "keyword"
  | { readonly type: "keyword"; readonly is_tenant: true };

/** Collection definition passed across the production Qdrant driver seam. */
export interface KnowledgeCollectionDefinition {
  readonly name: string;
  readonly vector_size: number;
  readonly distance: "Cosine";
  readonly on_disk_payload: boolean;
  readonly payload_indexes: ReadonlyArray<{
    readonly field_name: string;
    readonly field_schema: KnowledgePayloadIndexSchema;
  }>;
}

/**
 * Raw production-driver boundary. Only the governed adapter in this module
 * receives this capability; routes, tools, and ingestion never do.
 */
export interface KnowledgeQdrantDriver {
  ensure_collection(definition: KnowledgeCollectionDefinition): Promise<void>;
  search(
    collection_name: string,
    vector: readonly number[],
    options: {
      readonly topK: number;
      readonly filter: QdrantFilter;
      readonly withPayload: true;
    },
  ): Promise<readonly KnowledgeQdrantResult[]>;
  upsert(
    collection_name: string,
    points: readonly KnowledgeQdrantPoint[],
  ): Promise<void>;
  delete(
    collection_name: string,
    filter: Record<string, unknown>,
  ): Promise<void>;
}

/** Stable governed-knowledge vector-store failure. */
export class KnowledgeQdrantError extends Error {
  readonly code: "KNOWLEDGE_PAYLOAD_INVALID";

  /**
   * Create a safe payload-contract failure.
   *
   * @param message - Non-sensitive contract failure description.
   */
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeQdrantError";
    this.code = "KNOWLEDGE_PAYLOAD_INVALID";
  }
}

/** The only Qdrant surface available to governed knowledge consumers. */
export interface GovernedKnowledgeVectorPort {
  ensure_collections(): Promise<void>;
  search_platform(
    vector: readonly number[],
    limit: number,
  ): Promise<readonly KnowledgeQdrantResult[]>;
  search_tenant(
    context: { readonly tenant_id: string },
    vector: readonly number[],
    limit: number,
  ): Promise<readonly KnowledgeQdrantResult[]>;
  upsert_platform(points: readonly KnowledgeQdrantPoint[]): Promise<void>;
  upsert_tenant(
    context: { readonly tenant_id: string },
    points: readonly KnowledgeQdrantPoint[],
  ): Promise<void>;
  delete_platform_source(source_id: string): Promise<void>;
  delete_tenant_source(
    context: { readonly tenant_id: string },
    source_id: string,
  ): Promise<void>;
}

/** Configuration for the governed Qdrant adapter. */
export interface KnowledgeQdrantAdapterOptions {
  readonly driver: KnowledgeQdrantDriver;
  readonly embedding_version: string;
  readonly vector_size: number;
}

/**
 * Name of the platform (shared, non-tenant) knowledge collection.
 *
 * @param embedding_version - Embedding model version tag (e.g. "v1").
 * @returns The collection name, e.g. "platform_knowledge_v1".
 */
export function platform_collection(embedding_version: string): string {
  return `platform_knowledge_${embedding_version}`;
}

/**
 * Name of the tenant knowledge collection.
 *
 * @param embedding_version - Embedding model version tag.
 * @returns The collection name, e.g. "tenant_knowledge_v1".
 */
export function tenant_collection(embedding_version: string): string {
  return `tenant_knowledge_${embedding_version}`;
}

/**
 * Build the enforced filter for a tenant's own knowledge.
 *
 * @param tenant_id - Verified tenant ID from the execution context.
 * @returns Filter requiring tenant_id match and is_tenant=true.
 */
export function tenant_filter(tenant_id: string): QdrantFilter {
  return {
    must: [
      { key: KNOWLEDGE_PAYLOAD_KEYS.tenant_id, match: { value: tenant_id } },
      { key: KNOWLEDGE_PAYLOAD_KEYS.is_tenant, match: { value: true } },
    ],
  };
}

/** Enforced filter for platform (shared) knowledge: is_tenant=false, no tenant. */
export const PLATFORM_FILTER: QdrantFilter = Object.freeze({
  must: [
    { key: KNOWLEDGE_PAYLOAD_KEYS.is_tenant, match: { value: false } },
    { is_empty: { key: KNOWLEDGE_PAYLOAD_KEYS.tenant_id } },
  ],
});

/**
 * Validate that a retrieved payload genuinely belongs to the tenant scope. Used
 * as defence-in-depth after retrieval so a mislabeled point (e.g. another
 * tenant's ID stored in the tenant collection) can never be surfaced.
 *
 * @param payload - The point payload.
 * @param tenant_id - The caller's verified tenant ID.
 * @returns True only when the payload is a genuine tenant point for this tenant.
 */
export function payload_is_tenant_owned(
  payload: Record<string, unknown>,
  tenant_id: string,
): boolean {
  return (
    payload[KNOWLEDGE_PAYLOAD_KEYS.is_tenant] === true &&
    payload[KNOWLEDGE_PAYLOAD_KEYS.tenant_id] === tenant_id
  );
}

/**
 * Validate that a retrieved payload is a genuine platform (shared) point.
 *
 * @param payload - The point payload.
 * @returns True only when the payload is a platform point (is_tenant=false and
 *          no tenant_id).
 */
export function payload_is_platform(payload: Record<string, unknown>): boolean {
  const tenant_id = payload[KNOWLEDGE_PAYLOAD_KEYS.is_tenant];
  const has_tenant = Object.prototype.hasOwnProperty.call(
    payload,
    KNOWLEDGE_PAYLOAD_KEYS.tenant_id,
  );
  return tenant_id === false && !has_tenant;
}

/** Build the payload indexes for a governed collection. */
function payload_indexes(
  tenant_collection_index: boolean,
): KnowledgeCollectionDefinition["payload_indexes"] {
  return KNOWLEDGE_PAYLOAD_INDEXES.map((field_name) => ({
    field_name,
    field_schema:
      tenant_collection_index && field_name === KNOWLEDGE_PAYLOAD_KEYS.tenant_id
        ? { type: "keyword" as const, is_tenant: true as const }
        : ("keyword" as const),
  }));
}

/** Assert common and scope-specific payload invariants before any write. */
function assert_payload_contract(
  point: KnowledgeQdrantPoint,
  vector_size: number,
  scope: "platform" | "tenant",
  tenant_id: string | null,
): void {
  const payload = point.payload;
  const required_string_fields = [
    KNOWLEDGE_PAYLOAD_KEYS.source_id,
    KNOWLEDGE_PAYLOAD_KEYS.content_hash,
    KNOWLEDGE_PAYLOAD_KEYS.visibility,
    "content",
    "locator",
  ];
  const strings_valid = required_string_fields.every(
    (key) => typeof payload[key] === "string" && String(payload[key]).length > 0,
  );
  const hash_valid = /^[a-f0-9]{64}$/.test(
    String(payload[KNOWLEDGE_PAYLOAD_KEYS.content_hash] ?? ""),
  );
  const visibility_valid = ["managers", "all_members"].includes(
    String(payload[KNOWLEDGE_PAYLOAD_KEYS.visibility] ?? ""),
  );
  const vector_valid =
    point.id.length > 0 &&
    point.vector.length === vector_size &&
    point.vector.every(Number.isFinite);
  const scope_valid =
    scope === "tenant"
      ? payload_is_tenant_owned(payload, tenant_id ?? "")
      : payload_is_platform(payload);
  if (
    !strings_valid ||
    !hash_valid ||
    !visibility_valid ||
    !vector_valid ||
    !scope_valid
  ) {
    throw new KnowledgeQdrantError(
      `Point ${point.id || "<empty>"} violates the ${scope} knowledge payload contract.`,
    );
  }
}

/** Build a source cleanup filter by extending a server-authored scope filter. */
function source_filter(
  filter: QdrantFilter,
  source_id: string,
): QdrantFilter {
  if (source_id.trim().length === 0) {
    throw new KnowledgeQdrantError("A source id is required for cleanup.");
  }
  return {
    must: [
      ...filter.must,
      {
        key: KNOWLEDGE_PAYLOAD_KEYS.source_id,
        match: { value: source_id },
      },
    ],
  };
}

/**
 * Create the governed Qdrant adapter.
 *
 * Collection names and filters are closed over here. No public operation takes
 * either value, which prevents a tool, route, or ingestion caller from swapping
 * tenant scope. The generic QdrantService remains only as a documented legacy
 * boundary for pre-control-plane RAG callers.
 *
 * @param options - Raw driver plus pinned embedding collection configuration.
 * @returns A sealed knowledge-vector capability.
 */
export function create_qdrant_knowledge_adapter(
  options: KnowledgeQdrantAdapterOptions,
): GovernedKnowledgeVectorPort {
  const { driver, embedding_version, vector_size } = options;
  if (!/^[A-Za-z0-9_-]+$/.test(embedding_version) || vector_size <= 0) {
    throw new KnowledgeQdrantError("Knowledge collection configuration is invalid.");
  }
  const platform_name = platform_collection(embedding_version);
  const tenant_name = tenant_collection(embedding_version);

  return {
    async ensure_collections() {
      await driver.ensure_collection({
        name: platform_name,
        vector_size,
        distance: "Cosine",
        on_disk_payload: true,
        payload_indexes: payload_indexes(false),
      });
      await driver.ensure_collection({
        name: tenant_name,
        vector_size,
        distance: "Cosine",
        on_disk_payload: true,
        payload_indexes: payload_indexes(true),
      });
    },

    async search_platform(vector, limit) {
      return driver.search(platform_name, vector, {
        topK: limit,
        filter: PLATFORM_FILTER,
        withPayload: true,
      });
    },

    async search_tenant(context, vector, limit) {
      return driver.search(tenant_name, vector, {
        topK: limit,
        filter: tenant_filter(context.tenant_id),
        withPayload: true,
      });
    },

    async upsert_platform(points) {
      for (const point of points) {
        assert_payload_contract(point, vector_size, "platform", null);
      }
      await driver.upsert(platform_name, points);
    },

    async upsert_tenant(context, points) {
      for (const point of points) {
        assert_payload_contract(
          point,
          vector_size,
          "tenant",
          context.tenant_id,
        );
      }
      await driver.upsert(tenant_name, points);
    },

    async delete_platform_source(source_id) {
      await driver.delete(
        platform_name,
        source_filter(PLATFORM_FILTER, source_id),
      );
    },

    async delete_tenant_source(context, source_id) {
      await driver.delete(
        tenant_name,
        source_filter(tenant_filter(context.tenant_id), source_id),
      );
    },
  };
}
