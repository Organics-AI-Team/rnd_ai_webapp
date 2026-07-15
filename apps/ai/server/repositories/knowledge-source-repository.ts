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

import { ObjectId, type Db, type Document } from "mongodb";
import type {
  Citation,
  CitationSource,
  CitationSourceLookup,
} from "../services/knowledge/citation-builder";

const SOURCES_COLLECTION = "knowledge_sources";

/** Repository surface (a CitationSourceLookup plus admin reads). */
export interface KnowledgeSourceRepository extends CitationSourceLookup {
  get_source(
    source_id: string,
    scope: "platform" | "tenant",
    tenant_id: string | null,
  ): Promise<CitationSource | null>;
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
  };
}

export type { Citation };
