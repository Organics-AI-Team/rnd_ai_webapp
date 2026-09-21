// apps/ai/scripts/import/import-formulas.ts
import type { Db } from "mongodb";
import { group_latest_formulas } from "./map-formula";
import { read_csv_records } from "./lib/csv";
import { ImportReport } from "./lib/report";
import { DATASETS, target_identity, mongo_uri, is_dry_run } from "./import.config";

/** Options for a formulas import run. */
export interface FormulaImportOptions {
  db: Db;
  tenant_id: string;
  actor_profile_id: string;
  dry_run: boolean;
}

/** Result of a formulas import run. */
export interface FormulaImportResult {
  upserted_total: number;
  report: ImportReport;
}

/**
 * Import historical formulas (latest version per product) into the tenant
 * `formulas` collection. Idempotent by (tenantId, rd_formula_id). Lines whose
 * rm_code has no matching product are counted as "unmatched rm_code" in the
 * report but retained on the formula (so the record is complete).
 *
 * @param formulas - rd_formulas rows.
 * @param lines - rd_formula_lines rows.
 * @param opts - Target db, tenant/actor, dry-run.
 * @returns Upsert total and the integrity report.
 */
export async function import_formulas(
  formulas: Record<string, string>[],
  lines: Record<string, string>[],
  opts: FormulaImportOptions,
): Promise<FormulaImportResult> {
  const report = new ImportReport("formulas");
  report.read(formulas.length);
  const docs = group_latest_formulas(formulas, lines, opts.tenant_id, opts.actor_profile_id);
  const col = opts.db.collection("formulas");
  const products = opts.db.collection("products");
  const now = new Date();

  const known = new Set(
    (await products.find({ tenantId: opts.tenant_id }, { projection: { productCode: 1 } }).toArray()).map(
      (p) => p.productCode as string,
    ),
  );

  let upserted_total = 0;
  for (const doc of docs) {
    for (const line of doc.lines) {
      if (!known.has(line.rm_code)) report.skipped("unmatched rm_code");
    }
    if (!opts.dry_run) {
      await col.updateOne(
        { tenantId: opts.tenant_id, rd_formula_id: doc.rd_formula_id },
        { $set: { ...doc, updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true },
      );
    }
    upserted_total += 1;
    report.upserted(1);
  }
  return { upserted_total, report };
}

/** CLI entry. */
async function run_cli(): Promise<void> {
  const { default: client_promise } = await import("@rnd-ai/shared-database");
  void mongo_uri();
  const { tenant_id, actor_profile_id } = target_identity();
  const formulas = read_csv_records(DATASETS.rd_formulas.source);
  const lines = read_csv_records(DATASETS.rd_formula_lines.source);
  const client = await client_promise;
  try {
    const { report } = await import_formulas(formulas, lines, {
      db: client.db(),
      tenant_id,
      actor_profile_id,
      dry_run: is_dry_run(),
    });
    console.log(report.summary());
  } finally {
    await client.close();
  }
}

if (process.argv[1]?.includes("import-formulas")) {
  run_cli().catch((e) => { console.error("[import:formulas] failed:", e?.message ?? e); process.exitCode = 1; });
}
