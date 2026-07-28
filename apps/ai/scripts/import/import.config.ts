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
