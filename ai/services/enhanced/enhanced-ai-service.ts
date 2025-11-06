/**
 * Enhanced AI Response System with Structured Outputs
 * Implements advanced response optimization with structured data, caching, and ML-based personalization
 */

import { z } from 'zod';
import { BaseAIService } from '../core/base-ai-service';
import { AIRequest, AIResponse, AIModelConfig } from '../../types/ai-types';
import { FeedbackAnalyzer } from '../core/feedback-analyzer';

// Structured response schemas
export const StructuredResponseSchema = z.object({
  answer: z.string().describe('The main answer to the user query'),
  confidence: z.number().min(0).max(1).describe('Confidence score of the response'),
  sources: z.array(z.string()).optional().describe('Source references'),
  relatedTopics: z.array(z.string()).optional().describe('Related topics for further exploration'),
  followUpQuestions: z.array(z.string()).optional().describe('Suggested follow-up questions'),
  metadata: z.object({
    category: z.string().optional(),
    complexity: z.enum(['basic', 'intermediate', 'advanced']),
    language: z.string(),
    expertiseLevel: z.enum(['beginner', 'intermediate', 'expert']),
    responseTime: z.number().optional(),
    modelUsed: z.string(),
  }),
});

export type StructuredResponse = z.infer<typeof StructuredResponseSchema>;

// User preference learning schema
export const UserPreferencesSchema = z.object({
  userId: z.string(),
  preferredLength: z.enum(['concise', 'medium', 'detailed']),
  preferredStyle: z.enum(['formal', 'casual', 'technical']),
  preferredComplexity: z.enum(['basic', 'intermediate', 'advanced']),
  expertiseLevel: z.enum(['beginner', 'intermediate', 'expert']),
  language: z.string(),
  interests: z.array(z.string()).optional(),
  feedbackHistory: z.array(z.object({
    type: z.enum(['helpful', 'not_helpful', 'too_long', 'too_short', 'unclear', 'inaccurate']),
    score: z.number().min(1).max(5),
    timestamp: z.date(),
    topic: z.string(),
  })).optional(),
});

export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

/**
 * Enhanced AI Service with structured outputs and optimization
 */
export class EnhancedAIService extends BaseAIService {
  private responseCache = new Map<string, StructuredResponse>();
  private userPreferences = new Map<string, UserPreferences>();
  private performanceMetrics = {
    totalRequests: 0,
    averageResponseTime: 0,
    cacheHitRate: 0,
    userSatisfactionScore: 0,
  };

  constructor(apiKey: string, config?: Partial<AIModelConfig>, serviceName?: string) {
    const defaultConfig: AIModelConfig = {
      model: 'gpt-4',
      temperature: 0.6,
      maxTokens: 1000,
      presencePenalty: 0.1,
      frequencyPenalty: 0.1,
      ...config
    };

    super(apiKey, defaultConfig, serviceName);
    console.log('🚀 [EnhancedAIService] Initialized with structured outputs and optimization');
  }

  /**
   * Generate enhanced AI response with structured output
   */
  async generateEnhancedResponse(request: AIRequest): Promise<AIResponse & { structuredData: StructuredResponse }> {
    const startTime = Date.now();
    this.performanceMetrics.totalRequests++;

    try {
      // Check cache first
      const cacheKey = this.generateCacheKey(request);
      const cachedResponse = this.responseCache.get(cacheKey);

      if (cachedResponse) {
        this.performanceMetrics.cacheHitRate = (this.performanceMetrics.cacheHitRate * (this.performanceMetrics.totalRequests - 1) + 1) / this.performanceMetrics.totalRequests;
        console.log('📋 [EnhancedAIService] Cache hit for query:', request.prompt.substring(0, 50));

        return {
          response: cachedResponse.answer,
          confidence: cachedResponse.confidence,
          sources: cachedResponse.sources,
          metadata: {
            model: this.defaultConfig.model,
            responseTime: Date.now() - startTime,
            category: cachedResponse.metadata.category,
            language: cachedResponse.metadata.language,
            feedback: false,
          },
          structuredData: cachedResponse,
        };
      }

      // Get user preferences
      const userPreferences = await this.getUserPreferences(request.userId);

      // Build enhanced prompt
      const enhancedPrompt = this.buildEnhancedPrompt(request, userPreferences);

      // Generate base response
      const baseResponse = await this.generateResponse({
        ...request,
        prompt: enhancedPrompt,
      });

      // Process and structure the response
      const structuredResponse = await this.structureResponse(baseResponse, request, userPreferences);

      // Cache the response
      this.responseCache.set(cacheKey, structuredResponse);

      // Update performance metrics
      const responseTime = Date.now() - startTime;
      this.updatePerformanceMetrics(responseTime);

      return {
        response: structuredResponse.answer,
        confidence: structuredResponse.confidence,
        sources: structuredResponse.sources,
        metadata: {
          model: this.defaultConfig.model,
          responseTime,
          category: structuredResponse.metadata.category,
          language: structuredResponse.metadata.language,
          feedback: true,
        },
        structuredData: structuredResponse,
      };

    } catch (error) {
      console.error('❌ [EnhancedAIService] Error generating enhanced response:', error);
      throw error;
    }
  }

