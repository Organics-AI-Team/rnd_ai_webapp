/**
 * G4.8d — FormulaArtifactService.validate_draft (the ArtifactService adapter).
 *
 * The adapter is the concrete bridge the AI gateway wires into the loop's
 * `artifacts` port: it parses the draft, loads tenant material evidence through
 * an injected provider (the orchestration package deliberately holds none),
 * runs the deterministic validator + quality finalizer, and returns the public
 * ArtifactValidationV1 (findings carry safe messages; quality dimensions are
 * computed with evidence). No model, no wall clock.
 */

import { describe, expect, it } from "vitest";

import type {
  FormulaConstraintsV1,
  MaterialEvidenceIndex,
  TrustedRuntimeContext,
} from "@rnd-ai/ai-orchestration";

import {
  FormulaArtifactService,
  type FormulaConstraintProvider,
  type MaterialEvidenceProvider,
} from "../../apps/ai/server/services/ai-control/formula-artifact-service";

const CONTEXT: TrustedRuntimeContext = {
  tenant_id: "tenant_alpha",
  actor_profile_id: "profile_0001",
  run_id: "run_0001",
  parent_run_id: null,
  delegation_depth: 0,
  correlation_id: "corr_0001",
};

/** A fixed evidence provider returning the given index for every request. */
function fixed_evidence(index: MaterialEvidenceIndex): MaterialEvidenceProvider {
  return { async load_evidence() { return index; } };
}

/** A fixed constraint provider returning the given constraints. */
function fixed_constraints(constraints: FormulaConstraintsV1): FormulaConstraintProvider {
  return { async load_constraints() { return constraints; } };
}

/** A valid two-ingredient draft (water base + one evidence-backed active). */
function valid_draft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    warnings: [
      "Laboratory, stability, safety, and regulatory review remain required before production.",
    ],
    ...overrides,
  };
}

const BACKED: MaterialEvidenceIndex = {
  RM_ACTIVE: { usage_min: "1", usage_max: "10", available: true, source_ids: ["src-1"] },
};

describe("FormulaArtifactService.validate_draft", () => {
  it("validates a backed draft and returns computed quality dimensions", async () => {
    const service = new FormulaArtifactService(fixed_evidence(BACKED));
    const result = await service.validate_draft(valid_draft(), CONTEXT);
    expect(result.valid).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.quality_dimensions?.evidence_coverage).toBe(1);
    expect(result.quality_dimensions?.risk_severity).toBe("none");
  });

  it("fails closed on a payload that violates the artifact contract", async () => {
    const service = new FormulaArtifactService(fixed_evidence(BACKED));
    const result = await service.validate_draft({ not: "a formula" }, CONTEXT);
    expect(result.valid).toBe(false);
    expect(result.findings[0]?.code).toBe("ARTIFACT_SCHEMA_INVALID");
  });

  it("blocks an unbacked material and surfaces a safe message", async () => {
    const service = new FormulaArtifactService(fixed_evidence({})); // no evidence
    const result = await service.validate_draft(valid_draft(), CONTEXT);
    expect(result.valid).toBe(false);
    const finding = result.findings.find((f) => f.code === "MATERIAL_NOT_EVIDENCE_BACKED");
    expect(finding?.severity).toBe("blocking");
    expect(typeof finding?.safe_message).toBe("string");
    expect(result.quality_dimensions?.evidence_coverage).toBeLessThan(1);
  });

  it("applies injected tenant constraints (incompatible materials)", async () => {
    const service = new FormulaArtifactService(
      fixed_evidence(BACKED),
      fixed_constraints({ incompatibilities: [["AQUA", "RM_ACTIVE"]] }),
    );
    const result = await service.validate_draft(valid_draft(), CONTEXT);
    expect(result.valid).toBe(false);
    expect(result.findings.some((f) => f.code === "INCOMPATIBLE_MATERIALS")).toBe(true);
  });
});
