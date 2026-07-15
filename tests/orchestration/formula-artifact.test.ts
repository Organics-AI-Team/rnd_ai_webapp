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
