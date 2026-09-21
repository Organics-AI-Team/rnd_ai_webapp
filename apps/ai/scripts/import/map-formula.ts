// apps/ai/scripts/import/map-formula.ts

/** One linked formula line (percentage = rm_part normalized to the formula total). */
export interface FormulaLineDoc {
  rm_code: string;
  inci_name: string;
  amount: number;
  percentage: number;
  line_number: number;
}

/** A formula header with its linked lines, ready for upsert. */
export interface FormulaImportDoc {
  tenantId: string;
  actorProfileId: string;
  ownerProfileId: string;
  rd_formula_id: string;
  productKey: string;
  name: string;
  version: number;
  status: string;
  lines: FormulaLineDoc[];
}

/** Parse a numeric string, defaulting to 0. */
function num(raw: string): number {
  const n = Number.parseFloat(raw || "");
  return Number.isFinite(n) ? n : 0;
}

/**
 * Group formula headers + lines into one doc per product, keeping the latest
 * version. Lines are linked by rmit_code (→ rm_code); percentage is rm_part
 * normalized so the formula totals 100 (rm_part is the part-per-formula value).
 *
 * @param formulas - rd_formulas rows (rd_formula_id, product_details_id, rd_formula_version, rd_formula_detail).
 * @param lines - rd_formula_lines rows (rd_formula_id, rmit_code, rmit_inci_name, rm_part, line_number).
 * @param tenant_id - Target tenant.
 * @param actor_profile_id - Importing actor.
 * @returns One FormulaImportDoc per product (latest version), with linked lines.
 */
export function group_latest_formulas(
  formulas: Record<string, string>[],
  lines: Record<string, string>[],
  tenant_id: string,
  actor_profile_id: string,
): FormulaImportDoc[] {
  // latest version per product
  const latest = new Map<string, Record<string, string>>();
  for (const f of formulas) {
    const key = (f.product_details_id || "").trim();
    if (!key) continue;
    const v = num(f.rd_formula_version);
    const cur = latest.get(key);
    if (!cur || v > num(cur.rd_formula_version)) latest.set(key, f);
  }
  const kept_ids = new Set([...latest.values()].map((f) => (f.rd_formula_id || "").trim()));

  // lines grouped by rd_formula_id
  const lines_by_formula = new Map<string, Record<string, string>[]>();
  for (const l of lines) {
    const fid = (l.rd_formula_id || "").trim();
    if (!kept_ids.has(fid)) continue;
    const arr = lines_by_formula.get(fid) ?? [];
    arr.push(l);
    lines_by_formula.set(fid, arr);
  }

  const out: FormulaImportDoc[] = [];
  for (const f of latest.values()) {
    const fid = (f.rd_formula_id || "").trim();
    const raw_lines = lines_by_formula.get(fid) ?? [];
    const total = raw_lines.reduce((s, l) => s + num(l.rm_part), 0) || 1;
    const linked: FormulaLineDoc[] = raw_lines
      .filter((l) => (l.rmit_code || "").trim())
      .map((l) => ({
        rm_code: (l.rmit_code || "").trim(),
        inci_name: (l.rmit_inci_name || "").trim(),
        amount: num(l.rm_part),
        percentage: Math.round((num(l.rm_part) / total) * 1e6) / 1e4,
        line_number: num(l.line_number),
      }))
      .sort((a, b) => a.line_number - b.line_number);
    out.push({
      tenantId: tenant_id,
      actorProfileId: actor_profile_id,
      ownerProfileId: actor_profile_id,
      rd_formula_id: fid,
      productKey: (f.product_details_id || "").trim(),
      name: (f.rd_formula_detail || `Formula ${fid}`).trim(),
      version: num(f.rd_formula_version),
      status: (f.record_status || "1").trim(),
      lines: linked,
    });
  }
  return out;
}
