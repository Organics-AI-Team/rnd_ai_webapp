// apps/ai/scripts/import/import.config.ts
import { resolve } from "node:path";

/** Natural-key field used to upsert each dataset idempotently. */
export interface DatasetConfig {
  readonly source: string; // absolute path to the CSV
  readonly natural_key: string; // logical key (for docs/report only)
}

/** Repo-root-relative default location of the legacy rnd_ai export. */
const EXPORT_DIR = resolve(process.env.RND_EXPORT_DIR ?? resolve(process.cwd(), "..", "rnd_ai"));

/** Absolute source paths for each migrated dataset. */
export const DATASETS = {
  rm_lines: { source: resolve(EXPORT_DIR, "internal_raw/sql_raw/rm_lines.csv"), natural_key: "rm_code" },
  inci_lines: { source: resolve(EXPORT_DIR, "internal_raw/sql_raw/inci_lines.csv"), natural_key: "en_name" },
  cosing: { source: resolve(EXPORT_DIR, "inci_datasets/cosing_ingredients_clean_final.csv"), natural_key: "INCI_name" },
  rd_formulas: { source: resolve(EXPORT_DIR, "internal_raw/sql_raw/rd_formulas.csv"), natural_key: "rd_formula_id" },
  rd_formula_lines: { source: resolve(EXPORT_DIR, "internal_raw/sql_raw/rd_formula_lines.csv"), natural_key: "id" },
  formula_masters: { source: resolve(EXPORT_DIR, "internal_raw/sql_raw/formula_masters.csv"), natural_key: "formula_masters_id" },
  myskin: {
    source: resolve(
      EXPORT_DIR,
      "myskin_scraping/raws/ALL_PRODUCTS_ULTRA_FAST_20250916_194921_clean.csv",
    ),
    natural_key: "sku",
  },
} as const satisfies Record<string, DatasetConfig>;

/** Required target identity for tenant-scoped imports. */
export function target_identity(): { tenant_id: string; actor_profile_id: string } {
  const tenant_id = process.env.IMPORT_TENANT_ID?.trim();
  const actor_profile_id = process.env.IMPORT_ACTOR_PROFILE_ID?.trim();
  if (!tenant_id || !actor_profile_id) {
    throw new Error("IMPORT_TENANT_ID and IMPORT_ACTOR_PROFILE_ID must be set");
  }
  return { tenant_id, actor_profile_id };
}

/** Mongo connection string from the standard env vars. */
export function mongo_uri(): string {
  const uri = process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!uri) throw new Error("MONGODB_URI or DATABASE_URL must be set");
  return uri;
}

/** True when --dry-run is present on the CLI. */
export function is_dry_run(): boolean {
  return process.argv.includes("--dry-run");
}

/** Env-driven settings for the governed Qdrant knowledge ingest. */
export interface KnowledgeIngestConfig {
  readonly gemini_api_key: string;
  readonly embedding_model: string;
  readonly embedding_version: string;
  readonly embedding_dimensions: number;
  readonly batch_size: number;
  readonly batch_delay_ms: number;
  readonly progress_file: string;
}

/**
 * Read the knowledge-ingest configuration from the environment.
 * Defaults MUST mirror apps/ai/server/worker.ts so the ingest writes into the
 * exact collections the production knowledge.search reads
 * (platform_knowledge_v1 / tenant_knowledge_v1, 768-dim).
 *
 * @returns Frozen ingest configuration.
 * @throws Error when GEMINI_API_KEY is unset (embeddings are mandatory).
 */
export function knowledge_ingest_config(): KnowledgeIngestConfig {
  const gemini_api_key = process.env.GEMINI_API_KEY?.trim();
  if (!gemini_api_key) {
    throw new Error("GEMINI_API_KEY must be set for the knowledge ingest");
  }
  return {
    gemini_api_key,
    embedding_model: process.env.AI_EMBEDDING_MODEL?.trim() || "gemini-embedding-001",
    embedding_version: process.env.AI_EMBEDDING_VERSION?.trim() || "v1",
    embedding_dimensions: Number.parseInt(process.env.AI_EMBEDDING_DIMENSIONS || "768", 10),
    batch_size: Number.parseInt(process.env.KNOWLEDGE_BATCH_SIZE || "50", 10),
    batch_delay_ms: Number.parseInt(process.env.KNOWLEDGE_BATCH_DELAY_MS || "1000", 10),
    progress_file:
      process.env.KNOWLEDGE_PROGRESS_FILE ||
      resolve(process.cwd(), ".import-progress-myskin.json"),
  };
}
