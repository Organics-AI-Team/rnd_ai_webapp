// tests/import/map-material.test.ts
import { describe, it, expect } from "vitest";
import { map_rm_line_to_product } from "../../apps/ai/scripts/import/map-material";
import { build_enrichment_index } from "../../apps/ai/scripts/import/lib/enrich";

describe("map_rm_line_to_product", () => {
  const index = build_enrichment_index(
    [{ INCI_name: "NIACINAMIDE", CAS_No: "98-92-0", Function: "SKIN CONDITIONING", Restriction: "", Chem_IUPAC_Name_Description: "" }],
    [],
  );
  const base = { rm_code: "RC1", trade_name: "Niacinamide PC", inci_name: "Niacinamide", supplier: "DSM", rm_cost: "850.0", company_name: "Organics", record_status: "1" };

  it("maps canonical + legacy fields and applies enrichment", () => {
    const doc = map_rm_line_to_product(base, index, "T1", "A1")!;
    expect(doc.tenantId).toBe("T1");
    expect(doc.productCode).toBe("RC1");
    expect(doc.productName).toBe("Niacinamide PC");
    expect(doc.INCI_name).toBe("Niacinamide");
    expect(doc.price).toBe(850);
    expect(doc.cas_no).toBe("98-92-0");
    expect(doc.benefits).toEqual(["skin conditioning"]);
    expect(doc.isActive).toBe(true);
  });

  it("returns null when rm_code or trade_name is missing", () => {
    expect(map_rm_line_to_product({ ...base, rm_code: "" }, index, "T1", "A1")).toBeNull();
    expect(map_rm_line_to_product({ ...base, trade_name: "" }, index, "T1", "A1")).toBeNull();
  });

  it("marks record_status 0 inactive", () => {
    const doc = map_rm_line_to_product({ ...base, record_status: "0" }, index, "T1", "A1")!;
    expect(doc.isActive).toBe(false);
  });
});
