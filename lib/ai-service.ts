import OpenAI from 'openai';
import { Feedback, FeedbackType } from './feedback-types';

interface AIRequest {
  prompt: string;
  userId: string;
  context?: {
    previousResponses?: string[];
    userPreferences?: UserPreferences;
    category?: string;
  };
}

interface UserPreferences {
  preferredLength: 'short' | 'medium' | 'long';
  preferredStyle: 'formal' | 'casual' | 'technical';
  avoidTopics: string[];
  preferredComplexity: 'simple' | 'moderate' | 'complex';
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
  };
}

export class AIService {
  private openai: OpenAI;
  private feedbackHistory: Map<string, Feedback[]> = new Map();

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
  }

  async generateResponse(request: AIRequest): Promise<AIResponse> {
    const userPreferences = await this.getUserPreferences(request.userId);
    const feedbackHistory = this.getFeedbackHistory(request.userId);

    // Analyze feedback patterns to adjust response parameters
    const adjustedParams = this.adjustParametersBasedOnFeedback(feedbackHistory, userPreferences);

    // Craft enhanced prompt based on feedback
    const enhancedPrompt = this.enhancePrompt(request.prompt, adjustedParams, userPreferences);

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt(adjustedParams, userPreferences)
          },
          {
            role: 'user',
            content: enhancedPrompt
          }
        ],
        temperature: adjustedParams.temperature,
        max_tokens: adjustedParams.maxTokens,
        presence_penalty: adjustedParams.presencePenalty,
        frequency_penalty: adjustedParams.frequencyPenalty
      });

      const response = completion.choices[0]?.message?.content || 'I apologize, but I couldn\'t generate a response.';

      return {
        id: `response_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        response,
        model: 'gpt-4',
        temperature: adjustedParams.temperature,
        maxTokens: adjustedParams.maxTokens,
        timestamp: new Date(),
        context: {
          length: response.length,
          complexity: this.assessComplexity(response),
          category: request.context?.category
        }
      };
    } catch (error) {
      console.error('AI Service Error:', error);
      throw new Error('Failed to generate AI response');
    }
  }

  private adjustParametersBasedOnFeedback(feedback: Feedback[], preferences: UserPreferences) {
    const recentFeedback = feedback.slice(-10); // Last 10 pieces of feedback

    const defaultParams = {
      temperature: 0.7,
      maxTokens: 500,
      presencePenalty: 0.1,
      frequencyPenalty: 0.1
    };

    if (recentFeedback.length === 0) {
      return {
        ...defaultParams,
        maxTokens: this.getMaxTokensForLength(preferences.preferredLength)
      };
    }

    // Calculate adjustments based on feedback patterns
    const adjustments = {
      temperature: defaultParams.temperature,
      maxTokens: defaultParams.maxTokens,
      presencePenalty: defaultParams.presencePenalty,
      frequencyPenalty: defaultParams.frequencyPenalty
    };

    // Adjust for length feedback
    const tooLongFeedback = recentFeedback.filter(f => f.type === 'too_long').length;
    const tooShortFeedback = recentFeedback.filter(f => f.type === 'too_short').length;

    if (tooLongFeedback > tooShortFeedback) {
      adjustments.maxTokens = Math.max(200, defaultParams.maxTokens - 100);
    } else if (tooShortFeedback > tooLongFeedback) {
      adjustments.maxTokens = Math.min(1000, defaultParams.maxTokens + 100);
    }

    // Adjust for complexity/unclear feedback
    const unclearFeedback = recentFeedback.filter(f => f.type === 'unclear').length;
    if (unclearFeedback > recentFeedback.length * 0.3) {
      adjustments.temperature = Math.max(0.3, defaultParams.temperature - 0.2);
    }

    // Adjust for repetition
    const avgScore = recentFeedback.reduce((sum, f) => sum + f.score, 0) / recentFeedback.length;
    if (avgScore < 3) {
      adjustments.frequencyPenalty = Math.min(0.5, defaultParams.frequencyPenalty + 0.2);
    }

    return {
      ...adjustments,
      maxTokens: this.getMaxTokensForLength(preferences.preferredLength, adjustments.maxTokens)
    };
  }

  private enhancePrompt(originalPrompt: string, params: any, preferences: UserPreferences): string {
    let enhancedPrompt = originalPrompt;

    // Add specific instructions based on user preferences and feedback patterns
    const instructions = [];

    if (preferences.preferredLength === 'short') {
      instructions.push('Provide a concise and brief response.');
    } else if (preferences.preferredLength === 'long') {
      instructions.push('Provide a detailed and comprehensive response.');
    }

    if (preferences.preferredStyle === 'formal') {
      instructions.push('Use a formal and professional tone.');
    } else if (preferences.preferredStyle === 'casual') {
      instructions.push('Use a friendly and conversational tone.');
    }

    if (preferences.preferredComplexity === 'simple') {
      instructions.push('Explain in simple, easy-to-understand terms.');
    } else if (preferences.preferredComplexity === 'complex') {
      instructions.push('Provide detailed technical explanations.');
    }

    if (preferences.avoidTopics.length > 0) {
      instructions.push(`Avoid discussing: ${preferences.avoidTopics.join(', ')}.`);
    }

    if (instructions.length > 0) {
      enhancedPrompt = `${originalPrompt}\n\nAdditional instructions: ${instructions.join(' ')}`;
    }

    return enhancedPrompt;
  }

  private getSystemPrompt(params: any, preferences: UserPreferences): string {
    return `You are a helpful AI assistant. Adapt your responses based on user feedback and preferences.
    Be clear, accurate, and helpful. Focus on providing value while respecting the user's preferred communication style.`;
  }

  private getMaxTokensForLength(preferredLength: string, baseMaxTokens: number = 500): number {
    switch (preferredLength) {
      case 'short':
        return Math.min(300, baseMaxTokens);
      case 'long':
        return Math.max(800, baseMaxTokens);
      default:
        return baseMaxTokens;
    }
  }

  private assessComplexity(text: string): 'simple' | 'moderate' | 'complex' {
    // Simple heuristic for complexity assessment
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

  private async getUserPreferences(userId: string): Promise<UserPreferences> {
    // In a real implementation, this would fetch from a database
    return {
      preferredLength: 'medium',
      preferredStyle: 'casual',
      avoidTopics: [],
      preferredComplexity: 'moderate'
    };
  }

  private getFeedbackHistory(userId: string): Feedback[] {
    return this.feedbackHistory.get(userId) || [];
  }

  // Methods to be called when feedback is received
  addFeedback(feedback: Feedback) {
    const userFeedback = this.getFeedbackHistory(feedback.userId);
    userFeedback.push(feedback);
    this.feedbackHistory.set(feedback.userId, userFeedback);
  }

  // Analyze feedback patterns for insights
  analyzeFeedbackPatterns(userId: string) {
    const feedback = this.getFeedbackHistory(userId);

    if (feedback.length === 0) return null;

    const patterns = {
      averageScore: feedback.reduce((sum, f) => sum + f.score, 0) / feedback.length,
      commonIssues: this.getMostCommonFeedbackTypes(feedback),
      preferredLength: this.inferPreferredLength(feedback),
      preferredComplexity: this.inferPreferredComplexity(feedback),
      totalFeedback: feedback.length
    };

    return patterns;
  }

  private getMostCommonFeedbackTypes(feedback: Feedback[]) {
    const typeCounts = feedback.reduce((acc, f) => {
      acc[f.type] = (acc[f.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(typeCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([type, count]) => ({ type, count }));
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
}