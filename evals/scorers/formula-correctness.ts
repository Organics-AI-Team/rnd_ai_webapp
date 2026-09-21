/** Deterministic scorer for the exact formulation constraints in EvalCaseV1. */
import Decimal from "decimal.js";
import type { EvalCaseV1 } from "../schemas/eval-case";
import type { RecordedFormula } from "../runner/recorded-run";
import type { DeterministicScore } from "./types";
import { unique_failures } from "./types";

export interface FormulaCorrectnessScore extends DeterministicScore {
  readonly applicable: boolean;
  readonly total_percent: string | null;
}

/**
 * Score a recorded formula against the corpus's exact constraints.
 *
 * @param test_case - Evaluation case carrying formula constraints, if applicable.
 * @param formula - Formula trace normalized by an executor adapter.
 * @returns Deterministic formula outcome and stable failure codes.
 */
export function score_formula_correctness(
  test_case: EvalCaseV1,
  formula: RecordedFormula | null,
): FormulaCorrectnessScore {
  const constraints = test_case.expected_artifact.formula_constraints;
  if (constraints === null) {
    return { applicable: false, passed: true, failures: [], total_percent: null };
  }
  if (formula === null) {
    return {
      applicable: true,
      passed: false,
      failures: ["FORMULA_MISSING"],
      total_percent: null,
    };
  }

  const failures: string[] = [];
  const ingredients_by_material = new Map(
    formula.ingredients.map((ingredient) => [ingredient.material_id, ingredient]),
  );
  const total_percent = formula.ingredients.reduce(
    (total, ingredient) => total.plus(new Decimal(ingredient.percentage)),
    new Decimal(0),
  );
  const total_difference = total_percent.minus(constraints.total_percent.target).abs();
  if (total_difference.greaterThan(new Decimal(constraints.total_percent.tolerance))) {
    failures.push("FORMULA_TOTAL_OUT_OF_TOLERANCE");
  }

  for (const limit of constraints.usage_limits) {
    const ingredient = ingredients_by_material.get(limit.material_id);
    if (
      ingredient === undefined ||
      new Decimal(ingredient.percentage).lessThan(limit.minimum_percent) ||
      new Decimal(ingredient.percentage).greaterThan(limit.maximum_percent)
    ) {
      failures.push("FORMULA_USAGE_LIMIT_VIOLATED");
    }
  }

  for (const incompatibility of constraints.incompatibilities) {
    if (
      ingredients_by_material.has(incompatibility.material_a) &&
      ingredients_by_material.has(incompatibility.material_b)
    ) {
      failures.push("FORMULA_INCOMPATIBILITY_PRESENT");
    }
  }

  for (const requirement of constraints.phase_requirements) {
    if (ingredients_by_material.get(requirement.material_id)?.phase !== requirement.phase) {
      failures.push("FORMULA_PHASE_REQUIREMENT_VIOLATED");
    }
  }

  if (new Decimal(formula.cost_thb_per_kg).greaterThan(constraints.maximum_cost_thb_per_kg)) {
    failures.push("FORMULA_COST_LIMIT_EXCEEDED");
  }
  if (
    constraints.manager_confirmation_required &&
    test_case.approval.expected_outcome === "pending" &&
    formula.manager_confirmation_recorded
  ) {
    failures.push("FORMULA_CONFIRMED_WITHOUT_PENDING_APPROVAL");
  }
  if (
    constraints.manager_confirmation_required &&
    test_case.approval.expected_outcome === "approved" &&
    !formula.manager_confirmation_recorded
  ) {
    failures.push("FORMULA_MANAGER_CONFIRMATION_MISSING");
  }

  const unique = unique_failures(failures);
  return {
    applicable: true,
    passed: unique.length === 0,
    failures: unique,
    total_percent: total_percent.toFixed(),
  };
}
