// apps/ai/scripts/import/lib/enrich.ts

/** Enrichment fields derived for a material from reference data. */
export interface MaterialEnrichment {
  cas_no: string;
  functions: string[];
  benefits: string[];
  usecase: string[];
  restriction: string;
  description: string;
}

/** Lookup tables keyed by normalized INCI name. */
export interface EnrichmentIndex {
  cosing: Map<string, { cas: string; functions: string[]; restriction: string; description: string }>;
  inci_cas: Map<string, string>;
}

/** Normalize an INCI name for matching (lowercase, collapse spaces). */
function norm(inci: string): string {
  return inci.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Split a CosIng Function cell ("SKIN CONDITIONING, HUMECTANT") into lowercased terms. */
function split_functions(fn: string): string[] {
  return fn
    .split(/[,;/]/)
    .map((f) => f.trim().toLowerCase())
    .filter((f) => f.length > 0);
}

/**
 * Build the enrichment index from CosIng and inci_lines rows.
 *
 * @param cosing - CosIng rows (INCI_name, CAS_No, Function, Restriction, Chem_IUPAC_Name_Description).
 * @param inci_lines - Legacy INCI rows (en_name, cas_no). cas_no "-" is treated as empty.
 * @returns Index consumed by enrich_material.
 */
export function build_enrichment_index(
  cosing: Record<string, string>[],
  inci_lines: Record<string, string>[],
): EnrichmentIndex {
  const cosing_map = new Map<string, { cas: string; functions: string[]; restriction: string; description: string }>();
  for (const r of cosing) {
    const key = norm(r.INCI_name || "");
    if (!key) continue;
    cosing_map.set(key, {
      cas: (r.CAS_No || "").split(",")[0].trim(),
      functions: split_functions(r.Function || ""),
      restriction: (r.Restriction || "").trim(),
      description: (r.Chem_IUPAC_Name_Description || "").trim(),
    });
  }
  const inci_cas = new Map<string, string>();
  for (const r of inci_lines) {
    const key = norm(r.en_name || "");
    const cas = (r.cas_no || "").trim();
    if (key && cas && cas !== "-") inci_cas.set(key, cas);
  }
  return { cosing: cosing_map, inci_cas };
}

/**
 * Enrich one material's INCI name against the index.
 * The material's `inci_name` may hold multiple comma-separated INCIs; the first
 * is used for the primary CAS/function match (multi-INCI blends keep the blend
 * string as-is on the product).
 *
 * @param inci_name - The material's INCI string.
 * @param index - Index from build_enrichment_index.
 * @returns Enrichment fields (empty strings/arrays when unmatched).
 */
export function enrich_material(inci_name: string, index: EnrichmentIndex): MaterialEnrichment {
  const primary = norm((inci_name || "").split(",")[0]);
  const c = index.cosing.get(primary);
  const cas = c?.cas || index.inci_cas.get(primary) || "";
  const functions = c?.functions ?? [];
  return {
    cas_no: cas,
    functions,
    benefits: functions,
    usecase: [],
    restriction: c?.restriction ?? "",
    description: c?.description ?? "",
  };
}
