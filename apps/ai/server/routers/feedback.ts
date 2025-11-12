import { z } from "zod";
import { router, protectedProcedure, publicProcedure } from "../trpc";
import client_promise from "@rnd-ai/shared-database";
import { FeedbackSchema, StoredAIResponseSchema } from "@/ai/types/feedback-types";
import { ObjectId } from "mongodb";

export const feedbackRouter = router({
  // Submit feedback for an AI response
  submit: protectedProcedure
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
      const client = await client_promise;
      const db = client.db();

      console.log('📝 [feedback.submit] Submitting feedback:', {
        userId: ctx.user.id,
        serviceName: input.service_name,
        type: input.type,
        score: input.score
      });

      const feedback = {
        ...input,
        userId: ctx.user.id,
        timestamp: new Date(),
        processed: false,
        context: {
          length: input.aiResponse.length,
          complexity: assessComplexity(input.aiResponse),
          category: inferCategory(input.prompt)
        }
      };

      // Insert feedback
      const result = await db.collection("feedback").insertOne(feedback);

      // Update AI response with feedback
      await db.collection("ai_responses").updateOne(
        { id: input.responseId },
        {
          $push: { feedback: { ...feedback, _id: result.insertedId } } as any,
          $inc: { totalFeedback: 1 },
          $set: {
            lastFeedbackAt: new Date(),
            averageScore: await calculateAverageScore(db, input.responseId)
          }
        },
        { upsert: true }
      );

      // Log the feedback for analytics
      await db.collection("feedback_analytics").insertOne({
        type: 'feedback_submitted',
        responseId: input.responseId,
        userId: ctx.user.id,
        feedbackType: input.type,
        score: input.score,
        timestamp: new Date(),
        model: input.aiModel
      });

      return { success: true, feedbackId: result.insertedId.toString() };
    }),

  // Get feedback analytics
  getAnalytics: protectedProcedure
    .input(
      z.object({
        timeRange: z.enum(['24h', '7d', '30d', '90d', 'all']).default('30d'),
        model: z.string().optional()
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const client = await client_promise;
      const db = client.db();

      const timeRange = input?.timeRange || '30d';
      const model = input?.model;

      // Calculate date range
      const now = new Date();
      let startDate: Date;

      switch (timeRange) {
        case '24h':
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case '7d':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case '90d':
          startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(0); // Beginning of time
      }

      // Build filter
      const filter: any = {
        timestamp: { $gte: startDate }
      };

      if (model) {
        filter.aiModel = model;
      }

      // Get total feedback and average score
      const totalFeedback = await db.collection("feedback").countDocuments(filter);

      const scoreAggregation = await db.collection("feedback")
        .aggregate([
          { $match: filter },
          {
            $group: {
              _id: null,
              averageScore: { $avg: "$score" },
              totalScore: { $sum: "$score" }
            }
          }
        ])
        .toArray();

      const averageScore = scoreAggregation[0]?.averageScore || 0;

      // Get feedback by type
      const feedbackByType = await db.collection("feedback")
        .aggregate([
          { $match: filter },
          {
            $group: {
              _id: "$type",
              count: { $sum: 1 }
            }
          },
          { $sort: { count: -1 } }
        ])
        .toArray();

      const feedbackTypeData = feedbackByType.map(item => ({
        type: item._id,
        count: item.count,
        percentage: (item.count / totalFeedback) * 100
      }));

      // Get score trend over time
      const scoreTrend = await db.collection("feedback")
        .aggregate([
          { $match: filter },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: "$timestamp"
                }
              },
              averageScore: { $avg: "$score" },
              count: { $sum: 1 }
            }
          },
          { $sort: { "_id": 1 } },
          {
            $project: {
              date: "$_id",
              score: { $round: ["$averageScore", 2] },
              count: 1,
              _id: 0
            }
          }
        ])
        .toArray();

      // Get user engagement
      const userEngagement = await db.collection("feedback")
        .aggregate([
          { $match: filter },
          {
            $group: {
              _id: "$userId",
              feedbackCount: { $sum: 1 },
              averageScore: { $avg: "$score" }
            }
          },
          { $sort: { feedbackCount: -1 } },
          {
            $project: {
              userId: "$_id",
              feedbackCount: 1,
              averageScore: { $round: ["$averageScore", 2] },
              _id: 0
            }
          }
        ])
        .toArray();

      // Get model performance
      const modelPerformance = await db.collection("feedback")
        .aggregate([
          { $match: filter },
          {
            $group: {
              _id: "$aiModel",
              averageScore: { $avg: "$score" },
              totalResponses: { $addToSet: "$responseId" }
            }
          },
          {
            $project: {
              model: "$_id",
              averageScore: { $round: ["$averageScore", 2] },
              totalResponses: { $size: "$totalResponses" },
              _id: 0
            }
          }
        ])
        .toArray();

      // Get response length analysis
      const responseLengthAnalysis = await db.collection("feedback")
        .aggregate([
          { $match: filter },
          {
            $bucket: {
              groupBy: {
                $cond: {
                  if: { $lt: ["$context.length", 100] },
                  then: "Very Short",
                  else: {
                    $cond: {
                      if: { $lt: ["$context.length", 300] },
                      then: "Short",
                      else: {
                        $cond: {
                          if: { $lt: ["$context.length", 600] },
                          then: "Medium",
                          else: {
                            $cond: {
                              if: { $lt: ["$context.length", 1000] },
                              then: "Long",
                              else: "Very Long"
                            }
                          }
                        }
                      }
                    }
                  }
                },
                boundaries: [0, 100, 300, 600, 1000, Infinity],
                output: {
                  averageLength: { $avg: "$context.length" },
                  averageScore: { $avg: "$score" },
                  count: { $sum: 1 }
                }
              }
            }
          },
          {
            $project: {
              category: "$_id",
              averageLength: { $round: ["$averageLength", 0] },
              averageScore: { $round: ["$averageScore", 2] },
              _id: 0
            }
          }
        ])
        .toArray();

      // Generate improvement suggestions
      const improvements = generateImprovements(feedbackTypeData, averageScore, responseLengthAnalysis);

      return {
        totalFeedback,
        averageScore,
        feedbackByType: feedbackTypeData,
        scoreTrend,
        userEngagement,
        modelPerformance,
        responseLengthAnalysis,
        improvements
      };
    }),

  // Get feedback for a specific response
  getForResponse: protectedProcedure
    .input(z.object({ responseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const client = await client_promise;
      const db = client.db();

      const feedback = await db.collection("feedback")
        .find({ responseId: input.responseId })
        .sort({ timestamp: -1 })
        .toArray();

      return feedback.map(item => ({
        ...item,
        _id: item._id.toString()
      }));
    }),

  // Get user's feedback history (optionally filtered by serviceName for isolated learning)
  getUserHistory: protectedProcedure
    .input(
      z.object({
        userId: z.string().optional(),
        serviceName: z.string().optional(), // Filter by service for isolated learning
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0)
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const client = await client_promise;
      const db = client.db();

      // Build filter - use userId from input or context
      const filter: any = {
        userId: input?.userId || ctx.user.id
      };

      // Filter by serviceName if provided (for isolated learning per AI service)
      if (input?.serviceName) {
        filter.service_name = input.serviceName;
        console.log('📂 [feedback.getUserHistory] Filtering by serviceName:', input.serviceName);
      }

      console.log('📥 [feedback.getUserHistory] Fetching feedback:', filter);

      const feedback = await db.collection("feedback")
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(input?.offset || 0)
        .limit(input?.limit || 20)
        .toArray();

      console.log('✅ [feedback.getUserHistory] Found feedback:', {
        count: feedback.length,
        userId: filter.userId,
        serviceName: input?.serviceName
      });

      return feedback.map(item => ({
        ...item,
        _id: item._id.toString()
      }));
    })
});

// Helper functions
function assessComplexity(text: string): 'simple' | 'moderate' | 'complex' {
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

function inferCategory(prompt: string): string {
  const lowerPrompt = prompt.toLowerCase();

  if (lowerPrompt.includes('how to') || lowerPrompt.includes('explain')) return 'explanation';
  if (lowerPrompt.includes('what is') || lowerPrompt.includes('define')) return 'definition';
  if (lowerPrompt.includes('why') || lowerPrompt.includes('reason')) return 'analysis';
  if (lowerPrompt.includes('create') || lowerPrompt.includes('write')) return 'creation';
  if (lowerPrompt.includes('fix') || lowerPrompt.includes('solve')) return 'problem-solving';

  return 'general';
}

async function calculateAverageScore(db: any, responseId: string): Promise<number> {
  const result = await db.collection("feedback")
    .aggregate([
      { $match: { responseId } },
      {
        $group: {
          _id: null,
          averageScore: { $avg: "$score" }
        }
      }
    ])
    .toArray();

  return result[0]?.averageScore || 0;
}

function generateImprovements(
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