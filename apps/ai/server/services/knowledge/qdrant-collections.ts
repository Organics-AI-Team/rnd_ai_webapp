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
  readonly must: ReadonlyArray<Record<string, unknown>>;
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
  const has_tenant =
    payload[KNOWLEDGE_PAYLOAD_KEYS.tenant_id] !== undefined &&
    payload[KNOWLEDGE_PAYLOAD_KEYS.tenant_id] !== null;
  return tenant_id === false && !has_tenant;
}
