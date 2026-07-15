/**
 * Deterministic formula artifact validator (G4.8).
 *
 * The single authority on whether a draft may be finalized. All arithmetic uses
 * decimal.js — never binary floats — so `|total - 100| <= 0.01` and usage-range
 * checks are exact and replay-stable. The model cannot pass a failed check; a
 * blocking finding must return to the agent as an observation (finalize node).
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import Decimal from "decimal.js";
import {
  MANDATORY_REVIEW_STATEMENT,
  type FormulaArtifactV1,
  type FormulaIngredientV1,
  type FormulaValidationFinding,
  type FormulaValidationV1,
  type MaterialEvidenceIndex,
} from "./formula-schema";

/** Absolute percentage-total tolerance (Step 5). */
const TOTAL_TOLERANCE = new Decimal("0.01");

/**
 * Check the ingredient percentages sum to 100 within the 0.01 tolerance.
 *
 * @param ingredients - Artifact ingredients.
 * @returns A blocking finding when out of tolerance, or null.
 */
function check_total_percentage(
  ingredients: readonly FormulaIngredientV1[],
): FormulaValidationFinding | null {
  const total = ingredients.reduce(
    (sum, ingredient) => sum.plus(new Decimal(ingredient.percentage)),
    new Decimal(0),
  );
  if (total.minus(100).abs().greaterThan(TOTAL_TOLERANCE)) {
    return {
      code: "TOTAL_PERCENTAGE_OUT_OF_TOLERANCE",
      severity: "blocking",
      message: `Ingredient percentages total ${total.toString()}; must be within 0.01 of 100.`,
    };
  }
  return null;
}

/**
 * Check every material appears at most once (by material_id and rm_code).
 *
 * @param ingredients - Artifact ingredients.
 * @returns A blocking finding on the first duplicate, or null.
 */
function check_unique_materials(
  ingredients: readonly FormulaIngredientV1[],
): FormulaValidationFinding | null {
  const seen_ids = new Set<string>();
  const seen_codes = new Set<string>();
  for (const ingredient of ingredients) {
    if (seen_ids.has(ingredient.material_id) || seen_codes.has(ingredient.rm_code)) {
      return {
        code: "DUPLICATE_MATERIAL",
        severity: "blocking",
        message: `Material '${ingredient.rm_code}' appears more than once.`,
      };
    }
    seen_ids.add(ingredient.material_id);
    seen_codes.add(ingredient.rm_code);
  }
  return null;
}

/**
 * Check each non-water material is evidence-backed (tenant-visible) or
 * explicitly declared external/unverified, and its percentage lies within any
 * evidence-provided usage range.
 *
 * @param ingredients - Artifact ingredients.
 * @param evidence - Material evidence index.
 * @returns Blocking findings for unbacked or out-of-range materials.
 */
function check_usage_and_backing(
  ingredients: readonly FormulaIngredientV1[],
  evidence: MaterialEvidenceIndex,
): FormulaValidationFinding[] {
  const findings: FormulaValidationFinding[] = [];
  for (const ingredient of ingredients) {
    if (ingredient.is_water) continue;
    const material = evidence[ingredient.material_id] ?? evidence[ingredient.rm_code];
    if (!material) {
      if (!ingredient.external_unverified) {
        findings.push({
          code: "MATERIAL_NOT_EVIDENCE_BACKED",
          severity: "blocking",
          message: `Material '${ingredient.rm_code}' has no evidence and is not declared external/unverified.`,
        });
      }
      continue;
    }
    if (!material.available) {
      findings.push({
        code: "MATERIAL_UNAVAILABLE",
        severity: "blocking",
        message: `Material '${ingredient.rm_code}' is unavailable.`,
      });
    }
    const percentage = new Decimal(ingredient.percentage);
    if (material.usage_max !== null && percentage.greaterThan(new Decimal(material.usage_max))) {
      findings.push({
        code: "USAGE_ABOVE_LIMIT",
        severity: "blocking",
        message: `Material '${ingredient.rm_code}' at ${ingredient.percentage}% exceeds the evidence limit ${material.usage_max}%.`,
      });
    }
    if (material.usage_min !== null && percentage.lessThan(new Decimal(material.usage_min))) {
      findings.push({
        code: "USAGE_BELOW_MINIMUM",
        severity: "warning",
        message: `Material '${ingredient.rm_code}' at ${ingredient.percentage}% is below the effective minimum ${material.usage_min}%.`,
      });
    }
  }
  return findings;
}

/**
 * Check every claim is backed by at least one source present in the evidence.
 *
 * @param artifact - The formula artifact.
 * @param evidence - Material evidence index (source IDs are drawn from it).
 * @returns Blocking findings for uncited claims.
 */
function check_claim_citations(
  artifact: FormulaArtifactV1,
  evidence: MaterialEvidenceIndex,
): FormulaValidationFinding[] {
  const known_sources = new Set<string>();
  for (const material of Object.values(evidence)) {
    for (const source of material.source_ids) known_sources.add(source);
  }
  const findings: FormulaValidationFinding[] = [];
  for (const claim of artifact.claims) {
    const cited = claim.source_ids.some((source) => known_sources.has(source));
    if (!cited) {
      findings.push({
        code: "CLAIM_NOT_CITED",
        severity: "blocking",
        message: `Claim "${claim.text.slice(0, 60)}" has no supporting evidence source.`,
      });
    }
  }
  return findings;
}

/**
 * Check the mandatory laboratory/stability/safety/regulatory review statement
 * is present among the artifact warnings.
 *
 * @param artifact - The formula artifact.
 * @returns A blocking finding when the statement is missing, or null.
 */
function check_review_statement(
  artifact: FormulaArtifactV1,
): FormulaValidationFinding | null {
  const present = artifact.warnings.some((warning) =>
    warning.includes(MANDATORY_REVIEW_STATEMENT),
  );
  if (!present) {
    return {
      code: "MISSING_REVIEW_STATEMENT",
      severity: "blocking",
      message: "The mandatory laboratory/stability/safety/regulatory review statement is missing.",
    };
  }
  return null;
}

/**
 * Validate a formula artifact deterministically against material evidence.
 *
 * @param artifact - The proposed formula artifact.
 * @param evidence - The material evidence index backing usage ranges/claims.
 * @returns The validation outcome; `valid` is false when any blocking finding
 *          is present.
 */
export function validate_formula_artifact(
  artifact: FormulaArtifactV1,
  evidence: MaterialEvidenceIndex,
): FormulaValidationV1 {
  const findings: FormulaValidationFinding[] = [];
  const single_checks = [
    check_total_percentage(artifact.ingredients),
    check_unique_materials(artifact.ingredients),
    check_review_statement(artifact),
  ];
  for (const finding of single_checks) {
    if (finding) findings.push(finding);
  }
  findings.push(...check_usage_and_backing(artifact.ingredients, evidence));
  findings.push(...check_claim_citations(artifact, evidence));

  return {
    valid: !findings.some((finding) => finding.severity === "blocking"),
    findings,
  };
}
