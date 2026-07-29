/**
 * G4.8 — deterministic formula artifact validation.
 *
 * The validator is the sole authority on whether a draft may be finalized. All
 * arithmetic is exact (decimal.js): the total must be within 0.01 of 100, every
 * non-water material must be evidence-backed and within its usage range, claims
 * must be cited, materials unique, and the mandatory review statement present.
 */

import { describe, expect, it } from "vitest";

import { validate_formula_artifact } from "../../packages/ai-orchestration/src/artifacts/formula-validator";
import {
  MANDATORY_REVIEW_STATEMENT,
  type FormulaArtifactV1,
  type FormulaConstraintsV1,
  type MaterialEvidenceIndex,
} from "../../packages/ai-orchestration/src/artifacts/formula-schema";

const EVIDENCE: MaterialEvidenceIndex = {
  RM_ACTIVE: { usage_min: "1", usage_max: "10", available: true, source_ids: ["src-1"] },
  RM_OIL: { usage_min: null, usage_max: "20", available: true, source_ids: ["src-2"] },
};

/**
 * Build an otherwise-valid two-ingredient artifact with a given total: water
 * base absorbs (total-5) and one active holds 5%.
 *
 * @param total - The target percentage total (decimal string).
 * @param overrides - Partial artifact overrides for negative tests.
 * @returns A FormulaArtifactV1.
 */
function formula_with_total(
  total: string,
  overrides: Partial<FormulaArtifactV1> = {},
): FormulaArtifactV1 {
  const aqua = (Number(total) - 5).toFixed(2);
  return {
    name: "Test serum",
    product_type: "serum",
    batch_size: "100",
    batch_unit: "g",
    ingredients: [
      {
        material_id: "AQUA",
        rm_code: "AQUA",
        phase: "water",
        percentage: aqua,
        amount: aqua,
        unit: "g",
        cost: "0.01",
        source_ids: [],
        rationale: "solvent base",
        is_water: true,
        external_unverified: false,
      },
      {
        material_id: "RM_ACTIVE",
        rm_code: "RM_ACTIVE",
        phase: "active",
        percentage: "5.00",
        amount: "5.00",
        unit: "g",
        cost: "1.00",
        source_ids: ["src-1"],
        rationale: "active",
        is_water: false,
        external_unverified: false,
      },
    ],
    claims: [{ text: "Brightening", source_ids: ["src-1"] }],
    warnings: [MANDATORY_REVIEW_STATEMENT],
    ...overrides,
  };
}

describe("validate_formula_artifact — total tolerance", () => {
  it.each([
    ["99.98", false],
    ["99.99", true],
    ["100.00", true],
    ["100.01", true],
    ["100.02", false],
  ])("validates total %s at the 0.01 tolerance -> %s", (total, valid) => {
    expect(validate_formula_artifact(formula_with_total(total), EVIDENCE).valid).toBe(valid);
  });
});

