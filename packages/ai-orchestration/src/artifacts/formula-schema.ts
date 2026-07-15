/**
 * Formula artifact contracts (G4.8).
 *
 * A FormulaArtifactV1 is the deterministic, reviewable draft the loop produces.
 * Percentages, amounts, and costs are decimal STRINGS (never binary floats) so
 * validation is exact. The validator (formula-validator.ts) is the only
 * authority on whether an artifact may be finalized; the model never self-certifies.
 */

import { z } from "zod";

/** A decimal string (non-negative), validated exactly with decimal.js. */
const decimal_string = z.string().regex(/^\d+(\.\d+)?$/);

/** One ingredient line in a formula artifact. */
export const formula_ingredient_v1_schema = z
  .object({
    material_id: z.string().min(1).max(128),
    rm_code: z.string().min(1).max(64),
    phase: z.string().min(1).max(64),
    percentage: decimal_string,
    amount: decimal_string,
    unit: z.enum(["g", "kg", "ml", "L"]),
    cost: decimal_string.nullable(),
    source_ids: z.array(z.string().min(1)).max(50),
    rationale: z.string().max(1_000),
    /** Water/solvent base is exempt from the source-backing rule. */
    is_water: z.boolean().default(false),
    /** Explicitly declared external/unverified material (evidence not required). */
    external_unverified: z.boolean().default(false),
  })
  .strict();
export type FormulaIngredientV1 = z.infer<typeof formula_ingredient_v1_schema>;

/** One marketing/efficacy claim with its supporting evidence source IDs. */
export const formula_claim_v1_schema = z
  .object({
    text: z.string().min(1).max(500),
    source_ids: z.array(z.string().min(1)).max(50),
  })
  .strict();
export type FormulaClaimV1 = z.infer<typeof formula_claim_v1_schema>;

/** The deterministic, reviewable formula artifact. */
export const formula_artifact_v1_schema = z
  .object({
    name: z.string().min(1).max(200),
    product_type: z.string().min(1).max(64),
    batch_size: decimal_string,
    batch_unit: z.enum(["g", "kg", "ml", "L"]),
    ingredients: z.array(formula_ingredient_v1_schema).min(1).max(100),
    claims: z.array(formula_claim_v1_schema).max(50).default([]),
    warnings: z.array(z.string().max(1_000)).max(100).default([]),
  })
  .strict();
export type FormulaArtifactV1 = z.infer<typeof formula_artifact_v1_schema>;

/** Evidence known for one material (from tenant/platform knowledge). */
export interface MaterialEvidence {
  readonly usage_min: string | null;
  readonly usage_max: string | null;
  readonly available: boolean;
  readonly source_ids: readonly string[];
}

/** Index of material evidence keyed by material_id and rm_code. */
export type MaterialEvidenceIndex = Readonly<Record<string, MaterialEvidence>>;

/** One deterministic validation finding. */
export interface FormulaValidationFinding {
  readonly code: string;
  readonly severity: "blocking" | "warning";
  readonly message: string;
}

/** The deterministic validation outcome for an artifact. */
export interface FormulaValidationV1 {
  readonly valid: boolean;
  readonly findings: readonly FormulaValidationFinding[];
}

/** The mandatory statement every artifact must carry (Step 5). */
export const MANDATORY_REVIEW_STATEMENT =
  "Laboratory, stability, safety, and regulatory review remain required before production.";
