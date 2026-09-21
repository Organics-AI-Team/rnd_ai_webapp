// apps/ai/scripts/import/map-material.ts
import type { EnrichmentIndex } from "./lib/enrich";
import { enrich_material } from "./lib/enrich";

/** A tenant product document ready for upsert (canonical + legacy aliases). */
export interface ProductImportDoc {
  tenantId: string;
  actorProfileId: string;
  ownerProfileId: string;
  productCode: string;
  rm_code: string;
  productName: string;
  trade_name: string;
  INCI_name: string;
  inci_name: string;
  supplier: string;
  price: number;
  rm_cost: number;
  company_name: string;
  cas_no: string;
  benefits: string[];
  usecase: string[];
  functions: string[];
  restriction: string;
  description: string;
  stockQuantity: number;
  lowStockThreshold: number;
  isActive: boolean;
}

/** Parse a decimal cost string, defaulting to 0. */
function parse_cost(raw: string): number {
  const n = Number.parseFloat(raw || "");
  return Number.isFinite(n) ? Math.round(n * 1e4) / 1e4 : 0;
}

/**
 * Map one rm_lines.csv row to a tenant product document, applying enrichment.
 *
 * @param row - rm_lines row (rm_code, trade_name, inci_name, supplier, rm_cost, company_name, record_status).
 * @param index - Enrichment index (CAS/functions by INCI).
 * @param tenant_id - Target tenant.
 * @param actor_profile_id - Importing actor (stamp).
 * @returns A product doc, or null when rm_code/trade_name is missing.
 */
export function map_rm_line_to_product(
  row: Record<string, string>,
  index: EnrichmentIndex,
  tenant_id: string,
  actor_profile_id: string,
): ProductImportDoc | null {
  const code = (row.rm_code || "").trim();
  const name = (row.trade_name || "").trim();
  if (!code || !name) return null;
  const inci = (row.inci_name || "").trim();
  const price = parse_cost(row.rm_cost);
  const e = enrich_material(inci, index);
  return {
    tenantId: tenant_id,
    actorProfileId: actor_profile_id,
    ownerProfileId: actor_profile_id,
    productCode: code,
    rm_code: code,
    productName: name,
    trade_name: name,
    INCI_name: inci,
    inci_name: inci,
    supplier: (row.supplier || "").trim(),
    price,
    rm_cost: price,
    company_name: (row.company_name || "").trim(),
    cas_no: e.cas_no,
    benefits: e.benefits,
    usecase: e.usecase,
    functions: e.functions,
    restriction: e.restriction,
    description: e.description,
    stockQuantity: 0,
    lowStockThreshold: 10,
    isActive: (row.record_status || "").trim() !== "0",
  };
}
