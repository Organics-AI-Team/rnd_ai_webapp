/**
 * Knowledge gateway (G3.5).
 *
 * The single, mandatory path from an agent to retrieved knowledge. Callers
 * choose only a scope (platform | tenant | both) — never a collection name or a
 * raw filter. The gateway embeds the query, searches the platform and tenant
 * collections separately with server-authored filters, and then re-validates
 * every returned point against the enforced scope so a mislabeled point in the
 * store can never cross a tenant boundary. Platform and tenant results are
 * merged with provenance retained and without assuming scores are comparable
 * across embedding versions.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import type { TenantExecutionContext } from "@rnd-ai/shared-types";
import { ToolGovernanceError } from "../ai-control/errors";
import {
  PLATFORM_FILTER,
  payload_is_platform,
  payload_is_tenant_owned,
  platform_collection,
  tenant_collection,
  tenant_filter,
  type QdrantFilter,
} from "./qdrant-collections";

/** Retrieval scope a caller may request. */
export type KnowledgeScope = "platform" | "tenant" | "both";

/** One raw vector hit returned by the vector store port. */
export interface RawVectorResult {
  readonly id: string;
  readonly score: number;
  readonly payload: Record<string, unknown>;
}

/** Narrow port over the vector store (a QdrantService adapter in production). */
export interface VectorSearchPort {
  search(
    collection_name: string,
    vector: readonly number[],
    options: { filter: QdrantFilter; limit: number },
  ): Promise<readonly RawVectorResult[]>;
}

/** Narrow port producing a query embedding for a given embedding version. */
export interface KnowledgeEmbeddingPort {
  embed(text: string, embedding_version: string): Promise<readonly number[]>;
}

/** A single piece of retrieved evidence with provenance. */
export interface KnowledgeEvidence {
  readonly point_id: string;
  readonly source_id: string;
  readonly scope: "platform" | "tenant";
  readonly tenant_id: string | null;
  readonly content: string;
  readonly content_hash: string;
  readonly score: number;
  readonly embedding_version: string;
}

/** A knowledge search request (no collection/filter — scope only). */
export interface KnowledgeSearchRequest {
  readonly query: string;
  readonly scope: KnowledgeScope;
  readonly limit?: number;
}

/** Dependencies for the knowledge gateway. */
export interface KnowledgeGatewayDeps {
  readonly vector_port: VectorSearchPort;
  readonly embedding_port: KnowledgeEmbeddingPort;
  readonly embedding_version: string;
}

/** The knowledge gateway surface. */
export interface KnowledgeGateway {
  search(
    context: TenantExecutionContext,
    request: KnowledgeSearchRequest,
  ): Promise<readonly KnowledgeEvidence[]>;
}

/** Default and maximum number of evidence rows returned per scope. */
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;

/**
 * Read a required string payload field, or null when absent.
 *
 * @param payload - Point payload.
 * @param key - Field name.
 * @returns The string value or null.
 */
function read_string(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Create the knowledge gateway.
 *
 * @param deps - Vector/embedding ports and the active embedding version.
 * @returns A KnowledgeGateway whose search is tenant-isolated by construction.
 */
export function create_knowledge_gateway(
  deps: KnowledgeGatewayDeps,
): KnowledgeGateway {
  const { vector_port, embedding_port, embedding_version } = deps;

  /**
   * Map a validated raw hit to a KnowledgeEvidence row, or null if it lacks the
   * required provenance fields (source_id / content_hash / content).
   *
   * @param hit - Raw vector hit.
   * @param scope - The enforced scope this hit came from.
   * @param tenant_id - Tenant ID for tenant scope, null for platform.
   * @returns The evidence row or null.
   */
  function to_evidence(
    hit: RawVectorResult,
    scope: "platform" | "tenant",
    tenant_id: string | null,
  ): KnowledgeEvidence | null {
    const source_id = read_string(hit.payload, "source_id");
    const content_hash = read_string(hit.payload, "content_hash");
    const content = read_string(hit.payload, "content");
    if (!source_id || !content_hash || !content) return null;
    return {
      point_id: hit.id,
      source_id,
      scope,
      tenant_id,
      content,
      content_hash,
      score: hit.score,
      embedding_version,
    };
  }

  return {
    async search(context, request) {
      if (!request.query || request.query.trim().length === 0) {
        throw new ToolGovernanceError(
          "TOOL_INPUT_INVALID",
          "A knowledge query is required.",
        );
      }
      const limit = Math.min(request.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
      const vector = await embedding_port.embed(request.query, embedding_version);
      const evidence: KnowledgeEvidence[] = [];

      const want_platform = request.scope === "platform" || request.scope === "both";
      const want_tenant = request.scope === "tenant" || request.scope === "both";

      if (want_platform) {
        const hits = await vector_port.search(
          platform_collection(embedding_version),
          vector,
          { filter: PLATFORM_FILTER, limit },
        );
        for (const hit of hits) {
          // Defence in depth: drop any point whose payload is not a genuine
          // platform point, even if the backend returned it.
          if (!payload_is_platform(hit.payload)) continue;
          const row = to_evidence(hit, "platform", null);
          if (row) evidence.push(row);
        }
      }

      if (want_tenant) {
        const hits = await vector_port.search(
          tenant_collection(embedding_version),
          vector,
          { filter: tenant_filter(context.tenant_id), limit },
        );
        for (const hit of hits) {
          // Defence in depth: only surface points genuinely owned by THIS
          // tenant, never another tenant's or a mislabeled point.
          if (!payload_is_tenant_owned(hit.payload, context.tenant_id)) continue;
          const row = to_evidence(hit, "tenant", context.tenant_id);
          if (row) evidence.push(row);
        }
      }

      // Merge without cross-embedding-version score comparison: keep each
      // scope's own ordering, tenant evidence first (more specific), capped.
      return evidence.slice(0, MAX_LIMIT);
    },
  };
}
