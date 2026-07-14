/**
 * Formulas tRPC Router (G2.5).
 * Every read/write goes through ctx.repositories.formulas scoped by the
 * frozen ctx.tenant_context; no procedure touches db.collection directly.
 * Fine-grained permissions: formula:read for queries, formula:draft:create /
 * formula:draft:update_own for draft mutations, formula:confirm to confirm.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { Document, WithId } from "mongodb";
import type { Formula } from "@/lib/types";
import { router, tenantProcedure, throw_from_repository_error } from "../trpc";

/** Legacy response shape for one formula: full document, string _id. */
type SerializedFormula = Omit<Formula, "_id"> & { _id: string };

/** Ingredient line shared by the create and update input schemas. */
const ingredient_schema = z.object({
  materialId: z.string(),
  rm_code: z.string(),
  productName: z.string(),
  inci_name: z.string().optional(),
  amount: z.number().positive(),
  percentage: z.number().min(0).max(100).optional(),
  notes: z.string().optional(),
});

/** Lifecycle statuses accepted from the client (business field, not identity). */
const formula_status_schema = z.enum([
  "draft",
  "confirmed",
  "testing",
  "approved",
  "rejected",
]);

/**
 * Format a formula-code number as the display code (e.g. 7 -> "F000008").
 *
 * @param max_number - Highest known code number for the tenant.
 * @returns Next zero-padded formula code string.
 */
function format_next_formula_code(max_number: number): string {
  return `F${String(max_number + 1).padStart(6, "0")}`;
}

/**
 * Format a version number as its display label (e.g. 3 -> "v03").
 *
 * @param version - Version number to format.
 * @returns Zero-padded version label.
 */
function format_version_label(version: number): string {
  return `v${String(version).padStart(2, "0")}`;
}

/**
 * Serialize a repository formula document into the legacy response shape
 * (spread document with a string _id). The concrete Formula typing is kept
 * so tRPC client inference exposes the business fields to apps/web.
 *
 * @param formula - Repository document with an ObjectId _id.
 * @returns The same document with _id stringified.
 */
function serialize_formula(formula: WithId<Document>): SerializedFormula {
  return { ...formula, _id: formula._id.toString() } as SerializedFormula;
}

/**
 * Reject confirmed/approved status transitions for callers lacking the
 * formula:confirm permission, mirroring the legacy manager-only rule.
 *
 * @param permissions - Named permissions carried by the tenant context.
 * @param status - Requested target status (may be undefined on updates).
 * @throws TRPCError FORBIDDEN when the transition needs formula:confirm.
 */
function assert_confirm_permission_for_status(
  permissions: readonly string[],
  status: string | undefined,
): void {
  if (
    (status === "confirmed" || status === "approved") &&
    !permissions.includes("formula:confirm")
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "formula:confirm is required to confirm or approve a formula.",
    });
  }
}

