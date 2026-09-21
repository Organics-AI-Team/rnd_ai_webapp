/**
 * Deterministic formula finalizer (G4.8b).
 *
 * Turns a validated formula artifact + its material evidence into the public
 * QualityDimensionsV1 contract and public ValidationResultV1 records. Every
 * value is computed from normalized inputs with NO model involvement, so a
 * replay of the same run reproduces the same numbers exactly. The finalize node
 * (G4.8c) consumes these to build the run output; the model can never inflate a
 * dimension or pass a failed deterministic check.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { quality_dimensions_v1_schema } from "../contracts";
import type { QualityDimensionsV1, ValidationResultV1 } from "../contracts";
import {
  MANDATORY_REVIEW_STATEMENT,
  type FormulaArtifactV1,
  type FormulaValidationV1,
  type MaterialEvidenceIndex,
} from "./formula-schema";

/** Number of structural (non-per-item) deterministic checks the validator runs. */
const STRUCTURAL_CHECK_COUNT = 3;

/** Loop-derived signals the node computes from observation metadata. */
export interface FinalizerSignals {
  /** True when a deterministic evaluator flagged a contradiction upstream. */
  readonly contradictions_flagged?: boolean;
  /** Age (days) of the freshest evidence source, or null when unknown. */
  readonly source_freshness_days?: number | null;
}

/**
 * Ratio with a "vacuously complete" convention: 0 of 0 scores 1, not NaN.
 *
 * @param numerator - Count of satisfied units.
 * @param denominator - Total count of units.
 * @returns A value in [0, 1].
 */
function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 1;
  return numerator / denominator;
}

/**
 * Collect the set of evidence source IDs known across the material index.
 *
 * @param evidence - Material evidence index.
 * @returns A set of every source_id present in the evidence.
 */
function known_sources(evidence: MaterialEvidenceIndex): Set<string> {
  const sources = new Set<string>();
  for (const material of Object.values(evidence)) {
    for (const source of material.source_ids) sources.add(source);
  }
  return sources;
}

/**
 * Compute the deterministic quality dimensions for a validated formula artifact.
 *
 * @param artifact - The formula artifact.
 * @param evidence - The material evidence index backing coverage/quality.
 * @param validation - The deterministic validation outcome (findings drive
 *                     validation_rate and risk_severity).
 * @param signals - Optional loop-derived signals (contradictions, freshness).
 * @returns Schema-validated QualityDimensionsV1.
 * @throws ZodError when a computed value violates the public contract.
 */
export function compute_formula_quality_dimensions(
  artifact: FormulaArtifactV1,
  evidence: MaterialEvidenceIndex,
  validation: FormulaValidationV1,
  signals: FinalizerSignals = {},
): QualityDimensionsV1 {
  const non_water = artifact.ingredients.filter((ingredient) => !ingredient.is_water);
  const evidence_for = (ingredient: FormulaArtifactV1["ingredients"][number]) =>
    evidence[ingredient.material_id] ?? evidence[ingredient.rm_code];

  const backed = non_water.filter(
    (ingredient) => evidence_for(ingredient) !== undefined || ingredient.external_unverified,
  );
  const with_sources = non_water.filter((ingredient) => {
    const material = evidence_for(ingredient);
    return material !== undefined && material.source_ids.length > 0;
  });

  const sources = known_sources(evidence);
  const cited_claims = artifact.claims.filter((claim) =>
    claim.source_ids.some((source) => sources.has(source)),
  );

  const evidence_coverage = ratio(backed.length, non_water.length);
  const source_quality = ratio(with_sources.length, non_water.length);
  const groundedness = ratio(
    backed.length + cited_claims.length,
    non_water.length + artifact.claims.length,
  );

  const blocking = validation.findings.filter((finding) => finding.severity === "blocking");
  const warnings = validation.findings.filter((finding) => finding.severity === "warning");
  const total_checks =
    artifact.ingredients.length + artifact.claims.length + STRUCTURAL_CHECK_COUNT;
  const validation_rate = Math.max(0, (total_checks - blocking.length) / total_checks);

  const present_sections = [
    artifact.name.length > 0,
    artifact.ingredients.length > 0,
    artifact.batch_size.length > 0,
    artifact.warnings.some((warning) => warning.includes(MANDATORY_REVIEW_STATEMENT)),
    artifact.ingredients.every((ingredient) => ingredient.rationale.length > 0),
  ];
  const completeness = ratio(
    present_sections.filter(Boolean).length,
    present_sections.length,
  );

  const risk_severity =
    blocking.length > 0
      ? "high"
      : warnings.length >= 2
        ? "medium"
        : warnings.length === 1
          ? "low"
          : "none";

  return quality_dimensions_v1_schema.parse({
    groundedness,
    evidence_coverage,
    source_quality,
    source_freshness_days: signals.source_freshness_days ?? null,
    contradiction_state: signals.contradictions_flagged ? "flagged" : "none",
    validation_rate,
    completeness,
    risk_severity,
  });
}

/**
 * Map deterministic validation findings to the public ValidationResultV1 shape.
 *
 * A blocking finding is a failed check (`passed: false`); a warning is a passed
 * check surfaced with its detail so reviewers still see it.
 *
 * @param validation - The deterministic validation outcome.
 * @returns One ValidationResultV1 per finding, capped at the contract's 100.
 */
export function to_validation_results(
  validation: FormulaValidationV1,
): ValidationResultV1[] {
  return validation.findings.slice(0, 100).map((finding) => ({
    code: finding.code,
    passed: finding.severity !== "blocking",
    detail: finding.message.slice(0, 500),
  }));
}