  /**
   * Build enhanced prompt with context and user preferences
   */
  private buildEnhancedPrompt(request: AIRequest, userPreferences: UserPreferences): string {
    const contextAwareness = `
CONTEXT AWARENESS:
- User Expertise: ${userPreferences.expertiseLevel}
- Preferred Style: ${userPreferences.preferredStyle}
- Preferred Length: ${userPreferences.preferredLength}
- Language: ${userPreferences.language}
- Previous Feedback: ${userPreferences.feedbackHistory?.length || 0} interactions

RESPONSE GUIDELINES:
1. Provide ${userPreferences.preferredLength} responses
2. Use ${userPreferences.preferredStyle} tone
3. Target ${userPreferences.expertiseLevel} complexity level
4. Include sources and related topics when relevant
5. Suggest follow-up questions for continued learning
6. Respond in ${userPreferences.language} unless otherwise requested
    `;

    const structuredOutputGuidelines = `
STRUCTURED OUTPUT REQUIREMENTS:
- Start with a clear, direct answer
- Include confidence level (0-1) based on your certainty
- List sources if available
- Suggest related topics for further exploration
- Provide 2-3 follow-up questions
- Keep response well-structured with clear sections
    `;

    return `${request.prompt}

${contextAwareness}

${structuredOutputGuidelines}

Please provide a comprehensive, structured response that follows these guidelines.`;
  }

  /**
   * Structure and validate the AI response
   */
  private async structureResponse(
    baseResponse: AIResponse,
    request: AIRequest,
    userPreferences: UserPreferences
  ): Promise<StructuredResponse> {
    // Parse and enhance the response
    const answer = baseResponse.response;

    // Extract sources (if mentioned in response)
    const sources = this.extractSources(answer);

    // Generate related topics based on content analysis
    const relatedTopics = this.generateRelatedTopics(answer, request.prompt);

    // Create follow-up questions
    const followUpQuestions = this.generateFollowUpQuestions(answer, userPreferences);

    // Determine response category and complexity
    const category = this.categorizeResponse(request.prompt);
    const complexity = this.assessComplexity(answer, userPreferences.expertiseLevel);

    const structuredResponse: StructuredResponse = {
      answer,
      confidence: baseResponse.confidence || 0.8,
      sources,
      relatedTopics,
      followUpQuestions,
      metadata: {
        category,
        complexity,
        language: userPreferences.language,
        expertiseLevel: userPreferences.expertiseLevel,
        responseTime: baseResponse.metadata?.responseTime || 0,
        modelUsed: this.defaultConfig.model,
      },
    };

    // Validate with schema
    return StructuredResponseSchema.parse(structuredResponse);
  }

