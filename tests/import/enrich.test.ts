// tests/import/enrich.test.ts
import { describe, it, expect } from "vitest";
import { build_enrichment_index, enrich_material } from "../../apps/ai/scripts/import/lib/enrich";

describe("enrichment", () => {
  const cosing = [
    { INCI_name: "NIACINAMIDE", CAS_No: "98-92-0", Function: "SKIN CONDITIONING", Restriction: "", Chem_IUPAC_Name_Description: "Vitamin B3" },
  ];
  const inci_lines = [{ en_name: "Ethyl alcohol", cas_no: "64-17-5" }];

  it("resolves CAS + functions from CosIng by INCI (case-insensitive)", () => {
    const index = build_enrichment_index(cosing, inci_lines);
    const e = enrich_material("Niacinamide", index);
    expect(e.cas_no).toBe("98-92-0");
    expect(e.functions).toEqual(["skin conditioning"]);
    expect(e.description).toBe("Vitamin B3");
  });

  it("falls back to inci_lines CAS when CosIng has none", () => {
    const index = build_enrichment_index([], inci_lines);
    expect(enrich_material("ethyl alcohol", index).cas_no).toBe("64-17-5");
  });

  it("returns empty enrichment for unknown INCI without throwing", () => {
    const index = build_enrichment_index([], []);
    const e = enrich_material("Unobtanium", index);
    expect(e.cas_no).toBe("");
    expect(e.functions).toEqual([]);
  });
});
