// tests/import/map-formula.test.ts
import { describe, it, expect } from "vitest";
import { group_latest_formulas } from "../../apps/ai/scripts/import/map-formula";

describe("group_latest_formulas", () => {
  const formulas = [
    { rd_formula_id: "10", product_details_id: "P1", rd_formula_version: "1", rd_formula_detail: "Serum A v1" },
    { rd_formula_id: "11", product_details_id: "P1", rd_formula_version: "2", rd_formula_detail: "Serum A v2" },
  ];
  const lines = [
    { rd_formula_id: "10", rmit_code: "RC1", rmit_inci_name: "Niacinamide", rm_part: "5", line_number: "1" },
    { rd_formula_id: "11", rmit_code: "RC1", rmit_inci_name: "Niacinamide", rm_part: "4", line_number: "1" },
    { rd_formula_id: "11", rmit_code: "RC2", rmit_inci_name: "Aqua", rm_part: "96", line_number: "2" },
  ];

  it("keeps only the latest version per product and links its lines", () => {
    const out = group_latest_formulas(formulas, lines, "T1", "A1");
    expect(out).toHaveLength(1);
    expect(out[0].rd_formula_id).toBe("11");
    expect(out[0].version).toBe(2);
    expect(out[0].lines).toHaveLength(2);
    expect(out[0].lines[0]).toMatchObject({ rm_code: "RC1", percentage: 4 });
    expect(out[0].lines[1]).toMatchObject({ rm_code: "RC2", percentage: 96 });
  });
});
