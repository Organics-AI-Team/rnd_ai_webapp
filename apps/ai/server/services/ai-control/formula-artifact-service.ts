/**
 * Formula artifact service (G4.8d).
 *
 * The concrete ArtifactService the AI gateway wires into the governed loop's
 * `artifacts` port. The orchestration package holds no material evidence by
 * design; this adapter loads it (tenant-scoped, through injected providers),
 * runs the deterministic `validate_formula_artifact` and
 * `compute_formula_quality_dimensions`, and returns the public
 * ArtifactValidationV1 the finalize node consumes. Findings carry safe messages
 * only; nothing here calls a model or a wall clock.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import {
  compute_formula_quality_dimensions,
  formula_artifact_v1_schema,
  validate_formula_artifact,
  type ArtifactService,
  type ArtifactValidationFindingV1,
  type ArtifactValidationV1,
  type FormulaConstraintsV1,
  type FormulaValidationFinding,
  type MaterialEvidenceIndex,
  type TrustedRuntimeContext,
} from "@rnd-ai/ai-orchestration";

/**
 * Loads deterministic material evidence for a tenant's formula draft.
 *
 * Implementations resolve usage ranges, availability, and citation sources for
 * a set of material identifiers within the caller's tenant scope — never across
 * tenants. The set may contain both material ids and rm codes.
 */
export interface MaterialEvidenceProvider {
  /**
   * @param material_keys - Distinct material ids and rm codes to resolve.
   * @param context - Trusted tenant/actor identity (out of model input).
   * @returns Evidence keyed by material id and/or rm code.
   */
  load_evidence(
    material_keys: readonly string[],
    context: TrustedRuntimeContext,
  ): Promise<MaterialEvidenceIndex>;
}

/**
 * Loads tenant/product formula constraints (incompatibilities, required phases,
 * pH range, dated-cost policy) applied on top of the base validation.
 */
export interface FormulaConstraintProvider {
  /**
   * @param product_type - The draft's product type (e.g. "serum").
   * @param context - Trusted tenant/actor identity (out of model input).
   * @returns The configured constraints for that product within the tenant.
   */
  load_constraints(
    product_type: string,
    context: TrustedRuntimeContext,
  ): Promise<FormulaConstraintsV1>;
}

/**
 * Map an internal validation finding to the public, safe-message port finding.
 *
 * @param finding - Deterministic validator finding (carries `message`).
 * @returns The port finding shape with `safe_message`.
 */
function to_safe_finding(
  finding: FormulaValidationFinding,
): ArtifactValidationFindingV1 {
  return {
    code: finding.code,
    severity: finding.severity,
    safe_message: finding.message,
  };
}

/**
 * Collect distinct material identifiers (id and rm code) from a draft.
 *
 * Fields are typed optional to tolerate the schema's inferred shape across the
 * package boundary; the runtime values are always present (zod-validated), and
 * the guards make the collection safe regardless.
 *
 * @param ingredients - Draft ingredient lines.
 * @returns Deduplicated identifiers to resolve evidence for.
 */
function collect_material_keys(
  ingredients: readonly { readonly material_id?: string; readonly rm_code?: string }[],
): string[] {
  const keys = new Set<string>();
  for (const ingredient of ingredients) {
    if (ingredient.material_id) keys.add(ingredient.material_id);
    if (ingredient.rm_code) keys.add(ingredient.rm_code);
  }
  return [...keys];
}

/** Deterministic formula ArtifactService adapter for the governed loop. */
export class FormulaArtifactService implements ArtifactService {
  /**
   * @param evidence_provider - Loads tenant-scoped material evidence.
   * @param constraint_provider - Optional tenant/product constraint source; when
   *                              omitted, constraint-gated checks are no-ops.
   */
  constructor(
    private readonly evidence_provider: MaterialEvidenceProvider,
    private readonly constraint_provider?: FormulaConstraintProvider,
  ) {}

  /**
   * Validate a draft formula artifact deterministically with tenant evidence.
   *
   * @param artifact - Tool-produced draft payload (untrusted shape).
   * @param context - Trusted tenant/actor identity (out of model input).
   * @returns Blocking/warning findings (safe messages) plus computed quality
   *          dimensions; fails closed when the payload violates the contract.
   */
  async validate_draft(
    artifact: unknown,
    context: TrustedRuntimeContext,
  ): Promise<ArtifactValidationV1> {
    const parsed = formula_artifact_v1_schema.safeParse(artifact);
    if (!parsed.success) {
      return {
        valid: false,
        findings: [
          {
            code: "ARTIFACT_SCHEMA_INVALID",
            severity: "blocking",
            safe_message:
              "The formula draft does not match the required artifact contract.",
          },
        ],
      };
    }

    const draft = parsed.data;
    const material_keys = collect_material_keys(draft.ingredients);
    const evidence = await this.evidence_provider.load_evidence(
      material_keys,
      context,
    );
    const constraints = this.constraint_provider
      ? await this.constraint_provider.load_constraints(draft.product_type, context)
      : {};

    const validation = validate_formula_artifact(draft, evidence, constraints);
    const quality_dimensions = compute_formula_quality_dimensions(
      draft,
      evidence,
      validation,
    );

    return {
      valid: validation.valid,
      findings: validation.findings.map(to_safe_finding),
      quality_dimensions,
    };
  }
}
