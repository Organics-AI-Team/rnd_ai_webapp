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
  hash_arguments,
  validate_formula_artifact,
  type ArtifactService,
  type ArtifactValidationFindingV1,
  type ArtifactValidationV1,
  type FormulaArtifactV1,
  type FormulaConstraintsV1,
  type FormulaValidationFinding,
  type MaterialEvidenceIndex,
  type TrustedRuntimeContext,
} from "@rnd-ai/ai-orchestration";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";

import type { AIArtifactRepository } from "../../repositories/ai-artifact-repository";
import type { FormulaRepository } from "../../repositories/formula-repository";
import { require_permission } from "../../repositories/tenant-repository-base";

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

/**
 * Collect distinct evidence source ids cited across a draft's ingredients and
 * claims, for provenance on the persisted artifact.
 *
 * @param artifact - The validated formula artifact.
 * @returns Deduplicated source identifiers.
 */
function collect_source_ids(artifact: FormulaArtifactV1): string[] {
  const ids = new Set<string>();
  for (const ingredient of artifact.ingredients) {
    for (const source of ingredient.source_ids ?? []) ids.add(source);
  }
  for (const claim of artifact.claims ?? []) {
    for (const source of claim.source_ids ?? []) ids.add(source);
  }
  return [...ids];
}

/**
 * Answers whether a durable manager approval covers committing an artifact.
 * The concrete adapter (backed by ai_approvals) is wired by the AI gateway; the
 * service stays agnostic to how approvals are stored.
 */
export interface FormulaApprovalGate {
  /**
   * @param query - Tenant, artifact, and run identifying the approval.
   * @param context - Verified tenant execution context.
   * @returns True when an approved AIApproval covers the commit.
   */
  has_approved_artifact(
    query: { tenant_id: string; artifact_id: string; run_id: string },
    context: TenantExecutionContext,
  ): Promise<boolean>;
}

/** Raised when commit_confirmed is called without a covering approval. */
export class FormulaCommitNotApprovedError extends Error {
  /** Stable, client-safe error code. */
  readonly code = "FORMULA_COMMIT_NOT_APPROVED";
  /**
   * @param artifact_id - The artifact that lacked an approval.
   */
  constructor(artifact_id: string) {
    super(`No approved AIApproval covers artifact "${artifact_id}".`);
    this.name = "FormulaCommitNotApprovedError";
  }
}

/** Arguments identifying one idempotent artifact commit. */
export interface CommitConfirmedArgs {
  readonly artifact_id: string;
  readonly run_id: string;
  /** Stable key making the confirm version-log write replay-safe. */
  readonly idempotency_key: string;
}

/**
 * Map a validated formula artifact into a Formula repository create payload.
 *
 * `organizationId` is deliberately NOT set: it is a server-derived security
 * field the tenant repository forbids in input and stamps itself from the
 * tenant context, exactly as every other tenant-scoped formula is created.
 *
 * @param artifact - The validated formula artifact.
 * @param created_by - Acting profile id recorded as the creator.
 * @returns A create_formula input document.
 */
function map_artifact_to_formula(
  artifact: FormulaArtifactV1,
  created_by: string,
): Record<string, unknown> {
  return {
    formulaName: artifact.name,
    version: 0,
    targetBenefits: [],
    ingredients: artifact.ingredients.map((ingredient) => ({
      materialId: ingredient.material_id,
      rm_code: ingredient.rm_code,
      productName: ingredient.rm_code,
      amount: Number(ingredient.amount),
      percentage: Number(ingredient.percentage),
      notes: `${ingredient.phase} — ${ingredient.rationale}`,
    })),
    totalAmount: Number(artifact.batch_size),
    remarks: "Confirmed from AI formula artifact",
    aiGenerated: true,
    createdBy: created_by,
    warnings: artifact.warnings ?? [],
  };
}