  /**
   * Extract sources from response text
   */
  private extractSources(text: string): string[] {
    const sourcePatterns = [
      /(?:source|reference|according to|based on):\s*([^,\n.]+)/gi,
      /\[([^\]]+)\]/g,
      /"(https?:\/\/[^"]+)"/g,
    ];

    const sources: string[] = [];
    sourcePatterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) {
        sources.push(...matches.map(match => match.replace(/^(?:source|reference|according to|based on):\s*/i, '').trim()));
      }
    });

    return [...new Set(sources)]; // Remove duplicates
  }

  /**
   * Generate related topics based on content
   */
  private generateRelatedTopics(answer: string, query: string): string[] {
    const keywords = this.extractKeywords(answer);
    const queryKeywords = this.extractKeywords(query);

    // Combine and filter keywords
    const allKeywords = [...new Set([...keywords, ...queryKeywords])];

    // Generate related topics (simplified - could be enhanced with NLP)
    return allKeywords.slice(0, 5).map(keyword => `${keyword} in R&D`);
  }

  /**
   * Generate follow-up questions based on response and user preferences
   */
  private generateFollowUpQuestions(answer: string, userPreferences: UserPreferences): string[] {
    const complexityMap = {
      beginner: [
        "Can you explain this in simpler terms?",
        "What's the most important thing to remember?",
        "How does this apply to everyday situations?",
      ],
      intermediate: [
        "Can you provide more technical details?",
        "What are the limitations of this approach?",
        "How does this compare to alternative methods?",
      ],
      expert: [
        "What are the current research gaps in this area?",
        "How might this evolve in the next 5 years?",
        "What are the cutting-edge developments in this field?",
      ],
    };

    return complexityMap[userPreferences.expertiseLevel].slice(0, 3);
  }

  /**
   * Extract keywords from text (simplified implementation)
   */
  private extractKeywords(text: string): string[] {
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 3);

    const stopWords = ['this', 'that', 'with', 'from', 'they', 'have', 'been', 'said', 'each', 'which', 'their', 'time', 'will'];

    return [...new Set(words.filter(word => !stopWords.includes(word)))].slice(0, 10);
  }

  /**
   * Categorize response based on query content
   */
  private categorizeResponse(query: string): string {
    const categories = {
      'ingredients': ['ingredient', 'material', 'compound', 'substance'],
      'formulations': ['formula', 'formulation', 'recipe', 'mixture'],
      'regulations': ['regulation', 'compliance', 'safety', 'approval'],
      'research': ['research', 'study', 'clinical', 'trial'],
      'applications': ['application', 'use', 'benefit', 'effect'],
    };

    const queryLower = query.toLowerCase();
    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(keyword => queryLower.includes(keyword))) {
        return category;
      }
    }

    return 'general';
  }

  /**
   * Assess response complexity
   */
  private assessComplexity(answer: string, userLevel: string): 'basic' | 'intermediate' | 'advanced' {
    const technicalTerms = ['mechanism', 'synthesis', 'molecular', 'chemical', 'biological'];
    const sentenceCount = answer.split(/[.!?]+/).length;
    const avgSentenceLength = answer.length / sentenceCount;

    const technicalScore = technicalTerms.filter(term =>
      answer.toLowerCase().includes(term)
    ).length;

    const complexityScore = (technicalScore * 0.6) + (avgSentenceLength / 20 * 0.4);

    if (complexityScore < 1) return 'basic';
    if (complexityScore < 2.5) return 'intermediate';
    return 'advanced';
  }

  /**
   * Generate cache key for request
   */
  private generateCacheKey(request: AIRequest): string {
    const keyData = {
      prompt: request.prompt.substring(0, 200), // Truncate long prompts
      userId: request.userId,
      context: request.context ? JSON.stringify(request.context).substring(0, 100) : undefined,
    };

    return btoa(JSON.stringify(keyData)).replace(/[^a-zA-Z0-9]/g, '');
  }

  /**
   * Get or create user preferences
   */
  private async getUserPreferences(userId: string): Promise<UserPreferences> {
    if (this.userPreferences.has(userId)) {
      return this.userPreferences.get(userId)!;
    }

    // Create default preferences
    const defaultPreferences: UserPreferences = {
      userId,
      preferredLength: 'medium',
      preferredStyle: 'casual',
      preferredComplexity: 'intermediate',
      expertiseLevel: 'intermediate',
      language: 'en',
      interests: [],
      feedbackHistory: [],
    };

    this.userPreferences.set(userId, defaultPreferences);
    return defaultPreferences;
  }

  /**
   * Update user preferences based on feedback
   */
  async updateUserPreferences(
    userId: string,
    feedback: { type: string; score: number; topic: string }
  ): Promise<void> {
    const preferences = await this.getUserPreferences(userId);

    const feedbackEntry = {
      type: feedback.type as any,
      score: feedback.score,
      timestamp: new Date(),
      topic: feedback.topic,
    };

    preferences.feedbackHistory = [...(preferences.feedbackHistory || []), feedbackEntry];

    // Adjust preferences based on feedback
    this.adjustPreferencesFromFeedback(preferences, feedback);

    this.userPreferences.set(userId, preferences);
    console.log(`📈 [EnhancedAIService] Updated preferences for user ${userId}`);
  }

  /**
   * Adjust preferences based on feedback patterns
   */
  private adjustPreferencesFromFeedback(preferences: UserPreferences, feedback: any): void {
    // Simple preference adjustment logic
    if (feedback.type === 'too_long' && preferences.preferredLength !== 'concise') {
      preferences.preferredLength = preferences.preferredLength === 'detailed' ? 'medium' : 'concise';
    } else if (feedback.type === 'too_short' && preferences.preferredLength !== 'detailed') {
      preferences.preferredLength = preferences.preferredLength === 'concise' ? 'medium' : 'detailed';
    }

    if (feedback.type === 'unclear') {
      preferences.complexity = preferences.complexity === 'advanced' ? 'intermediate' : 'basic';
    } else if (feedback.score >= 4 && feedback.type === 'helpful') {
      // Positive feedback - could increase complexity
      if (preferences.complexity === 'basic') preferences.complexity = 'intermediate';
      else if (preferences.complexity === 'intermediate') preferences.complexity = 'advanced';
    }
  }

  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(responseTime: number): void {
    const prevAvg = this.performanceMetrics.averageResponseTime;
    const total = this.performanceMetrics.totalRequests;

    this.performanceMetrics.averageResponseTime = (prevAvg * (total - 1) + responseTime) / total;
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics() {
    return { ...this.performanceMetrics };
  }

  /**
   * Clear cache and reset metrics
   */
  clearCache(): void {
    this.responseCache.clear();
    this.performanceMetrics = {
      totalRequests: 0,
      averageResponseTime: 0,
      cacheHitRate: 0,
      userSatisfactionScore: 0,
    };
    console.log('🧹 [EnhancedAIService] Cache cleared and metrics reset');
  }
}