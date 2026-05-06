/**
 * Formula Comments tRPC Router
 * CRUD operations for comments/feedback on formulas.
 * Supports threaded replies, typed comments (feedback, suggestion, approval, rejection, revision_note).
 *
 * @author AI Management System
 * @date 2026-03-30
 */

import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import client_promise from "@rnd-ai/shared-database";
import { ObjectId } from "mongodb";

/** Valid comment types matching Prisma CommentType enum */
const COMMENT_TYPES = ["feedback", "suggestion", "approval", "rejection", "revision_note", "version_update"] as const;

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
  list: protectedProcedure
    .input(z.object({
      formulaId: z.string(),
      version: z.number().int().optional(),
    }))
    .query(async ({ input }) => {
      console.log(`[formulaComments.list] start — formulaId=${input.formulaId}, version=${input.version ?? 'all'}`);

      const client = await client_promise;
      const db = client.db();

      const filter: Record<string, any> = { formulaId: input.formulaId };
      if (input.version !== undefined) {
        filter.version = input.version;
      }

      const comments = await db
        .collection("formula_comments")
        .find(filter)
        .sort({ createdAt: -1 })
        .toArray();

      console.log(`[formulaComments.list] done — count=${comments.length}`);
      return comments;
    }),

  /**
   * Create a new comment on a formula, scoped to a specific version.
   *
   * @param formulaId       - Target formula
   * @param version         - Formula version this comment applies to (default: current)
   * @param content         - Comment text
   * @param commentType     - One of: feedback, suggestion, approval, rejection, revision_note, version_update
   * @param parentCommentId - Optional parent for threaded replies
   * @param metadata        - Optional JSON metadata (e.g. AI revision references)
   */
  create: protectedProcedure
    .input(
      z.object({
        formulaId: z.string(),
        version: z.number().int().optional(),
        content: z.string().min(1, "Comment cannot be empty"),
        commentType: z.enum(COMMENT_TYPES).default("feedback"),
        parentCommentId: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      console.log(`[formulaComments.create] start — formulaId=${input.formulaId}, version=${input.version ?? 'auto'}, type=${input.commentType}`);

      const client = await client_promise;
      const db = client.db();

      // If version not provided, look up the current formula version
      let comment_version = input.version ?? 0;
      if (input.version === undefined) {
        try {
          const formula = await db.collection("formulas").findOne(
            { _id: new ObjectId(input.formulaId) },
            { projection: { version: 1 } }
          );
          if (formula) {
            comment_version = formula.version || 0;
          }
        } catch (err) {
          console.warn("[formulaComments.create] failed to lookup formula version, defaulting to 0");
        }
      }

      const comment = {
        formulaId: input.formulaId,
        version: comment_version,
        userId: ctx.user.id,
        userName: ctx.user.name || ctx.user.email,
        content: input.content,
        commentType: input.commentType,
        parentCommentId: input.parentCommentId || null,
        metadata: input.metadata || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await db.collection("formula_comments").insertOne(comment);

      console.log(`[formulaComments.create] done — id=${result.insertedId}, version=${comment_version}`);
      return { ...comment, _id: result.insertedId };
    }),

  /**
   * Update an existing comment's content.
   *
   * @param commentId - The comment to update
   * @param content   - New comment text
   */
  update: protectedProcedure
    .input(
      z.object({
        commentId: z.string(),
        content: z.string().min(1, "Comment cannot be empty"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      console.log(`[formulaComments.update] start — commentId=${input.commentId}`);

      const client = await client_promise;
      const db = client.db();

      const result = await db.collection("formula_comments").updateOne(
        { _id: new ObjectId(input.commentId), userId: ctx.user.id },
        {
          $set: {
            content: input.content,
            updatedAt: new Date(),
          },
        }
      );

      console.log(`[formulaComments.update] done — modified=${result.modifiedCount}`);
      return { success: result.modifiedCount > 0 };
    }),

  /**
   * Delete a comment (only the author can delete).
   *
   * @param commentId - The comment to delete
   */
  delete: protectedProcedure
    .input(z.object({ commentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      console.log(`[formulaComments.delete] start — commentId=${input.commentId}`);

      const client = await client_promise;
      const db = client.db();

      const result = await db.collection("formula_comments").deleteOne({
        _id: new ObjectId(input.commentId),
        userId: ctx.user.id,
      });

      console.log(`[formulaComments.delete] done — deleted=${result.deletedCount}`);
      return { success: result.deletedCount > 0 };
    }),

  /**
   * Get comment count for a formula, optionally scoped to a version.
   *
   * @param formulaId - The formula to count comments for
   * @param version   - Optional version to scope count to
   * @returns Object with total count and breakdown by type
   */
  count: protectedProcedure
    .input(z.object({
      formulaId: z.string(),
      version: z.number().int().optional(),
    }))
    .query(async ({ input }) => {
      console.log(`[formulaComments.count] start — formulaId=${input.formulaId}, version=${input.version ?? 'all'}`);

      const client = await client_promise;
      const db = client.db();

      const match_filter: Record<string, any> = { formulaId: input.formulaId };
      if (input.version !== undefined) {
        match_filter.version = input.version;
      }

      const pipeline = [
        { $match: match_filter },
        {
          $group: {
            _id: "$commentType",
            count: { $sum: 1 },
          },
        },
      ];

      const type_counts = await db
        .collection("formula_comments")
        .aggregate(pipeline)
        .toArray();

      const total = type_counts.reduce((sum, tc) => sum + tc.count, 0);
      const by_type = Object.fromEntries(type_counts.map((tc) => [tc._id, tc.count]));

      console.log(`[formulaComments.count] done — total=${total}`);
      return { total, by_type };
    }),
});
