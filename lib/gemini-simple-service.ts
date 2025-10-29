import { GoogleGenerativeAI } from "@google/generative-ai";
import { Feedback } from "./feedback-types";

interface AIRequest {
  prompt: string;
  userId: string;
  context?: {
    previousResponses?: string[];
    userPreferences?: UserPreferences;
    category?: string;
    conversationHistory?: Array<{ role: string; content: string }>;
    recentMessages?: Array<{ role: string; content: string }>;
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

export class GeminiSimpleService {
  private genAI: GoogleGenerativeAI;
  private model: any;
  private feedbackHistory: Map<string, Feedback[]> = new Map();
  private userPreferences: Map<string, UserPreferences> = new Map();

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: "gemini-2.0-flash-exp",
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 500,
      }
    });
  }

  async generateResponse(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();

    try {
      // Get user preferences and feedback patterns
      const userPreferences = await this.getUserPreferences(request.userId);
      const feedbackPatterns = this.analyzeFeedbackPatterns(request.userId);

      // Create enhanced prompt based on feedback
      const enhancedPrompt = this.createEnhancedPrompt(
        request.prompt,
        userPreferences,
        feedbackPatterns,
        request.context
      );

      // Generate response
      const result = await this.model.generateContent(enhancedPrompt);
      const response = await result.response;
      const text = response.text();

      const endTime = Date.now();
      const latency = endTime - startTime;

      // Assess response characteristics
      const complexity = this.assessComplexity(text);

      return {
        id: `response_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        response: text,
        model: "gemini-2.0-flash-exp",
        temperature: this.getAdjustedTemperature(feedbackPatterns, userPreferences),
        maxTokens: this.getAdjustedMaxTokens(feedbackPatterns, userPreferences),
        timestamp: new Date(),
        context: {
          length: text.length,
          complexity,
          category: request.context?.category,
          feedbackAdjusted: feedbackPatterns.totalFeedback > 0
        },
        metadata: {
          promptTokens: this.estimateTokens(request.prompt),
          completionTokens: this.estimateTokens(text),
          totalTokens: this.estimateTokens(request.prompt) + this.estimateTokens(text),
          latency
        }
      };
    } catch (error) {
      console.error('Gemini Simple Service Error:', error);
      throw new Error('Failed to generate AI response');
    }
  }

  private createEnhancedPrompt(
    originalPrompt: string,
    userPreferences: UserPreferences,
    feedbackPatterns: any,
    context?: any
  ): string {
    let enhancedPrompt = originalPrompt;

    // Build conversation context from recent messages

    let conversationContext = '';
    if (context?.recentMessages && context.recentMessages.length > 0) {
      // Format the conversation history as a chat dialogue
      const recentMessagesText = context.recentMessages
        .slice(-20) // Use last 20 messages for context to avoid token limits
        .map(msg => {
          const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
          return `${roleLabel}: ${msg.content}`;
        })
        .join('\n');

      conversationContext = `\n\nRecent conversation history (you are continuing this conversation):\n${recentMessagesText}\n\nNow respond to the current user message:`;
    }

    // Add system instructions based on user preferences and feedback patterns
    const instructions = [];

    if (feedbackPatterns.totalFeedback > 0) {
      instructions.push("Based on previous feedback:");

      if (feedbackPatterns.commonIssues.includes('too_long')) {
        instructions.push("Keep responses concise and to the point.");
      } else if (feedbackPatterns.commonIssues.includes('too_short')) {
        instructions.push("Provide more detailed and comprehensive responses.");
      }

      if (feedbackPatterns.commonIssues.includes('unclear')) {
        instructions.push("Use clear, simple language and well-structured responses.");
      }

      if (feedbackPatterns.commonIssues.includes('inaccurate')) {
        instructions.push("Double-check facts and ensure information accuracy.");
      }

      if (feedbackPatterns.commonIssues.includes('not_related')) {
        instructions.push("Ensure responses directly address the user's question.");
      }

      if (feedbackPatterns.averageScore < 3.5) {
        instructions.push("Focus on providing high-quality, helpful responses.");
      }
    }

    // Add user preference based instructions
    if (userPreferences.preferredLength === 'short') {
      instructions.push("Provide a concise and brief response.");
    } else if (userPreferences.preferredLength === 'long') {
      instructions.push("Provide a detailed and comprehensive response.");
    }

    if (userPreferences.preferredStyle === 'formal') {
      instructions.push("Use a formal and professional tone.");
    } else if (userPreferences.preferredStyle === 'casual') {
      instructions.push("Use a friendly and conversational tone.");
    }

    if (userPreferences.preferredComplexity === 'simple') {
      instructions.push("Explain in simple, easy-to-understand terms.");
    } else if (userPreferences.preferredComplexity === 'complex') {
      instructions.push("Provide detailed technical explanations.");
    }

    if (userPreferences.avoidTopics.length > 0) {
      instructions.push(`Avoid discussing: ${userPreferences.avoidTopics.join(', ')}.`);
    }

    // Build final prompt with conversation context and instructions
    if (conversationContext || instructions.length > 0) {
      const instructionText = instructions.length > 0
        ? `\n\nAdditional instructions: ${instructions.join(' ')}`
        : '';

      enhancedPrompt = `${originalPrompt}${conversationContext}${instructionText}`;
    }

    return enhancedPrompt;
  }

  private getAdjustedTemperature(feedbackPatterns: any, userPreferences: UserPreferences): number {
    let baseTemp = 0.7;

    // Adjust based on feedback patterns
    if (feedbackPatterns.commonIssues.includes('unclear')) {
      baseTemp = Math.max(0.3, baseTemp - 0.2);
    }

    if (feedbackPatterns.averageScore < 3) {
      baseTemp = Math.max(0.4, baseTemp - 0.1);
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
    return Math.ceil(text.length / 4);
  }

  private async getUserPreferences(userId: string): Promise<UserPreferences> {
    if (this.userPreferences.has(userId)) {
      return this.userPreferences.get(userId)!;
    }

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

    const recentFeedback = feedback.slice(-20);
    const averageScore = recentFeedback.reduce((sum, f) => sum + f.score, 0) / recentFeedback.length;

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

    this.updateUserPreferences(feedback.userId, userFeedback);
  }

  private updateUserPreferences(userId: string, feedback: Feedback[]) {
    const currentPreferences = this.userPreferences.get(userId);
    if (!currentPreferences) return;

    const patterns = this.analyzeFeedbackPatterns(userId);

    currentPreferences.preferredLength = patterns.preferredLength as 'short' | 'medium' | 'long';
    currentPreferences.preferredComplexity = patterns.preferredComplexity as 'simple' | 'moderate' | 'complex';
    currentPreferences.feedbackPatterns = patterns;

    this.userPreferences.set(userId, currentPreferences);
  }

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