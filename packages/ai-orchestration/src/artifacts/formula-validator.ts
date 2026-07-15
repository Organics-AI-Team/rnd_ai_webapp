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
  EMPTY_FORMULA_CONSTRAINTS,
  MANDATORY_REVIEW_STATEMENT,
  type FormulaArtifactV1,
  type FormulaConstraintsV1,
  type FormulaIngredientV1,
  type FormulaValidationFinding,
  type FormulaValidationV1,
  type MaterialEvidenceIndex,
} from "./formula-schema";

/** Absolute percentage-total tolerance (Step 5). */
const TOTAL_TOLERANCE = new Decimal("0.01");

/** Milliseconds per day, for deterministic cost-freshness arithmetic. */
const MS_PER_DAY = 86_400_000;

/**
 * Unit → base-unit conversion, grouped by physical family so amounts can be
 * compared to a batch expressed in a possibly different (same-family) unit.
 */
const UNIT_BASE: Readonly<
  Record<FormulaIngredientV1["unit"], { readonly family: "mass" | "volume"; readonly factor: string }>
> = {
  g: { family: "mass", factor: "1" },
  kg: { family: "mass", factor: "1000" },
  ml: { family: "volume", factor: "1" },
  L: { family: "volume", factor: "1000" },
};

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
 * Check each ingredient's declared amount matches its percentage of the batch.
 *
 * Amount and batch may use different units within the same physical family
 * (mass g/kg, volume ml/L); a cross-family unit is unverifiable and surfaces as
 * a warning rather than a blocking inconsistency. Comparison is exact
 * (decimal.js) with a small relative tolerance to permit legitimate rounding.
 *
 * @param artifact - The formula artifact (batch size/unit + ingredient lines).
 * @returns Blocking findings for inconsistent amounts; warnings for mismatched
 *          unit families.
 */
function check_amount_from_batch(
  artifact: FormulaArtifactV1,
): FormulaValidationFinding[] {
  const findings: FormulaValidationFinding[] = [];
  const batch = UNIT_BASE[artifact.batch_unit];
  const batch_base = new Decimal(artifact.batch_size).times(batch.factor);
  for (const ingredient of artifact.ingredients) {
    const unit = UNIT_BASE[ingredient.unit];
    if (unit.family !== batch.family) {
      findings.push({
        code: "AMOUNT_UNIT_MISMATCH",
        severity: "warning",
        message: `Material '${ingredient.rm_code}' uses ${ingredient.unit} but the batch is ${artifact.batch_unit}; amount cannot be verified against the batch.`,
      });
      continue;
    }
    const expected_base = new Decimal(ingredient.percentage).div(100).times(batch_base);
    const amount_base = new Decimal(ingredient.amount).times(unit.factor);
    const tolerance = expected_base.times("0.005").plus("0.01");
    if (amount_base.minus(expected_base).abs().greaterThan(tolerance)) {
      findings.push({
        code: "AMOUNT_INCONSISTENT_WITH_BATCH",
        severity: "blocking",
        message: `Material '${ingredient.rm_code}' amount ${ingredient.amount}${ingredient.unit} does not match ${ingredient.percentage}% of the ${artifact.batch_size}${artifact.batch_unit} batch.`,
      });
    }
  }
  return findings;
}

/**
 * Determine whether a material identifier is present in the formula, matching
 * either the material_id or the rm_code of any ingredient.
 *
 * @param ingredients - Artifact ingredients.
 * @param identifier - A material_id or rm_code.
 * @returns True when some ingredient carries that identifier.
 */
function material_present(
  ingredients: readonly FormulaIngredientV1[],
  identifier: string,
): boolean {
  return ingredients.some(
    (ingredient) =>
      ingredient.material_id === identifier || ingredient.rm_code === identifier,
  );
}

/**
 * Check no configured incompatible material pair is co-present.
 *
 * @param artifact - The formula artifact.
 * @param constraints - Configured constraints (incompatibility pairs).
 * @returns Blocking findings for each co-present incompatible pair.
 */
function check_incompatibilities(
  artifact: FormulaArtifactV1,
  constraints: FormulaConstraintsV1,
): FormulaValidationFinding[] {
  const pairs = constraints.incompatibilities ?? [];
  const findings: FormulaValidationFinding[] = [];
  for (const [left, right] of pairs) {
    if (
      material_present(artifact.ingredients, left) &&
      material_present(artifact.ingredients, right)
    ) {
      findings.push({
        code: "INCOMPATIBLE_MATERIALS",
        severity: "blocking",
        message: `Materials '${left}' and '${right}' are configured as incompatible and must not co-occur.`,
      });
    }
  }
  return findings;
}

/**
 * Check every configured required phase appears at least once.
 *
 * @param artifact - The formula artifact.
 * @param constraints - Configured constraints (required phases).
 * @returns Blocking findings for each absent required phase.
 */
