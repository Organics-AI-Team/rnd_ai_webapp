// apps/ai/scripts/import/import-reference.ts
import type { Db } from "mongodb";
import { read_csv_records } from "./lib/csv";
import { ImportReport } from "./lib/report";
import { DATASETS, mongo_uri, is_dry_run } from "./import.config";

/** Options for a reference import run. */
export interface ReferenceImportOptions {
  db: Db;
  dry_run: boolean;
}

/** Normalize an INCI name (lowercase, collapse spaces). */
function norm(s: string): string {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Import the platform-global `inci_reference` collection from CosIng + inci_lines.
 * Keyed by normalized INCI; CosIng is authoritative, inci_lines fills CAS gaps.
 * Not tenant-scoped (public reference data).
 *
 * @param cosing - CosIng rows.
 * @param inci_lines - Legacy INCI rows.
 * @param opts - Target db, dry-run flag.
 * @returns The integrity report.
 */
export async function import_reference(
  cosing: Record<string, string>[],
  inci_lines: Record<string, string>[],
  opts: ReferenceImportOptions,
): Promise<ImportReport> {
  const report = new ImportReport("reference");
  report.read(cosing.length + inci_lines.length);
  const col = opts.db.collection("inci_reference");
  const now = new Date();
  const merged = new Map<string, Record<string, unknown>>();

  for (const r of cosing) {
    const inci = norm(r.INCI_name || "");
    if (!inci) { report.skipped("missing INCI"); continue; }
    merged.set(inci, {
      inci,
      inci_name: (r.INCI_name || "").trim(),
      cas_no: (r.CAS_No || "").split(",")[0].trim(),
      functions: (r.Function || "").split(/[,;/]/).map((f) => f.trim().toLowerCase()).filter(Boolean),
      restriction: (r.Restriction || "").trim(),
      description: (r.Chem_IUPAC_Name_Description || "").trim(),
      fda_number: "",
    });
  }
  for (const r of inci_lines) {
    const inci = norm(r.en_name || "");
    if (!inci) { report.skipped("missing INCI"); continue; }
    const existing = merged.get(inci) ?? { inci, inci_name: (r.en_name || "").trim(), cas_no: "", functions: [], restriction: "", description: "", fda_number: "" };
    const cas = (r.cas_no || "").trim();
    if (!existing.cas_no && cas && cas !== "-") existing.cas_no = cas;
    existing.fda_number = (r.fda_number || "").trim();
    merged.set(inci, existing);
  }

  if (!opts.dry_run) {
    for (const [inci, doc] of merged) {
      await col.updateOne({ inci }, { $set: { ...doc, updatedAt: now } }, { upsert: true });
      report.upserted(1);
    }
  } else {
    for (const _ of merged) report.upserted(1);
  }
  return report;
}

/** CLI entry. */
async function run_cli(): Promise<void> {
  const { default: client_promise } = await import("@rnd-ai/shared-database");
  void mongo_uri();
  const cosing = read_csv_records(DATASETS.cosing.source);
  const inci_lines = read_csv_records(DATASETS.inci_lines.source);
  const client = await client_promise;
  try {
    const report = await import_reference(cosing, inci_lines, { db: client.db(), dry_run: is_dry_run() });
    console.log(report.summary());
  } finally {
    await client.close();
  }
}

if (process.argv[1]?.includes("import-reference")) {
  run_cli().catch((e) => { console.error("[import:reference] failed:", e?.message ?? e); process.exitCode = 1; });
}
