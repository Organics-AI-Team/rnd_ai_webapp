// apps/ai/scripts/import/import-materials.ts
import type { Db } from "mongodb";
import type { EnrichmentIndex } from "./lib/enrich";
import { build_enrichment_index } from "./lib/enrich";
import { map_rm_line_to_product } from "./map-material";
import { read_csv_records } from "./lib/csv";
import { ImportReport } from "./lib/report";
import { DATASETS, target_identity, mongo_uri, is_dry_run } from "./import.config";

/** Options for a materials import run. */
export interface MaterialImportOptions {
  db: Db;
  tenant_id: string;
  actor_profile_id: string;
  dry_run: boolean;
}

/** Result of a materials import run. */
export interface MaterialImportResult {
  upserted_total: number;
  report: ImportReport;
}

/**
 * Import raw-material rows into the tenant `products` collection.
 * Idempotent: upsert by (tenantId, productCode). Skips rows missing code/name.
 *
 * @param rows - rm_lines.csv records.
 * @param index - Enrichment index (CAS/functions).
 * @param opts - Target db, tenant/actor, dry-run flag.
 * @returns Upsert total and the integrity report.
 */
export async function import_materials(
  rows: Record<string, string>[],
  index: EnrichmentIndex,
  opts: MaterialImportOptions,
): Promise<MaterialImportResult> {
  const report = new ImportReport("materials");
  report.read(rows.length);
  const products = opts.db.collection("products");
  const now = new Date();
  let upserted_total = 0;
  const seen = new Set<string>();

  for (const row of rows) {
    const doc = map_rm_line_to_product(row, index, opts.tenant_id, opts.actor_profile_id);
    if (!doc) {
      report.skipped("missing rm_code/trade_name");
      continue;
    }
    if (seen.has(doc.productCode)) {
      report.skipped("duplicate rm_code in source");
      continue;
    }
    seen.add(doc.productCode);
    if (!opts.dry_run) {
      await products.updateOne(
        { tenantId: opts.tenant_id, productCode: doc.productCode },
        { $set: { ...doc, updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true },
      );
    }
    upserted_total += 1;
    report.upserted(1);
  }
  return { upserted_total, report };
}

/** CLI entry: read rm_lines + reference, enrich, import, print report. */
async function run_cli(): Promise<void> {
  const { default: client_promise } = await import("@rnd-ai/shared-database");
  void mongo_uri(); // validate env early
  const { tenant_id, actor_profile_id } = target_identity();
  const cosing = read_csv_records(DATASETS.cosing.source);
  const inci_lines = read_csv_records(DATASETS.inci_lines.source);
  const index = build_enrichment_index(cosing, inci_lines);
  const rows = read_csv_records(DATASETS.rm_lines.source);
  const client = await client_promise;
  try {
    const { report } = await import_materials(rows, index, {
      db: client.db(),
      tenant_id,
      actor_profile_id,
      dry_run: is_dry_run(),
    });
    console.log(report.summary());
    if (is_dry_run()) console.log("[import:materials] dry-run — no writes performed");
  } finally {
    await client.close();
  }
}

if (process.argv[1]?.includes("import-materials")) {
  run_cli().catch((e) => {
    console.error("[import:materials] failed:", e?.message ?? e);
    process.exitCode = 1;
  });
}
