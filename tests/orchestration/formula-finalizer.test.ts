/**
 * G4.8b — deterministic formula finalizer.
 *
 * `compute_formula_quality_dimensions` turns a validated artifact + evidence
 * into the public QualityDimensionsV1 contract with NO model involvement, so
 * the numbers are reproducible on replay. `to_validation_results` maps
 * deterministic findings to the public ValidationResultV1 shape.
 */

import { describe, expect, it } from "vitest";

import {
  compute_formula_quality_dimensions,
  to_validation_results,
} from "../../packages/ai-orchestration/src/artifacts/formula-finalizer";
import { validate_formula_artifact } from "../../packages/ai-orchestration/src/artifacts/formula-validator";
import {
  MANDATORY_REVIEW_STATEMENT,
  type FormulaArtifactV1,
  type MaterialEvidenceIndex,
} from "../../packages/ai-orchestration/src/artifacts/formula-schema";
import { quality_dimensions_v1_schema } from "../../packages/ai-orchestration/src/contracts";

const EVIDENCE: MaterialEvidenceIndex = {
  RM_ACTIVE: { usage_min: "1", usage_max: "10", available: true, source_ids: ["src-1"] },
};

/**
 * A valid two-ingredient artifact (water base + one evidence-backed active).
 *
 * @param overrides - Partial artifact overrides for negative cases.
 * @returns A FormulaArtifactV1.
 */
function valid_artifact(overrides: Partial<FormulaArtifactV1> = {}): FormulaArtifactV1 {
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
        percentage: "95.00",
        amount: "95.00",
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

describe("compute_formula_quality_dimensions", () => {
  it("scores a fully valid, evidence-backed artifact at the top of every band", () => {
    const artifact = valid_artifact();
    const validation = validate_formula_artifact(artifact, EVIDENCE);
    const q = compute_formula_quality_dimensions(artifact, EVIDENCE, validation);
    expect(quality_dimensions_v1_schema.parse(q)).toEqual(q); // schema-valid
    expect(q.evidence_coverage).toBe(1);
    expect(q.groundedness).toBe(1);
    expect(q.source_quality).toBe(1);
    expect(q.validation_rate).toBe(1);
    expect(q.contradiction_state).toBe("none");
    expect(q.risk_severity).toBe("none");
    expect(q.source_freshness_days).toBeNull();
  });

  it("drops evidence_coverage and raises risk when a material is unbacked", () => {
    const artifact = valid_artifact();
    artifact.ingredients[1] = { ...artifact.ingredients[1], material_id: "UNKNOWN", rm_code: "UNKNOWN" };
    const validation = validate_formula_artifact(artifact, EVIDENCE);
    const q = compute_formula_quality_dimensions(artifact, EVIDENCE, validation);
    expect(q.evidence_coverage).toBeLessThan(1);
    expect(q.validation_rate).toBeLessThan(1);
    expect(q.risk_severity).toBe("high"); // a blocking finding is present
  });

  it("drops groundedness when a claim is uncited", () => {
    const artifact = valid_artifact({ claims: [{ text: "Cures acne", source_ids: ["nope"] }] });
    const validation = validate_formula_artifact(artifact, EVIDENCE);
    const q = compute_formula_quality_dimensions(artifact, EVIDENCE, validation);
    expect(q.groundedness).toBeLessThan(1);
  });

  it("classifies a warning-only artifact as low risk while staying valid", () => {
    // Below-minimum usage is a warning (not blocking).
    const artifact = valid_artifact();
    artifact.ingredients[1].percentage = "0.50"; // below RM_ACTIVE min of 1
    artifact.ingredients[0].percentage = "99.50";
    artifact.ingredients[1].amount = "0.50";
    artifact.ingredients[0].amount = "99.50";
    const validation = validate_formula_artifact(artifact, EVIDENCE);
    expect(validation.valid).toBe(true);
    const q = compute_formula_quality_dimensions(artifact, EVIDENCE, validation);
    expect(q.risk_severity).toBe("low");
  });

  it("flags contradictions and records freshness from signals", () => {
    const artifact = valid_artifact();
    const validation = validate_formula_artifact(artifact, EVIDENCE);
    const q = compute_formula_quality_dimensions(artifact, EVIDENCE, validation, {
      contradictions_flagged: true,
      source_freshness_days: 12,
    });
    expect(q.contradiction_state).toBe("flagged");
    expect(q.source_freshness_days).toBe(12);
  });
});

describe("to_validation_results", () => {
  it("maps blocking findings to failed results and warnings to passed", () => {
    const artifact = valid_artifact();
    artifact.ingredients[1] = { ...artifact.ingredients[1], material_id: "UNKNOWN", rm_code: "UNKNOWN" };
    const validation = validate_formula_artifact(artifact, EVIDENCE);
    const results = to_validation_results(validation);
    const blocking = results.find((r) => r.code === "MATERIAL_NOT_EVIDENCE_BACKED");
    expect(blocking?.passed).toBe(false);
    expect(results.every((r) => typeof r.detail === "string")).toBe(true);
  });
});