export const formulasRouter = router({
  // Get next auto-generated formula code (tenant-scoped count/code scan).
  getNextCode: tenantProcedure("formula:read").query(async ({ ctx }) => {
    const maxNumber = await ctx.repositories.formulas.get_max_formula_code_number(
      ctx.tenant_context,
    );
    return { nextCode: format_next_formula_code(maxNumber), maxNumber };
  }),

  // Get all formulas for the caller's tenant, newest first.
  list: tenantProcedure("formula:read").query(async ({ ctx }) => {
    const formulas = await ctx.repositories.formulas.list_formulas(
      ctx.tenant_context,
    );
    return formulas
      .sort(
        (a, b) =>
          new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
      )
      .map(serialize_formula);
  }),

  // Get single formula by ID (cross-tenant/missing IDs both NOT_FOUND).
  getById: tenantProcedure("formula:read")
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      try {
        const formula = await ctx.repositories.formulas.get_formula(
          ctx.tenant_context,
          input.id,
        );
        return serialize_formula(formula);
      } catch (error) {
        throw_from_repository_error(error);
      }
    }),

  // Create new formula draft; tenant/owner stamping happens in the repository.
  create: tenantProcedure("formula:draft:create")
    .input(
      z.object({
        formulaName: z.string().min(1, "Formula name is required"),
        version: z.number().int().positive().default(1),
        client: z.string().optional(),
        targetBenefits: z.array(z.string()).optional(),
        ingredients: z
          .array(ingredient_schema)
          .min(1, "At least one ingredient is required"),
        totalAmount: z.number().positive().optional(),
        remarks: z.string().optional(),
        status: formula_status_schema.default("draft"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      console.log("[formulas] create — start", {
        formulaName: input.formulaName,
        actorProfileId: ctx.tenant_context.actor_profile_id,
        correlationId: ctx.tenant_context.correlation_id,
      });
      // Status transitions into confirmed/approved are manager territory.
      assert_confirm_permission_for_status(
        ctx.tenant_context.permissions,
        input.status,
      );

      const maxNumber = await ctx.repositories.formulas.get_max_formula_code_number(
        ctx.tenant_context,
      );
      const formulaCode = format_next_formula_code(maxNumber);

      const created = await ctx.repositories.formulas.create_formula(
        ctx.tenant_context,
        {
          formulaCode,
          formulaName: input.formulaName,
          version: input.version,
          client: input.client || "",
          targetBenefits: input.targetBenefits || [],
          ingredients: input.ingredients,
          totalAmount: input.totalAmount || 0,
          remarks: input.remarks || "",
          status: input.status,
        },
      );

      // Activity trail persists through the tenant-scoped audit repository.
      await ctx.repositories.audit_log.append_audit_event(ctx.tenant_context, {
        action: "create formula",
        resource_type: "formula",
        resource_id: created._id.toString(),
        metadata: { actor_name: ctx.user.name },
      });

      console.log("[formulas] create — done", { id: created._id.toString() });
      return {
        _id: created._id.toString(),
        formulaCode,
        success: true,
      };
    }),

  // Update own draft formula (owner + draft-status guard in the repository).
  update: tenantProcedure("formula:draft:update_own")
    .input(
      z.object({
        id: z.string(),
        formulaName: z.string().min(1).optional(),
        version: z.number().int().positive().optional(),
        client: z.string().optional(),
        targetBenefits: z.array(z.string()).optional(),
        ingredients: z.array(ingredient_schema).optional(),
        totalAmount: z.number().positive().optional(),
        remarks: z.string().optional(),
        status: formula_status_schema.optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      console.log("[formulas] update — start", {
        id: input.id,
        actorProfileId: ctx.tenant_context.actor_profile_id,
        correlationId: ctx.tenant_context.correlation_id,
      });
      // Status transitions into confirmed/approved are manager territory.
      assert_confirm_permission_for_status(
        ctx.tenant_context.permissions,
        input.status,
      );

      const { id, ...updateData } = input;
      try {
        await ctx.repositories.formulas.update_own_draft(
          ctx.tenant_context,
          id,
          updateData,
        );
      } catch (error) {
        throw_from_repository_error(error);
      }

      await ctx.repositories.audit_log.append_audit_event(ctx.tenant_context, {
        action: "update formula",
        resource_type: "formula",
        resource_id: id,
        metadata: { actor_name: ctx.user.name },
      });

      console.log("[formulas] update — done", { id });
      return { success: true };
    }),

  // Delete a tenant formula (draft-owner permission gate).
  delete: tenantProcedure("formula:draft:update_own")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      console.log("[formulas] delete — start", {
        id: input.id,
        actorProfileId: ctx.tenant_context.actor_profile_id,
        correlationId: ctx.tenant_context.correlation_id,
      });
      try {
        await ctx.repositories.formulas.delete_formula(
          ctx.tenant_context,
          input.id,
        );
      } catch (error) {
        throw_from_repository_error(error);
      }

      await ctx.repositories.audit_log.append_audit_event(ctx.tenant_context, {
        action: "delete formula",
        resource_type: "formula",
        resource_id: input.id,
        metadata: { actor_name: ctx.user.name },
      });

      console.log("[formulas] delete — done", { id: input.id });
      return { success: true };
    }),

  /**
   * Confirm a draft formula — transitions status from 'draft' to 'confirmed',
   * bumps the version number, and creates an immutable version log entry
   * with a full ingredient snapshot plus a version_update comment.
   *
   * @param id      - Formula ID to confirm
   * @param remarks - Optional confirmation remarks
   * @returns Object with new version number and success flag
   */
  confirm: tenantProcedure("formula:confirm")
    .input(
      z.object({
        id: z.string(),
        remarks: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      console.log("[formulas] confirm — start", {
        id: input.id,
        actorProfileId: ctx.tenant_context.actor_profile_id,
        correlationId: ctx.tenant_context.correlation_id,
      });

      let formula: WithId<Document>;
      try {
        formula = await ctx.repositories.formulas.get_formula(
          ctx.tenant_context,
          input.id,
        );
      } catch (error) {
        throw_from_repository_error(error);
      }

      if (formula.status !== "draft") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot confirm — formula is currently "${formula.status}", must be "draft"`,
        });
      }

      // Calculate next version: current confirmed version + 1.
      const previous_version = formula.version || 0;
      const next_version = previous_version + 1;
      const version_label = format_version_label(next_version);
      const actor_name = ctx.user.name || "Unknown";

      try {
        // Single idempotent repository write: status flip, version bump, and
        // the immutable version log (with ingredient snapshot) together.
        await ctx.repositories.formulas.confirm_formula(
          ctx.tenant_context,
          input.id,
          `confirm:${input.id}:${version_label}`,
          {
            confirmed_version: next_version,
            log_fields: {
              version: next_version,
              previousVersion: previous_version,
              changeType: "confirmed",
              updatedBySource: "user",
              updatedByName: actor_name,
              status: "confirmed",
              ingredientSnapshot: formula.ingredients || [],
              changelog: null,
              remarks:
                input.remarks || `Confirmed by ${actor_name} — ${version_label}`,
            },
          },
        );

        // Add a version_update comment (attached to the new confirmed version).
        await ctx.repositories.formulas.add_comment(
          ctx.tenant_context,
          input.id,
          {
            version: next_version,
            userName: actor_name,
            content: `Confirmed as ${version_label}${input.remarks ? ` — ${input.remarks}` : ""}`,
            commentType: "version_update",
            parentCommentId: null,
            metadata: { version: next_version, changeType: "confirmed" },
          },
        );
      } catch (error) {
        throw_from_repository_error(error);
      }

      await ctx.repositories.audit_log.append_audit_event(ctx.tenant_context, {
        action: "confirm formula",
        resource_type: "formula",
        resource_id: input.id,
        metadata: { actor_name, version: next_version },
      });

      console.log("[formulas] confirm — done", {
        formulaId: input.id,
        newVersion: next_version,
      });

      return {
        success: true,
        version: next_version,
        versionLabel: version_label,
      };
    }),
});
