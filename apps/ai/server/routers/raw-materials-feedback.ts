import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { raw_materials_client_promise } from "@rnd-ai/shared-database";
import { ObjectId } from "mongodb";

const FeedbackSchema = z.object({
  responseId: z.string(),
  type: z.enum(["excellent", "helpful", "okay", "unclear", "too_long", "too_short", "irrelevant"]),
  score: z.number().min(1).max(5),
  comment: z.string().optional(),
  prompt: z.string(),
  aiResponse: z.string(),
  aiModel: z.string(),
});

export const rawMaterialsFeedbackRouter = router({
  // Submit feedback for a raw materials AI response
  submit: protectedProcedure
    .input(FeedbackSchema)
    .mutation(async ({ ctx, input }) => {
      const client = await raw_materials_client_promise;
      const db = client.db();

      const feedback = {
        ...input,
        userId: ctx.user.id,
        _id: new ObjectId(),
        createdAt: new Date(),
      };

      // Insert feedback into raw_materials_feedback collection
      await db.collection("raw_materials_feedback").insertOne(feedback);

      return { success: true, feedbackId: feedback._id.toString() };
    }),

  // Get feedback statistics for a user
  getStats: protectedProcedure
    .query(async ({ ctx }) => {
      const client = await raw_materials_client_promise;
      const db = client.db();

      const totalFeedback = await db.collection("raw_materials_feedback")
        .countDocuments({ userId: ctx.user.id });

      const averageScore = await db.collection("raw_materials_feedback")
        .aggregate([
          { $match: { userId: ctx.user.id } },
          { $group: { _id: null, avgScore: { $avg: "$score" } } }
        ])
        .toArray();

      const feedbackByType = await db.collection("raw_materials_feedback")
        .aggregate([
          { $match: { userId: ctx.user.id } },
          { $group: { _id: "$type", count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ])
        .toArray();

      return {
        totalFeedback,
        averageScore: averageScore[0]?.avgScore || 0,
        feedbackByType,
      };
    }),

  // Get recent feedback
  getRecent: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      const client = await raw_materials_client_promise;
      const db = client.db();

      const feedback = await db.collection("raw_materials_feedback")
        .find({ userId: ctx.user.id })
        .sort({ createdAt: -1 })
        .limit(input.limit)
        .toArray();

      return feedback.map(f => ({
        id: f._id?.toString(),
        responseId: f.responseId,
        type: f.type,
        score: f.score,
        comment: f.comment,
        prompt: f.prompt,
        aiResponse: f.aiResponse,
        aiModel: f.aiModel,
        createdAt: f.createdAt,
      }));
    }),
});