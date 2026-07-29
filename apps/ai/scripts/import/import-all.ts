// apps/ai/scripts/import/import-all.ts
import { build_enrichment_index } from "./lib/enrich";
import { import_materials } from "./import-materials";
import { import_reference } from "./import-reference";
import { import_formulas } from "./import-formulas";
import { read_csv_records } from "./lib/csv";
import { DATASETS, target_identity, mongo_uri, is_dry_run } from "./import.config";

/**
 * Run the full Mongo relational import in dependency order:
 * reference → materials (enriched) → formulas (linked). Prints each report.
 */
async function run_cli(): Promise<void> {
  const { default: client_promise } = await import("@rnd-ai/shared-database");
  void mongo_uri();
  const { tenant_id, actor_profile_id } = target_identity();
  const dry_run = is_dry_run();

  const cosing = read_csv_records(DATASETS.cosing.source);
  const inci_lines = read_csv_records(DATASETS.inci_lines.source);
  const rm_rows = read_csv_records(DATASETS.rm_lines.source);
  const formulas = read_csv_records(DATASETS.rd_formulas.source);
  const formula_lines = read_csv_records(DATASETS.rd_formula_lines.source);

  const client = await client_promise;
  try {
    const db = client.db();
    const ref = await import_reference(cosing, inci_lines, { db, dry_run });
    console.log(ref.summary());
    const index = build_enrichment_index(cosing, inci_lines);
    const mat = await import_materials(rm_rows, index, { db, tenant_id, actor_profile_id, dry_run });
    console.log(mat.report.summary());
    const fml = await import_formulas(formulas, formula_lines, { db, tenant_id, actor_profile_id, dry_run });
    console.log(fml.report.summary());
    if (dry_run) console.log("[import:all] dry-run — no writes performed");
  } finally {
    await client.close();
  }
}

if (process.argv[1]?.includes("import-all")) {
  run_cli().catch((e) => { console.error("[import:all] failed:", e?.message ?? e); process.exitCode = 1; });
}