describe("validate_formula_artifact — content checks", () => {
  it("rejects a duplicate material", () => {
    const artifact = formula_with_total("100.00");
    const dup = { ...artifact, ingredients: [...artifact.ingredients, artifact.ingredients[1]] };
    const result = validate_formula_artifact(dup, EVIDENCE);
    expect(result.valid).toBe(false);
    expect(result.findings.some((f) => f.code === "DUPLICATE_MATERIAL")).toBe(true);
  });

  it("rejects a non-water material with no evidence and no external flag", () => {
    const artifact = formula_with_total("100.00");
    artifact.ingredients[1] = {
      ...artifact.ingredients[1],
      material_id: "UNKNOWN",
      rm_code: "UNKNOWN",
    };
    const result = validate_formula_artifact(artifact, EVIDENCE);
    expect(result.findings.some((f) => f.code === "MATERIAL_NOT_EVIDENCE_BACKED")).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("allows an explicitly external/unverified material", () => {
    const artifact = formula_with_total("100.00");
    artifact.ingredients[1] = {
      ...artifact.ingredients[1],
      material_id: "EXT",
      rm_code: "EXT",
      external_unverified: true,
    };
    expect(validate_formula_artifact(artifact, EVIDENCE).valid).toBe(true);
  });

  it("rejects usage above the evidence limit", () => {
    const artifact = formula_with_total("100.00");
    artifact.ingredients[0].percentage = "80.00"; // aqua
    artifact.ingredients[1].percentage = "20.00"; // active over its 10% limit
    artifact.ingredients[0].amount = "80.00";
    artifact.ingredients[1].amount = "20.00";
    const result = validate_formula_artifact(artifact, EVIDENCE);
    expect(result.findings.some((f) => f.code === "USAGE_ABOVE_LIMIT")).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("rejects an uncited claim", () => {
    const artifact = formula_with_total("100.00", {
      claims: [{ text: "Cures acne", source_ids: ["nonexistent"] }],
    });
    const result = validate_formula_artifact(artifact, EVIDENCE);
    expect(result.findings.some((f) => f.code === "CLAIM_NOT_CITED")).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("requires the mandatory review statement", () => {
    const artifact = formula_with_total("100.00", { warnings: [] });
    const result = validate_formula_artifact(artifact, EVIDENCE);
    expect(result.findings.some((f) => f.code === "MISSING_REVIEW_STATEMENT")).toBe(true);
    expect(result.valid).toBe(false);
  });
});

describe("validate_formula_artifact — amount consistent with batch size", () => {
  it("accepts amounts equal to percentage of a same-unit batch", () => {
    // Default builder: batch 100 g, so amount === percentage numerically.
    expect(validate_formula_artifact(formula_with_total("100.00"), EVIDENCE).valid).toBe(true);
  });

  it("accepts amounts scaled to a kilogram batch and gram ingredients", () => {
    const artifact = formula_with_total("100.00", {
      batch_size: "1",
      batch_unit: "kg",
    });
    // 1 kg = 1000 g: aqua 95% -> 950 g, active 5% -> 50 g.
    artifact.ingredients[0].amount = "950";
    artifact.ingredients[1].amount = "50";
    expect(validate_formula_artifact(artifact, EVIDENCE).valid).toBe(true);
  });

  it("rejects an amount inconsistent with its percentage of the batch", () => {
    const artifact = formula_with_total("100.00");
    artifact.ingredients[1].amount = "6.00"; // 5% of 100 g must be 5.00, not 6.00
    const result = validate_formula_artifact(artifact, EVIDENCE);
    expect(result.findings.some((f) => f.code === "AMOUNT_INCONSISTENT_WITH_BATCH")).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("warns (does not block) when the ingredient unit family differs from the batch", () => {
    const artifact = formula_with_total("100.00");
    artifact.ingredients[1].unit = "ml"; // volume ingredient in a mass batch: unverifiable
    const result = validate_formula_artifact(artifact, EVIDENCE);
    expect(result.findings.some((f) => f.code === "AMOUNT_UNIT_MISMATCH")).toBe(true);
    expect(result.findings.find((f) => f.code === "AMOUNT_UNIT_MISMATCH")?.severity).toBe("warning");
  });
});

describe("validate_formula_artifact — configured constraints", () => {
  it("is a no-op when no constraints are supplied", () => {
    expect(validate_formula_artifact(formula_with_total("100.00"), EVIDENCE, {}).valid).toBe(true);
  });

  it("rejects co-present incompatible materials", () => {
    const constraints: FormulaConstraintsV1 = { incompatibilities: [["AQUA", "RM_ACTIVE"]] };
    const result = validate_formula_artifact(formula_with_total("100.00"), EVIDENCE, constraints);
    expect(result.findings.some((f) => f.code === "INCOMPATIBLE_MATERIALS")).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("rejects a formula missing a required phase", () => {
    const constraints: FormulaConstraintsV1 = { required_phases: ["preservative"] };
    const result = validate_formula_artifact(formula_with_total("100.00"), EVIDENCE, constraints);
    expect(result.findings.some((f) => f.code === "MISSING_REQUIRED_PHASE")).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("rejects a target pH outside the configured range", () => {
    const artifact = formula_with_total("100.00", { target_ph: "9.0" });
    const constraints: FormulaConstraintsV1 = { ph_range: ["4.0", "6.0"] };
    const result = validate_formula_artifact(artifact, EVIDENCE, constraints);
    expect(result.findings.some((f) => f.code === "PH_OUT_OF_RANGE")).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("accepts a target pH inside the configured range", () => {
    const artifact = formula_with_total("100.00", { target_ph: "5.0" });
    const constraints: FormulaConstraintsV1 = { ph_range: ["4.0", "6.0"] };
    expect(validate_formula_artifact(artifact, EVIDENCE, constraints).valid).toBe(true);
  });

  it("rejects an undated cost when dated cost is required", () => {
    const constraints: FormulaConstraintsV1 = { require_dated_cost: true };
    // Builder leaves cost_as_of unset -> undated.
    const result = validate_formula_artifact(formula_with_total("100.00"), EVIDENCE, constraints);
    expect(result.findings.some((f) => f.code === "COST_UNDATED")).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("accepts a dated cost within the freshness window", () => {
    const artifact = formula_with_total("100.00");
    artifact.ingredients[0].cost_as_of = "2026-07-01T00:00:00Z";
    artifact.ingredients[1].cost_as_of = "2026-07-10T00:00:00Z";
    const constraints: FormulaConstraintsV1 = {
      require_dated_cost: true,
      cost_max_age_days: 90,
      as_of_iso: "2026-07-15T00:00:00Z",
    };
    expect(validate_formula_artifact(artifact, EVIDENCE, constraints).valid).toBe(true);
  });

  it("warns on a stale but present dated cost", () => {
    const artifact = formula_with_total("100.00");
    artifact.ingredients[0].cost_as_of = "2026-01-01T00:00:00Z";
    artifact.ingredients[1].cost_as_of = "2026-01-01T00:00:00Z";
    const constraints: FormulaConstraintsV1 = {
      require_dated_cost: true,
      cost_max_age_days: 30,
      as_of_iso: "2026-07-15T00:00:00Z",
    };
    const result = validate_formula_artifact(artifact, EVIDENCE, constraints);
    expect(result.findings.some((f) => f.code === "COST_STALE")).toBe(true);
    expect(result.valid).toBe(true); // stale cost is a warning, not blocking
  });
});