/** Deterministic formula ArtifactService adapter for the governed loop. */
export class FormulaArtifactService implements ArtifactService {
  /**
   * @param evidence_provider - Loads tenant-scoped material evidence.
   * @param constraint_provider - Optional tenant/product constraint source; when
   *                              omitted, constraint-gated checks are no-ops.
   * @param artifact_repository - Optional persistence for draft artifacts;
   *                              required for `persist_draft`/`commit_confirmed`.
   * @param formula_repository - Optional tenant formula repository; required for
   *                             `commit_confirmed`.
   */
  constructor(
    private readonly evidence_provider: MaterialEvidenceProvider,
    private readonly constraint_provider?: FormulaConstraintProvider,
    private readonly artifact_repository?: AIArtifactRepository,
    private readonly formula_repository?: FormulaRepository,
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

  /**
   * Persist a validated draft formula as a tenant-scoped AIArtifact (status
   * draft). Callers persist the validation they already computed rather than
   * re-running it, so the stored `validationResult` matches what the reviewer
   * saw. Content is hashed canonically (key-order independent) for provenance.
   *
   * @param context - Verified tenant execution context (app-side identity).
   * @param artifact - The validated formula artifact to store.
   * @param validation - The validation outcome recorded alongside the draft.
   * @param run_id - The run that produced the draft (provenance link).
   * @returns The persisted artifact id and its canonical content hash.
   * @throws Error when no AIArtifactRepository was injected.
   */
  async persist_draft(
    context: TenantExecutionContext,
    artifact: FormulaArtifactV1,
    validation: ArtifactValidationV1,
    run_id: string,
  ): Promise<{ artifact_id: string; content_hash: string }> {
    if (!this.artifact_repository) {
      throw new Error(
        "FormulaArtifactService.persist_draft requires an AIArtifactRepository.",
      );
    }
    const content_hash = hash_arguments(artifact);
    const document = await this.artifact_repository.persist_draft(context, {
      runId: run_id,
      artifactType: "formula",
      schemaVersion: "1",
      content: artifact,
      contentHash: content_hash,
      validationResult: validation,
      sourceEvidenceIds: collect_source_ids(artifact),
    });
    return { artifact_id: String(document._id), content_hash };
  }

  /**
   * Commit a confirmed draft artifact to a real tenant Formula. Only a manager
   * carrying `formula:confirm` with an approved AIApproval may commit; the
   * artifact is mapped into a Formula, created and confirmed idempotently through
   * the FormulaRepository, then linked back to the artifact so a replay returns
   * the same formula instead of duplicating it.
   *
   * @param context - Verified tenant execution context (must hold formula:confirm).
   * @param args - Artifact/run/organization ids and the confirm idempotency key.
   * @param approval_gate - Injected check for a covering approved AIApproval.
   * @returns The committed formula id and whether the commit already existed.
   * @throws Error when the required repositories were not injected.
   * @throws PermissionDeniedError when the context lacks formula:confirm.
   * @throws FormulaCommitNotApprovedError when no approval covers the artifact.
   * @throws ResourceNotFoundError when the artifact is missing or cross-tenant.
   */
  async commit_confirmed(
    context: TenantExecutionContext,
    args: CommitConfirmedArgs,
    approval_gate: FormulaApprovalGate,
  ): Promise<{ formula_id: string; already_committed: boolean }> {
    if (!this.artifact_repository || !this.formula_repository) {
      throw new Error(
        "FormulaArtifactService.commit_confirmed requires an AIArtifactRepository and a FormulaRepository.",
      );
    }
    require_permission(context, "formula:confirm");

    const artifact_document = await this.artifact_repository.get_artifact(
      context,
      args.artifact_id,
    );
    // Idempotent replay: an already-committed artifact returns its formula.
    if (
      artifact_document.status === "confirmed" &&
      typeof artifact_document.confirmedFormulaId === "string"
    ) {
      return { formula_id: artifact_document.confirmedFormulaId, already_committed: true };
    }

    const approved = await approval_gate.has_approved_artifact(
      { tenant_id: context.tenant_id, artifact_id: args.artifact_id, run_id: args.run_id },
      context,
    );
    if (!approved) {
      throw new FormulaCommitNotApprovedError(args.artifact_id);
    }

    const parsed = formula_artifact_v1_schema.safeParse(artifact_document.content);
    if (!parsed.success) {
      throw new Error(
        `Stored artifact "${args.artifact_id}" content is not a valid formula artifact.`,
      );
    }

    const formula = await this.formula_repository.create_formula(
      context,
      map_artifact_to_formula(parsed.data, context.actor_profile_id),
    );
    const formula_id = String(formula._id);
    await this.formula_repository.confirm_formula(context, formula_id, args.idempotency_key, {
      log_fields: {
        changeType: "confirmed",
        updatedBySource: "ai",
        updatedByUserId: context.actor_profile_id,
        updatedByName: context.actor_profile_id,
        status: "confirmed",
        remarks: `Confirmed from AI artifact ${args.artifact_id}`,
      },
    });
    await this.artifact_repository.mark_confirmed(context, args.artifact_id, formula_id);

    return { formula_id, already_committed: false };
  }
}
