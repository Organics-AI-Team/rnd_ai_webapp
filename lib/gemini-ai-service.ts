import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnablePassthrough, RunnableSequence } from "@langchain/core/runnables";
import { Feedback } from "./feedback-types";

interface AIRequest {
  prompt: string;
  userId: string;
  context?: {
    previousResponses?: string[];
    userPreferences?: UserPreferences;
    category?: string;
    conversationHistory?: Array<{ role: string; content: string }>;
  };
}

interface UserPreferences {
  preferredLength: 'short' | 'medium' | 'long';
  preferredStyle: 'formal' | 'casual' | 'technical';
  avoidTopics: string[];
  preferredComplexity: 'simple' | 'moderate' | 'complex';
  feedbackPatterns?: {
    averageScore: number;
    commonIssues: string[];
    preferredLength: string;
    preferredComplexity: string;
  };
}

interface AIResponse {
  id: string;
  response: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timestamp: Date;
  context: {
    length: number;
    complexity: 'simple' | 'moderate' | 'complex';
    category?: string;
    feedbackAdjusted: boolean;
  };
  metadata: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    latency: number;
  };
}

export class GeminiAIService {
  private model: ChatGoogleGenerativeAI;
  private feedbackHistory: Map<string, Feedback[]> = new Map();
  private userPreferences: Map<string, UserPreferences> = new Map();

  constructor(apiKey: string) {
    this.model = new ChatGoogleGenerativeAI({
      apiKey: apiKey,
      modelName: "gemini-2.5-flash",
      temperature: 0.7,
      maxOutputTokens: 500,
    });
  }

