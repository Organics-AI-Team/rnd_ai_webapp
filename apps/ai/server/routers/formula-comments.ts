/**
 * Formula Comments tRPC Router (G2.5).
 * CRUD operations for comments/feedback on formulas, running entirely through
 * ctx.repositories.formulas scoped by ctx.tenant_context. Reads require
 * formula:read; writes require formula:comment:create, and update/delete are
 * additionally author-bound inside the repository.
 * Supports threaded replies, typed comments (feedback, suggestion, approval,
 * rejection, revision_note, version_update).
 *
 * @author AI Management System
 * @date 2026-03-30
 */

import { z } from "zod";
import { router, tenantProcedure, throw_from_repository_error } from "../trpc";

/** Valid comment types matching Prisma CommentType enum */
const COMMENT_TYPES = [
  "feedback",
  "suggestion",
  "approval",
  "rejection",
  "revision_note",
  "version_update",
] as const;

export const formulaCommentsRouter = router({
  /**
   * List comments for a formula, optionally filtered by version.
   * When version is provided, returns only comments for that specific version.
   * When omitted, returns all comments across all versions.
   *
   * @param formulaId - The formula to fetch comments for
   * @param version   - Optional version number to filter by
   * @returns Array of FormulaComment documents sorted newest-first
   */
  list: tenantProcedure("formula:read")
    .input(
      z.object({
        formulaId: z.string(),
        version: z.number().int().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      console.log(
        `[formulaComments.list] start — formulaId=${input.formulaId}, version=${input.version ?? "all"}, correlationId=${ctx.tenant_context.correlation_id}`,
      );

      try {
        const comments = await ctx.repositories.formulas.list_comments(
          ctx.tenant_context,
          input.formulaId,
        );
        const filtered =
          input.version !== undefined
            ? comments.filter((comment) => comment.version === input.version)
            : comments;
        const sorted = filtered.sort(
          (a, b) =>
            new Date(b.createdAt ?? 0).getTime() -
            new Date(a.createdAt ?? 0).getTime(),
        );

        console.log(`[formulaComments.list] done — count=${sorted.length}`);
        return sorted;
      } catch (error) {
        throw_from_repository_error(error);
      }
    }),

  /**
   * Create a new comment on a formula, scoped to a specific version.
   * Tenant and author identity are stamped from the tenant execution context.
   *
   * @param formulaId       - Target formula
   * @param version         - Formula version this comment applies to (default: current)
   * @param content         - Comment text
   * @param commentType     - One of: feedback, suggestion, approval, rejection, revision_note, version_update
   * @param parentCommentId - Optional parent for threaded replies
   * @param metadata        - Optional JSON metadata (e.g. AI revision references)
   */
  create: tenantProcedure("formula:comment:create")
    .input(
      z.object({
        formulaId: z.string(),
        version: z.number().int().optional(),
        content: z.string().min(1, "Comment cannot be empty"),
        commentType: z.enum(COMMENT_TYPES).default("feedback"),
        parentCommentId: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      console.log(
        `[formulaComments.create] start — formulaId=${input.formulaId}, version=${input.version ?? "auto"}, type=${input.commentType}, correlationId=${ctx.tenant_context.correlation_id}`,
      );

      try {
        // If version not provided, look up the current tenant-scoped formula
        // version; add_comment re-validates the parent on write.
        let comment_version = input.version ?? 0;
        if (input.version === undefined) {
          const formula = await ctx.repositories.formulas.get_formula(
            ctx.tenant_context,
            input.formulaId,
          );
          comment_version = formula.version || 0;
        }

        const created = await ctx.repositories.formulas.add_comment(
          ctx.tenant_context,
          input.formulaId,
          {
            version: comment_version,
            userName: ctx.user.name || ctx.user.email,
            content: input.content,
            commentType: input.commentType,
            parentCommentId: input.parentCommentId || null,
            metadata: input.metadata || null,
          },
        );

        console.log(
          `[formulaComments.create] done — id=${created._id}, version=${comment_version}`,
        );
        return created;
      } catch (error) {
        throw_from_repository_error(error);
      }
    }),

  /**
   * Update an existing comment's content (only the author can update).
   *
   * @param commentId - The comment to update
   * @param content   - New comment text
   */
  update: tenantProcedure("formula:comment:create")
    .input(
      z.object({
        commentId: z.string(),
        content: z.string().min(1, "Comment cannot be empty"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      console.log(
        `[formulaComments.update] start — commentId=${input.commentId}, correlationId=${ctx.tenant_context.correlation_id}`,
      );

      try {
        await ctx.repositories.formulas.update_own_comment(
          ctx.tenant_context,
          input.commentId,
          { content: input.content },
        );
      } catch (error) {
        throw_from_repository_error(error);
      }

      console.log(`[formulaComments.update] done — commentId=${input.commentId}`);
      return { success: true };
    }),

  /**
   * Delete a comment (only the author can delete).
   *
   * @param commentId - The comment to delete
   */
  delete: tenantProcedure("formula:comment:create")
    .input(z.object({ commentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      console.log(
        `[formulaComments.delete] start — commentId=${input.commentId}, correlationId=${ctx.tenant_context.correlation_id}`,
      );

      try {
        await ctx.repositories.formulas.delete_own_comment(
          ctx.tenant_context,
          input.commentId,
        );
      } catch (error) {
        throw_from_repository_error(error);
      }

      console.log(`[formulaComments.delete] done — commentId=${input.commentId}`);
      return { success: true };
    }),

  /**
   * Get comment count for a formula, optionally scoped to a version.
   *
   * @param formulaId - The formula to count comments for
   * @param version   - Optional version to scope count to
   * @returns Object with total count and breakdown by type
   */
  count: tenantProcedure("formula:read")
    .input(
      z.object({
        formulaId: z.string(),
        version: z.number().int().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      console.log(
        `[formulaComments.count] start — formulaId=${input.formulaId}, version=${input.version ?? "all"}, correlationId=${ctx.tenant_context.correlation_id}`,
      );

      try {
        const type_counts = await ctx.repositories.formulas.count_comments_by_type(
          ctx.tenant_context,
          input.formulaId,
          input.version,
        );

        const total = type_counts.reduce((sum, tc) => sum + tc.count, 0);
        const by_type = Object.fromEntries(
          type_counts.map((tc) => [tc.commentType, tc.count]),
        );

        console.log(`[formulaComments.count] done — total=${total}`);
        return { total, by_type };
      } catch (error) {
        throw_from_repository_error(error);
      }
    }),
});
