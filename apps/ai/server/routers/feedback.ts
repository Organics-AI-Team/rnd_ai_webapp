import { z } from "zod";
import { router, tenantProcedure, throw_from_repository_error } from "../trpc";

export const feedbackRouter = router({
  // Submit feedback for an AI response
  submit: tenantProcedure("ai:feedback:create")
    .input(
      z.object({
        responseId: z.string(),
        service_name: z.string().optional(), // AI service/agent name for isolated learning
        type: z.enum([
          'too_long',
          'too_short',
          'not_related',
          'helpful',
          'not_helpful',
          'unclear',
          'inaccurate',
          'excellent'
        ]),
        score: z.number().min(1).max(5),
        comment: z.string().optional(),
        prompt: z.string(),
        aiResponse: z.string(),
        aiModel: z.string()
      })
    )
    .mutation(async ({ ctx, input }) => {
      console.log('📝 [feedback.submit] Submitting feedback:', {
        tenantId: ctx.tenant_context.tenant_id,
        actorProfileId: ctx.tenant_context.actor_profile_id,
        serviceName: input.service_name,
        type: input.type,
        score: input.score
      });

      try {
        const created = await ctx.repositories.feedback.create_feedback(
          ctx.tenant_context,
          {
            ...input,
            timestamp: new Date(),
            processed: false,
            context: {
              length: input.aiResponse.length,
              complexity: assess_complexity(input.aiResponse),
              category: infer_category(input.prompt)
            }
          },
        );

        // Fold the feedback into the tenant's per-response rollup and log
        // the analytics event (both tenant-scoped inside the repository).
        await ctx.repositories.feedback.record_response_feedback(
          ctx.tenant_context,
          input.responseId,
          created,
        );
        await ctx.repositories.feedback.record_feedback_event(ctx.tenant_context, {
          type: 'feedback_submitted',
          responseId: input.responseId,
          feedbackType: input.type,
          score: input.score,
          timestamp: new Date(),
          model: input.aiModel
        });

        console.log('📝 [feedback.submit] Done:', {
          feedbackId: created._id.toString(),
        });
        return { success: true, feedbackId: created._id.toString() };
      } catch (error) {
        throw_from_repository_error(error);
      }
    }),

  // Get feedback analytics for the tenant
  getAnalytics: tenantProcedure("tenant:analytics:read")
    .input(
      z.object({
        timeRange: z.enum(['24h', '7d', '30d', '90d', 'all']).default('30d'),
        model: z.string().optional()
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const timeRange = input?.timeRange || '30d';
      const model = input?.model;

      console.log('📊 [feedback.getAnalytics] — start', {
        tenantId: ctx.tenant_context.tenant_id,
        timeRange,
        model,
      });

      const analytics = await ctx.repositories.feedback.get_feedback_analytics(
        ctx.tenant_context,
        { start_date: start_date_for_range(timeRange), model },
      );

      const totalFeedback = analytics.total_feedback;
      const averageScore = analytics.average_score;

      const feedbackTypeData = analytics.feedback_by_type.map(item => ({
        type: item._id,
        count: item.count,
        percentage: (item.count / totalFeedback) * 100
      }));

      // Generate improvement suggestions
      const improvements = generate_improvements(
        feedbackTypeData,
        averageScore,
        analytics.response_length_analysis,
      );

      console.log('📊 [feedback.getAnalytics] — done', { totalFeedback });

      return {
        totalFeedback,
        averageScore,
        feedbackByType: feedbackTypeData,
        scoreTrend: analytics.score_trend,
        userEngagement: analytics.user_engagement,
        modelPerformance: analytics.model_performance,
        responseLengthAnalysis: analytics.response_length_analysis,
        improvements
      };
    }),

  // Get feedback for a specific response (tenant-scoped)
  getForResponse: tenantProcedure("ai:run")
    .input(z.object({ responseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const feedback = await ctx.repositories.feedback.list_feedback_for_response(
        ctx.tenant_context,
        input.responseId,
      );

      return feedback.map(item => ({
        ...item,
        _id: item._id.toString()
      }));
    }),

  // Get the acting profile's own feedback history (optionally filtered by
  // serviceName for isolated learning)
  getUserHistory: tenantProcedure("ai:run")
    .input(
      z.object({
        serviceName: z.string().optional(), // Filter by service for isolated learning
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0)
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      console.log('📥 [feedback.getUserHistory] Fetching feedback:', {
        tenantId: ctx.tenant_context.tenant_id,
        actorProfileId: ctx.tenant_context.actor_profile_id,
        serviceName: input?.serviceName
      });

      const feedback = await ctx.repositories.feedback.list_own_feedback(
        ctx.tenant_context,
        {
          service_name: input?.serviceName,
          limit: input?.limit || 20,
          offset: input?.offset || 0,
        },
      );

      console.log('✅ [feedback.getUserHistory] Found feedback:', {
        count: feedback.length,
        serviceName: input?.serviceName
      });

      return feedback.map(item => ({
        ...item,
        _id: item._id.toString()
      }));
    })
});

// Helper functions

/**
 * Resolve the inclusive start date of an analytics time range.
 *
 * @param time_range - One of "24h" | "7d" | "30d" | "90d" | "all".
 * @returns Start date; epoch zero when the range is "all".
 */
function start_date_for_range(time_range: '24h' | '7d' | '30d' | '90d' | 'all'): Date {
  const now = Date.now();
  switch (time_range) {
    case '24h':
      return new Date(now - 24 * 60 * 60 * 1000);
    case '7d':
      return new Date(now - 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now - 30 * 24 * 60 * 60 * 1000);
    case '90d':
      return new Date(now - 90 * 24 * 60 * 60 * 1000);
    default:
      return new Date(0); // Beginning of time
  }
}

/**
 * Heuristically classify how complex an AI response reads.
 *
 * @param text - The AI response text.
 * @returns "simple" | "moderate" | "complex".
 */
function assess_complexity(text: string): 'simple' | 'moderate' | 'complex' {
  const avgSentenceLength = text.split('.').reduce((sum, sentence) =>
    sum + sentence.split(' ').length, 0) / text.split('.').length;

  const technicalTerms = /algorithm|function|parameter|methodology|implementation|architecture/gi;
  const technicalDensity = (text.match(technicalTerms) || []).length / text.split(' ').length;

  if (avgSentenceLength > 20 || technicalDensity > 0.05) {
    return 'complex';
  } else if (avgSentenceLength > 15 || technicalDensity > 0.02) {
    return 'moderate';
  }
  return 'simple';
}

/**
 * Infer the coarse request category from the user prompt.
 *
 * @param prompt - The user's original prompt.
 * @returns Category label, "general" when nothing matches.
 */
function infer_category(prompt: string): string {
  const lowerPrompt = prompt.toLowerCase();

  if (lowerPrompt.includes('how to') || lowerPrompt.includes('explain')) return 'explanation';
  if (lowerPrompt.includes('what is') || lowerPrompt.includes('define')) return 'definition';
  if (lowerPrompt.includes('why') || lowerPrompt.includes('reason')) return 'analysis';
  if (lowerPrompt.includes('create') || lowerPrompt.includes('write')) return 'creation';
  if (lowerPrompt.includes('fix') || lowerPrompt.includes('solve')) return 'problem-solving';

  return 'general';
}

/**
 * Derive prioritized improvement suggestions from analytics datasets.
 *
 * @param feedbackByType - Feedback type distribution with percentages.
 * @param averageScore - Overall average feedback score.
 * @param lengthAnalysis - Response-length bucket analysis.
 * @returns Improvement suggestions sorted by priority.
 */
function generate_improvements(
  feedbackByType: any[],
  averageScore: number,
  lengthAnalysis: any[]
) {
  const improvements = [];

  // Analyze feedback types for improvements
  const tooLong = feedbackByType.find(f => f.type === 'too_long');
  const tooShort = feedbackByType.find(f => f.type === 'too_short');
  const unclear = feedbackByType.find(f => f.type === 'unclear');
  const inaccurate = feedbackByType.find(f => f.type === 'inaccurate');

  if (tooLong && tooLong.count > feedbackByType.reduce((sum, f) => sum + f.count, 0) * 0.2) {
    improvements.push({
      area: 'Response Length',
      suggestion: 'Consider generating more concise responses. Users frequently indicate responses are too long.',
      priority: 'high',
      impact: Math.min(25, tooLong.percentage)
    });
  }

  if (tooShort && tooShort.count > feedbackByType.reduce((sum, f) => sum + f.count, 0) * 0.15) {
    improvements.push({
      area: 'Response Detail',
      suggestion: 'Provide more detailed and comprehensive responses to better address user needs.',
      priority: 'medium',
      impact: Math.min(20, tooShort.percentage)
    });
  }

  if (unclear && unclear.count > feedbackByType.reduce((sum, f) => sum + f.count, 0) * 0.25) {
    improvements.push({
      area: 'Response Clarity',
      suggestion: 'Focus on making responses clearer and more structured. Use simpler language and better organization.',
      priority: 'high',
      impact: Math.min(30, unclear.percentage)
    });
  }

  if (inaccurate && inaccurate.count > 0) {
    improvements.push({
      area: 'Response Accuracy',
      suggestion: 'Improve fact-checking and verification processes to ensure information accuracy.',
      priority: 'high',
      impact: Math.min(40, inaccurate.percentage * 2)
    });
  }

  if (averageScore < 3.5) {
    improvements.push({
      area: 'Overall Quality',
      suggestion: 'Overall satisfaction is below target. Review response generation parameters and consider model tuning.',
      priority: 'high',
      impact: Math.min(35, (3.5 - averageScore) * 20)
    });
  }

  // Length-based improvements
  const longResponses = lengthAnalysis.find(l => l.category === 'Very Long');
  if (longResponses && longResponses.averageScore < 3.5) {
    improvements.push({
      area: 'Long Response Optimization',
      suggestion: 'Very long responses are receiving low scores. Consider breaking down complex topics into shorter, more digestible parts.',
      priority: 'medium',
      impact: 20
    });
  }

  return improvements.sort((a, b) => {
    const priorityOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
    return priorityOrder[b.priority] - priorityOrder[a.priority];
  });
}