  async generateResponse(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();

    try {
      // Get user preferences and feedback patterns
      const userPreferences = await this.getUserPreferences(request.userId);
      const feedbackPatterns = this.analyzeFeedbackPatterns(request.userId);

      // Create the prompt chain based on feedback
      const chain = await this.createFeedbackAwareChain(userPreferences, feedbackPatterns);

      // Generate response
      const response = await chain.invoke({
        prompt: request.prompt,
        context: request.context,
        userPreferences,
        feedbackPatterns
      });

      const endTime = Date.now();
      const latency = endTime - startTime;

      // Assess response characteristics
      const complexity = this.assessComplexity(response);

      return {
        id: `response_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        response,
        model: "gemini-2.5-flash",
        temperature: this.getAdjustedTemperature(feedbackPatterns, userPreferences),
        maxTokens: this.getAdjustedMaxTokens(feedbackPatterns, userPreferences),
        timestamp: new Date(),
        context: {
          length: response.length,
          complexity,
          category: request.context?.category,
          feedbackAdjusted: feedbackPatterns.totalFeedback > 0
        },
        metadata: {
          promptTokens: this.estimateTokens(request.prompt),
          completionTokens: this.estimateTokens(response),
          totalTokens: this.estimateTokens(request.prompt) + this.estimateTokens(response),
          latency
        }
      };
    } catch (error) {
      console.error('Gemini AI Service Error:', error);
      throw new Error('Failed to generate AI response');
    }
  }

  private async createFeedbackAwareChain(
    userPreferences: UserPreferences,
    feedbackPatterns: any
  ): Promise<RunnableSequence<any, string>> {

    // System prompt that adapts based on feedback
    const systemPrompt = PromptTemplate.fromTemplate(`
      You are a helpful AI assistant that adapts to user feedback and preferences.

      User Preferences:
      - Preferred Length: {preferredLength}
      - Preferred Style: {preferredStyle}
      - Preferred Complexity: {preferredComplexity}

      {feedbackInstructions}

      Guidelines:
      1. Be clear, accurate, and helpful
      2. Adapt your response style based on user feedback
      3. Focus on providing value while respecting preferences
      4. If user has given feedback about length being too long/short, adjust accordingly
      5. If user finds responses unclear, use simpler language and better structure
      6. If feedback indicates inaccuracies, be extra careful with facts
    `);

    // Response prompt template
    const responsePrompt = PromptTemplate.fromTemplate(`
      User Question: {prompt}

      Additional Context: {context}

      Please provide a helpful response that follows the guidelines above.
    `);

    const outputParser = new StringOutputParser();

    const chain = RunnableSequence.from([
      {
        prompt: (input: any) => input.prompt,
        context: (input: any) => input.context || {},
        preferredLength: () => userPreferences.preferredLength,
        preferredStyle: () => userPreferences.preferredStyle,
        preferredComplexity: () => userPreferences.preferredComplexity,
        feedbackInstructions: () => this.generateFeedbackInstructions(feedbackPatterns, userPreferences)
      },
      systemPrompt,
      {
        systemMessage: (input: any) => input,
        prompt: (input: any) => input.prompt,
        context: (input: any) => input.context
      },
      responsePrompt,
      this.model,
      outputParser
    ]);

    return chain;
  }

  private generateFeedbackInstructions(feedbackPatterns: any, userPreferences: UserPreferences): string {
    let instructions = "";

    if (feedbackPatterns.totalFeedback > 0) {
      instructions += "Based on previous feedback:\n";

      // Length adjustments
      if (feedbackPatterns.commonIssues.includes('too_long')) {
        instructions += "- Keep responses concise and to the point\n";
      } else if (feedbackPatterns.commonIssues.includes('too_short')) {
        instructions += "- Provide more detailed and comprehensive responses\n";
      }

      // Clarity adjustments
      if (feedbackPatterns.commonIssues.includes('unclear')) {
        instructions += "- Use clear, simple language and well-structured responses\n";
      }

      // Accuracy focus
      if (feedbackPatterns.commonIssues.includes('inaccurate')) {
        instructions += "- Double-check facts and ensure information accuracy\n";
      }

      // Relevance focus
      if (feedbackPatterns.commonIssues.includes('not_related')) {
        instructions += "- Ensure responses directly address the user's question\n";
      }

      // If average score is low, emphasize quality
      if (feedbackPatterns.averageScore < 3.5) {
        instructions += "- Focus on providing high-quality, helpful responses\n";
      }
    }

    return instructions || "No specific feedback patterns to address.";
  }

  private getAdjustedTemperature(feedbackPatterns: any, userPreferences: UserPreferences): number {
    let baseTemp = 0.7;

    // Adjust based on feedback patterns
    if (feedbackPatterns.commonIssues.includes('unclear')) {
      baseTemp = Math.max(0.3, baseTemp - 0.2); // More predictable for clarity
    }

    if (feedbackPatterns.averageScore < 3) {
      baseTemp = Math.max(0.4, baseTemp - 0.1); // More conservative for struggling responses
    }

    // Adjust based on user preference
    if (userPreferences.preferredComplexity === 'simple') {
      baseTemp = Math.max(0.3, baseTemp - 0.1);
    } else if (userPreferences.preferredComplexity === 'complex') {
      baseTemp = Math.min(0.9, baseTemp + 0.1);
    }

    return baseTemp;
  }

  private getAdjustedMaxTokens(feedbackPatterns: any, userPreferences: UserPreferences): number {
    let baseTokens = 500;

    // Adjust based on feedback about length
    if (feedbackPatterns.commonIssues.includes('too_long')) {
      baseTokens = Math.max(200, baseTokens - 150);
    } else if (feedbackPatterns.commonIssues.includes('too_short')) {
      baseTokens = Math.min(1000, baseTokens + 200);
    }

    // Adjust based on user preference
    switch (userPreferences.preferredLength) {
      case 'short':
        return Math.min(300, baseTokens);
      case 'long':
        return Math.max(800, baseTokens);
      default:
        return baseTokens;
    }
  }

  private assessComplexity(text: string): 'simple' | 'moderate' | 'complex' {
    const sentences = text.split('.').filter(s => s.trim().length > 0);
    const avgSentenceLength = sentences.reduce((sum, sentence) =>
      sum + sentence.split(' ').length, 0) / sentences.length;

    const technicalTerms = /algorithm|function|parameter|methodology|implementation|architecture|system|process|analysis/gi;
    const technicalDensity = (text.match(technicalTerms) || []).length / text.split(' ').length;

    // Complex indicators
    const complexIndicators = [
      text.includes('however') || text.includes('although') || text.includes('therefore'),
      text.split(',').length > 3,
      avgSentenceLength > 20
    ].filter(Boolean).length;

    if (avgSentenceLength > 20 || technicalDensity > 0.05 || complexIndicators >= 2) {
      return 'complex';
    } else if (avgSentenceLength > 15 || technicalDensity > 0.02 || complexIndicators >= 1) {
      return 'moderate';
    }
    return 'simple';
  }

  private estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  private async getUserPreferences(userId: string): Promise<UserPreferences> {
    if (this.userPreferences.has(userId)) {
      return this.userPreferences.get(userId)!;
    }

    // In a real implementation, this would fetch from a database
    // For now, return default preferences
    const defaultPreferences: UserPreferences = {
      preferredLength: 'medium',
      preferredStyle: 'casual',
      avoidTopics: [],
      preferredComplexity: 'moderate'
    };

    this.userPreferences.set(userId, defaultPreferences);
    return defaultPreferences;
  }

  private analyzeFeedbackPatterns(userId: string) {
    const feedback = this.feedbackHistory.get(userId) || [];

    if (feedback.length === 0) {
      return {
        averageScore: 0,
        commonIssues: [],
        preferredLength: 'medium',
        preferredComplexity: 'moderate',
        totalFeedback: 0
      };
    }

    const recentFeedback = feedback.slice(-20); // Last 20 pieces of feedback
    const averageScore = recentFeedback.reduce((sum, f) => sum + f.score, 0) / recentFeedback.length;

    // Get most common issues
    const typeCounts = recentFeedback.reduce((acc, f) => {
      if (f.type !== 'helpful' && f.type !== 'excellent') {
        acc[f.type] = (acc[f.type] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    const commonIssues = Object.entries(typeCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([type]) => type);

    // Infer preferences from feedback
    const preferredLength = this.inferPreferredLength(recentFeedback);
    const preferredComplexity = this.inferPreferredComplexity(recentFeedback);

    return {
      averageScore,
      commonIssues,
      preferredLength,
      preferredComplexity,
      totalFeedback: feedback.length
    };
  }

  private inferPreferredLength(feedback: Feedback[]): 'short' | 'medium' | 'long' {
    const tooLong = feedback.filter(f => f.type === 'too_long').length;
    const tooShort = feedback.filter(f => f.type === 'too_short').length;

    if (tooLong > tooShort * 1.5) return 'short';
    if (tooShort > tooLong * 1.5) return 'long';
    return 'medium';
  }

  private inferPreferredComplexity(feedback: Feedback[]): 'simple' | 'moderate' | 'complex' {
    const unclear = feedback.filter(f => f.type === 'unclear').length;
    const excellent = feedback.filter(f => f.type === 'excellent').length;

    if (unclear > excellent * 1.5) return 'simple';
    if (excellent > unclear * 1.5) return 'complex';
    return 'moderate';
  }

  // Public methods for feedback management
  addFeedback(feedback: Feedback) {
    const userFeedback = this.feedbackHistory.get(feedback.userId) || [];
    userFeedback.push(feedback);
    this.feedbackHistory.set(feedback.userId, userFeedback);

    // Update user preferences based on new feedback
    this.updateUserPreferences(feedback.userId, userFeedback);
  }

  private updateUserPreferences(userId: string, feedback: Feedback[]) {
    const currentPreferences = this.userPreferences.get(userId);
    if (!currentPreferences) return;

    const patterns = this.analyzeFeedbackPatterns(userId);

    // Update preferences based on feedback patterns
    currentPreferences.preferredLength = patterns.preferredLength as 'short' | 'medium' | 'long';
    currentPreferences.preferredComplexity = patterns.preferredComplexity as 'simple' | 'moderate' | 'complex';
    currentPreferences.feedbackPatterns = patterns;

    this.userPreferences.set(userId, currentPreferences);
  }

  // Method to get learning insights
  getLearningInsights(userId: string) {
    const patterns = this.analyzeFeedbackPatterns(userId);
    const preferences = this.userPreferences.get(userId);

    return {
      feedbackPatterns: patterns,
      currentPreferences: preferences,
      recommendations: this.generateRecommendations(patterns, preferences)
    };
  }

  private generateRecommendations(patterns: any, preferences: UserPreferences | undefined) {
    const recommendations = [];

    if (patterns.averageScore < 3.5) {
      recommendations.push("Focus on improving response quality based on user feedback");
    }

    if (patterns.commonIssues.includes('too_long')) {
      recommendations.push("Consider providing more concise responses");
    }

    if (patterns.commonIssues.includes('unclear')) {
      recommendations.push("Work on making responses clearer and more structured");
    }

    if (patterns.totalFeedback > 10 && patterns.averageScore > 4.0) {
      recommendations.push("Excellent performance! Current approach is working well");
    }

    return recommendations;
  }
}