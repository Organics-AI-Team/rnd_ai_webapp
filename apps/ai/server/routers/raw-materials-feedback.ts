import { z } from "zod";
import { router, tenantProcedure, throw_from_repository_error } from "../trpc";

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
  submit: tenantProcedure("ai:feedback:create")
    .input(FeedbackSchema)
    .mutation(async ({ ctx, input }) => {
      console.log('[rawMaterialsFeedback] submit — start', {
        tenantId: ctx.tenant_context.tenant_id,
        actorProfileId: ctx.tenant_context.actor_profile_id,
        type: input.type,
        score: input.score,
      });

      try {
        const created = await ctx.repositories.feedback.create_raw_material_feedback(
          ctx.tenant_context,
          input,
        );

        console.log('[rawMaterialsFeedback] submit — done', {
          feedbackId: created._id.toString(),
        });
        return { success: true, feedbackId: created._id.toString() };
      } catch (error) {
        throw_from_repository_error(error);
      }
    }),

  // Get feedback statistics for the acting profile
  getStats: tenantProcedure("tenant:analytics:read")
    .query(async ({ ctx }) => {
      const stats = await ctx.repositories.feedback.get_own_raw_material_feedback_stats(
        ctx.tenant_context,
      );

      return {
        totalFeedback: stats.total_feedback,
        averageScore: stats.average_score,
        feedbackByType: stats.feedback_by_type,
      };
    }),

  // Get recent feedback for the acting profile
  getRecent: tenantProcedure("ai:run")
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      const feedback = await ctx.repositories.feedback.list_own_recent_raw_material_feedback(
        ctx.tenant_context,
        input.limit,
      );

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
