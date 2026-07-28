// apps/ai/scripts/import/map-knowledge.ts
import { createHash } from "node:crypto";
import type { KnowledgeQdrantPoint } from "../../server/services/knowledge/qdrant-collections";

/** One citable knowledge document ready for embedding + upsert. */
export interface KnowledgeDoc {
  readonly source_id: string;
  readonly locator: string;
  readonly text: string;
}

/** Maximum characters kept per knowledge document (single-chunk policy). */
const MAX_TEXT_CHARS = 6_000;

/** SHA-256 hex digest of a text (the governed content_hash). */
function sha256_hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Deterministic Qdrant-compatible UUID for one (source, chunk) pair — the
 * same derivation the governed ingestion service uses, so re-running the
 * ingest overwrites the same points (idempotent).
 *
 * @param source_id - Stable source identifier (e.g. "myskin:224127").
 * @param chunk_index - Zero-based chunk index within the source.
 * @returns UUID-shaped lowercase hex string.
 */
export function knowledge_point_id(source_id: string, chunk_index: number): string {
  const digest = sha256_hex(`${source_id}:${chunk_index}`).slice(0, 32);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join("-");
}

/** Trim a raw cell and clip it to a maximum length. */
function clip(value: string | undefined, max: number): string {
  return (value ?? "").trim().slice(0, max);
}

/**
 * Map one myskin scrape row to a platform knowledge document.
 * Skips rows without a stable key (sku → id_product → url) or a name.
 *
 * @param row - Raw CSV record (columns: name, sku, id_product, url,
 *              description, benefits, usage, inci_name, usage_percent_*,
 *              category, price, ...).
 * @returns The knowledge doc, or null when the row is not identifiable.
 */
export function map_myskin_row(row: Record<string, string>): KnowledgeDoc | null {
  const key = clip(row.sku, 64) || clip(row.id_product, 64) || clip(row.url, 300);
  const name = clip(row.name, 200);
  if (!key || !name) return null;
  const usage_lo = clip(row.usage_percent_lo, 16);
  const usage_hi = clip(row.usage_percent_hi, 16);
  const usage_best = clip(row.usage_percent_best, 16);
  const lines = [
    `Market product: ${name}`,
    clip(row.category, 120) ? `Category: ${clip(row.category, 120)}` : "",
    clip(row.inci_name, 300) ? `INCI: ${clip(row.inci_name, 300)}` : "",
    clip(row.description, 2_000) ? `Description: ${clip(row.description, 2_000)}` : "",
    clip(row.benefits, 1_000) ? `Benefits: ${clip(row.benefits, 1_000)}` : "",
    clip(row.usage, 500) ? `Usage: ${clip(row.usage, 500)}` : "",
    usage_lo || usage_hi
      ? `Usage percent: ${usage_lo || "?"}–${usage_hi || "?"} (best ${usage_best || "?"})`
      : "",
    clip(row.price, 40) ? `Price: ${clip(row.price, 40)}` : "",
  ].filter((line) => line.length > 0);
  return {
    source_id: `myskin:${key}`,
    locator: `${name} — ${clip(row.url, 300) || "myskin"}`,
    text: lines.join("\n").slice(0, MAX_TEXT_CHARS),
  };
}

/** Minimal shape of a Plan-1 imported formula document. */
export interface ImportedFormulaDoc {
  readonly rd_formula_id?: string;
  readonly name?: string;
  readonly version?: number;
  readonly productKey?: string;
  readonly lines?: ReadonlyArray<{
    readonly rm_code?: string;
    readonly inci_name?: string;
    readonly percentage?: number;
    readonly amount?: number;
    readonly line_number?: number;
  }>;
}

/**
 * Map one imported tenant formula document to a tenant knowledge document
 * ("similar past formulas" retrieval).
 *
 * @param doc - Formula document from the `formulas` collection (Plan 1 shape).
 * @returns The knowledge doc, or null when the id or name is missing.
 */
export function map_formula_doc(doc: ImportedFormulaDoc): KnowledgeDoc | null {
  const id = (doc.rd_formula_id ?? "").trim();
  const name = (doc.name ?? "").trim();
  if (!id || !name) return null;
  const line_texts = (doc.lines ?? []).map(
    (line) => `- ${line.rm_code ?? "?"} ${line.inci_name ?? ""} ${line.percentage ?? 0}%`,
  );
  const text = [
    `Internal formula: ${name} (v${doc.version ?? 1})`,
    doc.productKey ? `Product: ${doc.productKey}` : "",
    "Ingredients:",
    ...line_texts,
  ]
    .filter((line) => line.length > 0)
    .join("\n")
    .slice(0, MAX_TEXT_CHARS);
  return { source_id: `formula:${id}`, locator: `formula ${name} v${doc.version ?? 1}`, text };
}

/** Common payload fields shared by both scopes. */
function base_payload(doc: KnowledgeDoc, embedding_version: string): Record<string, unknown> {
  return {
    source_id: doc.source_id,
    content_hash: sha256_hex(doc.text),
    visibility: "all_members",
    content: doc.text,
    locator: doc.locator,
    embedding_version,
  };
}

/**
 * Build a platform-scoped governed point (is_tenant=false, NO tenant_id key —
 * payload_is_platform requires the key to be absent, not empty).
 *
 * @param doc - Knowledge document.
 * @param vector - Embedding vector (length must equal the adapter's vector_size).
 * @param embedding_version - Pinned embedding version tag (e.g. "v1").
 * @returns Point accepted by upsert_platform.
 */
export function build_platform_knowledge_point(
  doc: KnowledgeDoc,
  vector: readonly number[],
  embedding_version: string,
): KnowledgeQdrantPoint {
  return {
    id: knowledge_point_id(doc.source_id, 0),
    vector,
    payload: { is_tenant: false, ...base_payload(doc, embedding_version) },
  };
}

/**
 * Build a tenant-scoped governed point (is_tenant=true + tenant_id).
 *
 * @param tenant_id - Owning tenant id.
 * @param doc - Knowledge document.
 * @param vector - Embedding vector.
 * @param embedding_version - Pinned embedding version tag.
 * @returns Point accepted by upsert_tenant for this tenant.
 */
export function build_tenant_knowledge_point(
  tenant_id: string,
  doc: KnowledgeDoc,
  vector: readonly number[],
  embedding_version: string,
): KnowledgeQdrantPoint {
  return {
    id: knowledge_point_id(doc.source_id, 0),
    vector,
    payload: { tenant_id, is_tenant: true, ...base_payload(doc, embedding_version) },
  };
}