function check_required_phases(
  artifact: FormulaArtifactV1,
  constraints: FormulaConstraintsV1,
): FormulaValidationFinding[] {
  const required = constraints.required_phases ?? [];
  const present = new Set(artifact.ingredients.map((ingredient) => ingredient.phase));
  const findings: FormulaValidationFinding[] = [];
  for (const phase of required) {
    if (!present.has(phase)) {
      findings.push({
        code: "MISSING_REQUIRED_PHASE",
        severity: "blocking",
        message: `Required phase '${phase}' is not present in the formula.`,
      });
    }
  }
  return findings;
}

/**
 * Check the artifact's target pH lies within the configured allowed range.
 *
 * @param artifact - The formula artifact (optional target_ph).
 * @param constraints - Configured constraints (ph_range).
 * @returns A blocking finding for out-of-range pH, a warning when the range is
 *          configured but the target pH is unspecified, else none.
 */
function check_ph(
  artifact: FormulaArtifactV1,
  constraints: FormulaConstraintsV1,
): FormulaValidationFinding[] {
  const range = constraints.ph_range;
  if (!range) return [];
  const target = artifact.target_ph;
  if (target === null || target === undefined) {
    return [
      {
        code: "PH_UNSPECIFIED",
        severity: "warning",
        message: `A target pH range ${range[0]}–${range[1]} is configured but the formula does not specify a target pH.`,
      },
    ];
  }
  const value = new Decimal(target);
  if (value.lessThan(new Decimal(range[0])) || value.greaterThan(new Decimal(range[1]))) {
    return [
      {
        code: "PH_OUT_OF_RANGE",
        severity: "blocking",
        message: `Target pH ${target} is outside the allowed range ${range[0]}–${range[1]}.`,
      },
    ];
  }
  return [];
}

/**
 * Check dated-cost completeness and freshness when required by constraints.
 *
 * Freshness uses the deterministic `as_of_iso` reference, never a wall clock,
 * so replays are stable. Missing/undated costs block; stale costs warn.
 *
 * @param artifact - The formula artifact.
 * @param constraints - Configured constraints (require_dated_cost, age, as_of).
 * @returns Blocking findings for missing/undated costs, warnings for stale ones.
 */
function check_dated_cost(
  artifact: FormulaArtifactV1,
  constraints: FormulaConstraintsV1,
): FormulaValidationFinding[] {
  if (!constraints.require_dated_cost) return [];
  const findings: FormulaValidationFinding[] = [];
  for (const ingredient of artifact.ingredients) {
    if (ingredient.is_water) continue;
    if (ingredient.cost === null) {
      findings.push({
        code: "COST_MISSING",
        severity: "blocking",
        message: `Material '${ingredient.rm_code}' has no cost, but dated cost is required.`,
      });
      continue;
    }
    if (!ingredient.cost_as_of) {
      findings.push({
        code: "COST_UNDATED",
        severity: "blocking",
        message: `Material '${ingredient.rm_code}' has a cost but no dated timestamp.`,
      });
      continue;
    }
    if (
      constraints.cost_max_age_days !== null &&
      constraints.cost_max_age_days !== undefined &&
      constraints.as_of_iso
    ) {
      const age_days =
        (Date.parse(constraints.as_of_iso) - Date.parse(ingredient.cost_as_of)) / MS_PER_DAY;
      if (age_days > constraints.cost_max_age_days) {
        findings.push({
          code: "COST_STALE",
          severity: "warning",
          message: `Material '${ingredient.rm_code}' cost is ${Math.floor(age_days)} days old (limit ${constraints.cost_max_age_days}).`,
        });
      }
    }
  }
  return findings;
}

/**
 * Validate a formula artifact deterministically against material evidence and
 * optional tenant/product constraints.
 *
 * @param artifact - The proposed formula artifact.
 * @param evidence - The material evidence index backing usage ranges/claims.
 * @param constraints - Optional configured constraints (incompatibilities,
 *                      required phases, pH range, dated-cost policy). Defaults to
 *                      empty, disabling every constraint-gated check.
 * @returns The validation outcome; `valid` is false when any blocking finding
 *          is present.
 */
export function validate_formula_artifact(
  artifact: FormulaArtifactV1,
  evidence: MaterialEvidenceIndex,
  constraints: FormulaConstraintsV1 = EMPTY_FORMULA_CONSTRAINTS,
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
  findings.push(...check_amount_from_batch(artifact));
  findings.push(...check_incompatibilities(artifact, constraints));
  findings.push(...check_required_phases(artifact, constraints));
  findings.push(...check_ph(artifact, constraints));
  findings.push(...check_dated_cost(artifact, constraints));

  return {
    valid: !findings.some((finding) => finding.severity === "blocking"),
    findings,
  };
}
