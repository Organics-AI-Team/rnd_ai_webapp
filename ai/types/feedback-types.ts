import { z } from 'zod';

export const FeedbackType = z.enum([
  'too_long',
  'too_short',
  'not_related',
  'helpful',
  'not_helpful',
  'unclear',
  'inaccurate',
  'excellent'
]);

export const FeedbackSchema = z.object({
  id: z.string().optional(),
  responseId: z.string(),
  userId: z.string(),
  service_name: z.string().optional(), // which AI service/agent (e.g., "salesRndAI", "rawMaterialsAI")
  type: FeedbackType,
  score: z.number().min(1).max(5), // 1-5 rating
  comment: z.string().optional(),
  aiModel: z.string(), // which AI model generated the response
  prompt: z.string(), // original user prompt
  aiResponse: z.string(), // AI's response
  context: z.object({
    length: z.number(),
    complexity: z.enum(['simple', 'moderate', 'complex']),
    category: z.string().optional()
  }).optional(),
  timestamp: z.date(),
  helpful: z.boolean().optional(),
  processed: z.boolean().default(false) // whether feedback has been processed for learning
});

export type Feedback = z.infer<typeof FeedbackSchema>;

export const StoredAIResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  service_name: z.string().optional(), // which AI service/agent generated this response
  prompt: z.string(),
  response: z.string(),
  model: z.string(),
  temperature: z.number(),
  maxTokens: z.number(),
  timestamp: z.date(),
  feedback: z.array(FeedbackSchema).optional(),
  averageScore: z.number().optional(),
  totalFeedback: z.number().default(0)
});

export type StoredAIResponse = z.infer<typeof StoredAIResponseSchema>;