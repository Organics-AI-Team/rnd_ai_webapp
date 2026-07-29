// tests/web/formula-artifact-to-form.test.ts
import { describe, it, expect } from "vitest";
import { formula_artifact_to_form_state } from "../../apps/web/lib/formula_artifact_to_form";

const artifact = {
  name: "Evidence-backed synthetic serum",
  product_type: "serum",
  batch_size: "100",
  batch_unit: "g",
  ingredients: [
    {
      material_id: "665f1a13e6bffffe665f1a13",
      rm_code: "WATER",
      phase: "A",
      percentage: "95",
      amount: "95",
      unit: "g",
      cost: "0",
      source_ids: [],
      rationale: "Water phase base.",
      is_water: true,
      external_unverified: false,
    },
    {
      material_id: "665f1a13e6bffffe665f1a14",
      rm_code: "RM-NIA",
      phase: "A",
      percentage: "5",
      amount: "5",
      unit: "g",
      cost: "1.25",
      source_ids: ["source-niacinamide"],
      rationale: "Evidence-backed active.",
      is_water: false,
      external_unverified: false,
    },
  ],
  claims: [{ text: "Supports a brightening positioning.", source_ids: ["source-niacinamide"] }],
  warnings: ["Patch test recommended."],
};

describe("formula_artifact_to_form_state", () => {
  it("maps the artifact into the FormulaForm state shape", () => {
    const state = formula_artifact_to_form_state(artifact)!;
    expect(state.formulaName).toBe("Evidence-backed synthetic serum");
    expect(state.targetBenefits).toEqual(["Supports a brightening positioning."]);
    expect(state.totalAmount).toBe(100);
    expect(state.remarks).toContain("Patch test recommended.");
    expect(state.ingredients).toHaveLength(2);
    expect(state.ingredients[1]).toEqual({
      materialId: "665f1a13e6bffffe665f1a14",
      rm_code: "RM-NIA",
      productName: "RM-NIA",
      inci_name: "",
      amount: 5,
      percentage: 5,
      notes: "Evidence-backed active.",
    });
  });

  it("drops ingredient rows without an rm_code and returns null for junk", () => {
    const state = formula_artifact_to_form_state({
      ...artifact,
      ingredients: [{ ...artifact.ingredients[0], rm_code: "" }, artifact.ingredients[1]],
    })!;
    expect(state.ingredients).toHaveLength(1);
    expect(formula_artifact_to_form_state(null)).toBeNull();
    expect(formula_artifact_to_form_state({ name: "", ingredients: [] })).toBeNull();
  });
});
