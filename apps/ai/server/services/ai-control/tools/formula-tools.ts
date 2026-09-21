/**
 * Governed formula tools (G3 Task 4, Step 7).
 *
 * Replaces the legacy ReAct handlers (generate_formula, revise_formula,
 * search_reference_formulas, get_formula_with_comments, confirm_formula)
 * with five policy-governed definitions: formula.search, formula.draft,
 * formula.revise, formula.comment, formula.confirm. execute() delegates to
 * narrow injected ports — no direct Mongo/Qdrant access, no legacy handler
 * imports. Tenant scope arrives only through TrustedToolContext.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { z } from "zod";
import {
  formula_artifact_v1_schema,
  type FormulaArtifactV1,
} from "../../../../../../packages/ai-orchestration/src/artifacts/formula-schema";

import { log_info } from "../logger";
import {
  TOOL_PERMISSIONS,
  type ToolDefinition,
  type TrustedToolContext,
} from "../tool-definition";

const MODULE = "formula-tools";

/** MongoDB ObjectId string shape used for formula identifiers. */
const object_id_schema = z.string().regex(/^[a-f0-9]{24}$/i, "must be a 24-hex id");

// ---------------------------------------------------------------------------
// formula.search
// ---------------------------------------------------------------------------

export const formula_search_input_schema = z
  .object({
    query: z.string().min(1).max(200),
    status: z
      .enum(["draft", "testing", "approved", "rejected", "confirmed"])
      .optional(),
    client_name: z.string().min(1).max(120).optional(),
    benefits: z.array(z.string().min(1).max(80)).max(10).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();

export const formula_search_output_schema = z
  .object({
    result_count: z.number().int().min(0),
    formulas: z.array(
      z
        .object({
          formula_id: z.string(),
          formula_code: z.string().nullable(),
          formula_name: z.string(),
          version: z.number().int(),
          status: z.string(),
          client_name: z.string().nullable(),
          target_benefits: z.array(z.string()),
          ingredient_count: z.number().int(),
          total_amount_grams: z.number().nullable(),
          updated_at: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export type FormulaSearchInput = z.infer<typeof formula_search_input_schema>;
export type FormulaSearchOutput = z.infer<typeof formula_search_output_schema>;

/** Narrow read port over tenant-scoped formula search. */
export interface FormulaSearchPort {
  search_formulas(
    args: FormulaSearchInput,
    context: TrustedToolContext,
  ): Promise<FormulaSearchOutput>;
}

// ---------------------------------------------------------------------------
// formula.draft
// ---------------------------------------------------------------------------

export const formula_draft_input_schema = z
  .object({
    /** Model-proposed candidate; deterministic validation remains authoritative. */
    artifact: formula_artifact_v1_schema,
  })
  .strict();

export const formula_draft_output_schema = formula_artifact_v1_schema;

export type FormulaDraftInput = z.infer<typeof formula_draft_input_schema>;
export type FormulaDraftOutput = FormulaArtifactV1;

/** Narrow draft-write port creating tenant-scoped draft formulas. */
export interface FormulaDraftPort {
  create_draft_formula(
    args: FormulaDraftInput,
    context: TrustedToolContext,
  ): Promise<FormulaDraftOutput>;
}

// ---------------------------------------------------------------------------
// formula.revise
// ---------------------------------------------------------------------------

export const formula_revise_input_schema = z
  .object({
    formula_id: object_id_schema,
    artifact: formula_artifact_v1_schema,
    revision_summary: z.string().min(1).max(1_000),
  })
  .strict();

export const formula_revise_output_schema = formula_artifact_v1_schema;

export type FormulaReviseInput = z.infer<typeof formula_revise_input_schema>;
export type FormulaReviseOutput = FormulaArtifactV1;

/** Narrow draft-write port producing comment-driven revision drafts. */
export interface FormulaRevisePort {
  revise_formula(
    args: FormulaReviseInput,
    context: TrustedToolContext,
  ): Promise<FormulaReviseOutput>;
}

// ---------------------------------------------------------------------------
// formula.comment
// ---------------------------------------------------------------------------

export const formula_comment_input_schema = z
  .object({
    formula_id: object_id_schema,
    content: z.string().min(1).max(2_000),
    comment_type: z
      .enum(["feedback", "suggestion", "approval", "rejection", "revision_note"])
      .optional(),
  })
  .strict();

export const formula_comment_output_schema = z
  .object({
    comment_id: z.string(),
    formula_id: z.string(),
    comment_type: z.string(),
    created_at: z.string(),
  })
  .strict();

export type FormulaCommentInput = z.infer<typeof formula_comment_input_schema>;
export type FormulaCommentOutput = z.infer<typeof formula_comment_output_schema>;

/** Narrow draft-write port appending to the formula comment thread. */
export interface FormulaCommentPort {
  add_formula_comment(
    args: FormulaCommentInput,
    context: TrustedToolContext,
  ): Promise<FormulaCommentOutput>;
}

// ---------------------------------------------------------------------------
// formula.confirm
// ---------------------------------------------------------------------------

export const formula_confirm_input_schema = z
  .object({
    artifact_id: object_id_schema,
    remarks: z.string().max(500).optional(),
  })
  .strict();

export const formula_confirm_output_schema = z
  .object({
    artifact_id: z.string(),
    formula_id: z.string(),
    status: z.literal("confirmed"),
    already_committed: z.boolean(),
  })
  .strict();

export type FormulaConfirmInput = z.infer<typeof formula_confirm_input_schema>;
export type FormulaConfirmOutput = z.infer<typeof formula_confirm_output_schema>;

/** Narrow commit port confirming a draft and bumping its version. */
export interface FormulaConfirmPort {
  confirm_formula(
    args: FormulaConfirmInput,
    context: TrustedToolContext,
  ): Promise<FormulaConfirmOutput>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** All ports required by the five governed formula tools. */
export interface FormulaToolPorts {
  readonly formula_search: FormulaSearchPort;
  readonly formula_draft: FormulaDraftPort;
  readonly formula_revise: FormulaRevisePort;
  readonly formula_comment: FormulaCommentPort;
  readonly formula_confirm: FormulaConfirmPort;
}

/**
 * Build the five governed formula ToolDefinitions over injected ports.
 *
 * @param ports - Narrow repository/service ports (fakes in tests; real
 *                adapters land at gateway integration).
 * @returns Immutable array of formula tool definitions.
 */
export function create_formula_tool_definitions(
  ports: FormulaToolPorts,
): readonly ToolDefinition<any, any>[] {
  log_info(MODULE, "create_formula_tool_definitions — start");
  const definitions: readonly ToolDefinition<any, any>[] = [
    {
      name: "formula.search",
      version: "1.0.0",
      description:
        "Search this tenant's existing formulas by name, ingredient, benefit, or client.",
      input_schema: formula_search_input_schema,
      output_schema: formula_search_output_schema,
      required_permission: TOOL_PERMISSIONS.formula_read,
      side_effect: "read",
      approval_requirement: "none",
      timeout_ms: 10_000,
      retry: { max_attempts: 2, backoff_ms: 200 },
      capability_card_path: "tools/formula.search.md",
      execute: (args: FormulaSearchInput, context: TrustedToolContext) =>
        ports.formula_search.search_formulas(args, context),
    },
    {
      name: "formula.draft",
      version: "2.0.0",
      description:
        "Submit a complete evidence-bearing formula candidate for deterministic validation; never commits.",
      input_schema: formula_draft_input_schema,
      output_schema: formula_draft_output_schema,
      required_permission: TOOL_PERMISSIONS.formula_draft,
      side_effect: "draft_write",
      approval_requirement: "none",
      timeout_ms: 30_000,
      retry: { max_attempts: 1, backoff_ms: 0 },
      capability_card_path: "tools/formula.draft.md",
      execute: (args: FormulaDraftInput, context: TrustedToolContext) =>
        ports.formula_draft.create_draft_formula(args, context),
    },
    {
      name: "formula.revise",
      version: "2.0.0",
      description:
        "Submit a revised evidence-bearing candidate linked to an owned tenant formula.",
      input_schema: formula_revise_input_schema,
      output_schema: formula_revise_output_schema,
      required_permission: TOOL_PERMISSIONS.formula_revise,
      side_effect: "draft_write",
      approval_requirement: "none",
      timeout_ms: 30_000,
      retry: { max_attempts: 1, backoff_ms: 0 },
      capability_card_path: "tools/formula.revise.md",
      execute: (args: FormulaReviseInput, context: TrustedToolContext) =>
        ports.formula_revise.revise_formula(args, context),
    },
    {
      name: "formula.comment",
      version: "1.0.0",
      description:
        "Record a structured note in a formula's comment thread (feedback, suggestion, revision note).",
      input_schema: formula_comment_input_schema,
      output_schema: formula_comment_output_schema,
      required_permission: TOOL_PERMISSIONS.formula_comment,
      side_effect: "draft_write",
      approval_requirement: "none",
      timeout_ms: 10_000,
      retry: { max_attempts: 1, backoff_ms: 0 },
      capability_card_path: "tools/formula.comment.md",
      execute: (args: FormulaCommentInput, context: TrustedToolContext) =>
        ports.formula_comment.add_formula_comment(args, context),
    },
    {
      name: "formula.confirm",
      version: "2.0.0",
      description:
        "Commit a validated AI formula artifact. Commit-class; requires exact manager approval.",
      input_schema: formula_confirm_input_schema,
      output_schema: formula_confirm_output_schema,
      required_permission: TOOL_PERMISSIONS.formula_confirm,
      side_effect: "commit",
      approval_requirement: "manager",
      timeout_ms: 15_000,
      retry: { max_attempts: 1, backoff_ms: 0 },
      capability_card_path: "tools/formula.confirm.md",
      execute: (args: FormulaConfirmInput, context: TrustedToolContext) =>
        ports.formula_confirm.confirm_formula(args, context),
    },
  ];
  log_info(MODULE, "create_formula_tool_definitions — done", {
    count: definitions.length,
  });
  return definitions;
}
