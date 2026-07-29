import { z } from "zod";
import { router, tenantProcedure, throw_from_repository_error } from "../trpc";

export const rawMaterialsConversationRouter = router({
  // Save a message to the acting profile's raw materials conversation log
  saveMessage: tenantProcedure("ai:run")
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
      console.info('[rawMaterialsConversations] saveMessage — start', {
        tenantId: ctx.tenant_context.tenant_id,
        actorProfileId: ctx.tenant_context.actor_profile_id,
      });
      try {
        const message = await ctx.repositories.conversations.save_raw_material_message(
          ctx.tenant_context,
          input,
        );
        console.info('[rawMaterialsConversations] saveMessage — done', {
          messageId: message._id.toString(),
        });
        return { success: true, messageId: message._id.toString() };
      } catch (error) {
        throw_from_repository_error(error);
      }
    }),

  // Get raw materials conversation history for the acting profile
  getHistory: tenantProcedure("ai:run")
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(40),
        offset: z.number().min(0).default(0)
      })
    )
    .query(async ({ ctx, input }) => {
      const messages = await ctx.repositories.conversations.list_own_raw_material_messages(
        ctx.tenant_context,
        { limit: input.limit, offset: input.offset },
      );

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
  getRecentMessages: tenantProcedure("ai:run")
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(20)
      })
    )
    .query(async ({ ctx, input }) => {
      const messages = await ctx.repositories.conversations.list_own_raw_material_messages(
        ctx.tenant_context,
        { limit: input.limit, offset: 0 },
      );

      // Return in chronological order and formatted for AI
      return messages.reverse().map(msg => ({
        role: msg.role,
        content: msg.content
      }));
    }),

  // Clear raw materials conversation history for the acting profile
  clearHistory: tenantProcedure("ai:run")
    .mutation(async ({ ctx }) => {
      console.info('[rawMaterialsConversations] clearHistory — start', {
        tenantId: ctx.tenant_context.tenant_id,
        actorProfileId: ctx.tenant_context.actor_profile_id,
      });
      const deletedCount = await ctx.repositories.conversations.clear_own_raw_material_messages(
        ctx.tenant_context,
      );
      console.info('[rawMaterialsConversations] clearHistory — done', { deletedCount });
      return { success: true, deletedCount };
    }),

  // Get raw materials conversation statistics for the acting profile
  getStats: tenantProcedure("ai:run")
    .query(async ({ ctx }) => {
      const stats = await ctx.repositories.conversations.get_own_raw_material_message_stats(
        ctx.tenant_context,
      );

      return {
        totalMessages: stats.total_messages,
        userMessages: stats.user_messages,
        assistantMessages: stats.assistant_messages,
        firstMessageAt: stats.first_message_at,
        lastMessageAt: stats.last_message_at
      };
    }),

  // Get conversations with feedback for analytics
  getConversationWithFeedback: tenantProcedure("ai:run")
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(20)
      })
    )
    .query(async ({ ctx, input }) => {
      return ctx.repositories.conversations.list_own_raw_material_messages_with_feedback(
        ctx.tenant_context,
        input.limit,
      );
    }),
});
