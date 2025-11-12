import { z } from "zod";
import { router, protectedProcedure, publicProcedure } from "../trpc";
import { raw_materials_client_promise } from "@rnd-ai/shared-database";
import { ObjectId } from "mongodb";

export const rawMaterialsConversationRouter = router({
  // Save a message to raw materials conversation
  saveMessage: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        content: z.string(),
        role: z.enum(['user', 'assistant']),
        timestamp: z.date(),
        responseId: z.string().optional(),
        feedbackSubmitted: z.boolean().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const client = await raw_materials_client_promise;
      const db = client.db();

      const message = {
        ...input,
        userId: ctx.user.id,
        _id: new ObjectId()
      };

      // Insert message into raw_materials_conversations collection
      await db.collection("raw_materials_conversations").insertOne(message);

      // Update user's last activity
      await db.collection("users").updateOne(
        { _id: new ObjectId(ctx.user.id) },
        {
          $set: { lastActivityAt: new Date() },
          $inc: { totalRawMaterialsMessages: 1 }
        },
        { upsert: true }
      );

      return { success: true, messageId: message._id.toString() };
    }),

  // Get raw materials conversation history for a user
  getHistory: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(40),
        offset: z.number().min(0).default(0)
      })
    )
    .query(async ({ ctx, input }) => {
      const client = await raw_materials_client_promise;
      const db = client.db();

      const messages = await db.collection("raw_materials_conversations")
        .find({ userId: ctx.user.id })
        .sort({ timestamp: -1 })
        .skip(input.offset)
        .limit(input.limit)
        .toArray();

      // Return in chronological order (oldest first)
      return messages.reverse().map(msg => ({
        id: msg.id,
        content: msg.content,
        role: msg.role,
        timestamp: msg.timestamp,
        responseId: msg.responseId,
        feedbackSubmitted: msg.feedbackSubmitted,
        _id: msg._id.toString()
      }));
    }),

  // Get recent messages for AI context
  getRecentMessages: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(20)
      })
    )
    .query(async ({ ctx, input }) => {
      const client = await raw_materials_client_promise;
      const db = client.db();

      const messages = await db.collection("raw_materials_conversations")
        .find({ userId: ctx.user.id })
        .sort({ timestamp: -1 })
        .limit(input.limit)
        .toArray();

      // Return in chronological order and formatted for AI
      return messages.reverse().map(msg => ({
        role: msg.role,
        content: msg.content
      }));
    }),

  // Clear raw materials conversation history for a user
  clearHistory: protectedProcedure
    .mutation(async ({ ctx }) => {
      const client = await raw_materials_client_promise;
      const db = client.db();

      const result = await db.collection("raw_materials_conversations")
        .deleteMany({ userId: ctx.user.id });

      // Reset user's raw materials message count
      await db.collection("users").updateOne(
        { _id: new ObjectId(ctx.user.id) },
        {
          $set: { totalRawMaterialsMessages: 0, lastRawMaterialsClearedAt: new Date() }
        },
        { upsert: true }
      );

      return { success: true, deletedCount: result.deletedCount };
    }),

  // Get raw materials conversation statistics
  getStats: protectedProcedure
    .query(async ({ ctx }) => {
      const client = await raw_materials_client_promise;
      const db = client.db();

      const totalMessages = await db.collection("raw_materials_conversations")
        .countDocuments({ userId: ctx.user.id });

      const userMessages = await db.collection("raw_materials_conversations")
        .countDocuments({ userId: ctx.user.id, role: 'user' });

      const assistantMessages = await db.collection("raw_materials_conversations")
        .countDocuments({ userId: ctx.user.id, role: 'assistant' });

      // Get oldest and newest message dates
      const oldestMessage = await db.collection("raw_materials_conversations")
        .find({ userId: ctx.user.id })
        .sort({ timestamp: 1 })
        .limit(1)
        .toArray();

      const newestMessage = await db.collection("raw_materials_conversations")
        .find({ userId: ctx.user.id })
        .sort({ timestamp: -1 })
        .limit(1)
        .toArray();

      return {
        totalMessages,
        userMessages,
        assistantMessages,
        firstMessageAt: oldestMessage[0]?.timestamp || null,
        lastMessageAt: newestMessage[0]?.timestamp || null
      };
    }),

  // Get conversations with feedback for analytics
  getConversationWithFeedback: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(20)
      })
    )
    .query(async ({ ctx, input }) => {
      const client = await raw_materials_client_promise;
      const db = client.db();

      const conversations = await db.collection("raw_materials_conversations")
        .aggregate([
          { $match: { userId: ctx.user.id, role: 'assistant', responseId: { $exists: true } } },
          {
            $lookup: {
              from: 'raw_materials_feedback',
              localField: 'responseId',
              foreignField: 'responseId',
              as: 'feedback'
            }
          },
          { $sort: { timestamp: -1 } },
          { $limit: input.limit },
          {
            $project: {
              id: 1,
              content: 1,
              role: 1,
              timestamp: 1,
              responseId: 1,
              feedbackSubmitted: 1,
              feedbackCount: { $size: '$feedback' },
              averageScore: { $avg: '$feedback.score' }
            }
          }
        ])
        .toArray();

      return conversations;
    }),

  });