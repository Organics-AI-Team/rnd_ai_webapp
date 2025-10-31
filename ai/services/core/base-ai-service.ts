import { AIRequest, AIResponse, UserPreferences, AIModelConfig } from '../../types/ai-types';
import { Feedback, FeedbackPatterns } from '../../types/feedback-types';
import { FeedbackAnalyzer } from './feedback-analyzer';

/**
 * Abstract base class for all AI services
 * Provides common functionality and enforces interface consistency
 */
export abstract class BaseAIService {
  protected feedbackHistory: Map<string, Feedback[]> = new Map();
  protected userPreferences: Map<string, UserPreferences> = new Map();

  constructor(
    protected apiKey: string,
    protected defaultConfig: AIModelConfig
  ) {}

  /**
   * Main method to generate AI responses - must be implemented by subclasses
   */
  abstract generateResponse(request: AIRequest): Promise<AIResponse>;

  /**
   * Add feedback for a response
   */
  addFeedback(feedback: Feedback): void {
    const userFeedback = this.feedbackHistory.get(feedback.userId) || [];
    userFeedback.push(feedback);
    this.feedbackHistory.set(feedback.userId, userFeedback);

    // Update user preferences based on new feedback
    this.updateUserPreferences(feedback.userId, userFeedback);
  }

  /**
   * Get feedback history for a user
   */
  getFeedbackHistory(userId: string): Feedback[] {
    return this.feedbackHistory.get(userId) || [];
  }

  /**
   * Get user preferences, creating defaults if not exist
   */
  async getUserPreferences(userId: string): Promise<UserPreferences> {
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

  /**
   * Analyze feedback patterns for a user
   */
  analyzeFeedbackPatterns(userId: string): FeedbackPatterns {
    const feedback = this.getFeedbackHistory(userId);
    return FeedbackAnalyzer.analyzeFeedbackPatterns(feedback);
  }

  /**
   * Get learning insights for a user
   */
  getLearningInsights(userId: string) {
    const patterns = this.analyzeFeedbackPatterns(userId);
    const preferences = this.userPreferences.get(userId);

    return {
      feedbackPatterns: patterns,
      currentPreferences: preferences,
      recommendations: FeedbackAnalyzer.generateRecommendations(patterns)
    };
  }

  /**
   * Adjust model parameters based on feedback and preferences
   */
  protected adjustParameters(
    userId: string,
    baseConfig: AIModelConfig
  ): { config: AIModelConfig; feedbackPatterns: FeedbackPatterns } {
    const feedback = this.getFeedbackHistory(userId);
    const preferences = this.userPreferences.get(userId);

    if (!preferences) {
      return {
        config: baseConfig,
        feedbackPatterns: FeedbackAnalyzer.analyzeFeedbackPatterns([])
      };
    }

    return FeedbackAnalyzer.adjustParametersBasedOnFeedback(
      feedback,
      preferences,
      baseConfig
    );
  }

  /**
   * Generate enhanced prompt based on user preferences and feedback
   */
  protected enhancePrompt(
    originalPrompt: string,
    preferences: UserPreferences,
    feedbackPatterns: FeedbackPatterns
  ): string {
    let enhancedPrompt = originalPrompt;

    // Add feedback-based instructions
    const feedbackInstructions = FeedbackAnalyzer.generateFeedbackInstructions(feedbackPatterns);
    if (feedbackInstructions) {
      enhancedPrompt = `${originalPrompt}\n\n${feedbackInstructions}`;
    }

    // Add user preference instructions
    const preferenceInstructions = this.generatePreferenceInstructions(preferences);
    if (preferenceInstructions) {
      enhancedPrompt = `${enhancedPrompt}\n\nUser Preferences: ${preferenceInstructions}`;
    }

    return enhancedPrompt;
  }

  /**
   * Generate instructions based on user preferences
   */
  private generatePreferenceInstructions(preferences: UserPreferences): string {
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

    return instructions.join(' ');
  }

  /**
   * Update user preferences based on feedback patterns
   */
  private updateUserPreferences(userId: string, feedback: Feedback[]): void {
    const currentPreferences = this.userPreferences.get(userId);
    if (!currentPreferences) return;

    const patterns = FeedbackAnalyzer.analyzeFeedbackPatterns(feedback);

    // Update preferences based on feedback patterns
    currentPreferences.preferredLength = patterns.preferredLength;
    currentPreferences.preferredComplexity = patterns.preferredComplexity;
    currentPreferences.feedbackPatterns = patterns;

    this.userPreferences.set(userId, currentPreferences);
  }

  /**
   * Create a unique response ID
   */
  protected generateResponseId(): string {
    return `response_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create response object with common fields
   */
  protected createResponse(
    response: string,
    model: string,
    config: AIModelConfig,
    feedbackAdjusted: boolean = false,
    category?: string,
    latency?: number
  ): AIResponse {
    return {
      id: this.generateResponseId(),
      response,
      model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      timestamp: new Date(),
      context: {
        length: response.length,
        complexity: this.assessComplexity(response),
        category,
        feedbackAdjusted
      },
      metadata: latency ? {
        promptTokens: 0, // To be calculated by subclasses
        completionTokens: this.estimateTokens(response),
        totalTokens: 0, // To be calculated by subclasses
        latency
      } : undefined
    };
  }

  /**
   * Estimate token count (can be overridden by subclasses for more accuracy)
   */
  protected estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Assess response complexity (can be overridden by subclasses)
   */
  protected assessComplexity(text: string): 'simple' | 'moderate' | 'complex' {
    const sentences = text.split('.').filter(s => s.trim().length > 0);
    const avgSentenceLength = sentences.reduce((sum, sentence) =>
      sum + sentence.split(' ').length, 0) / sentences.length;

    const technicalTerms = /algorithm|function|parameter|methodology|implementation|architecture|system|process|analysis/gi;
    const technicalDensity = (text.match(technicalTerms) || []).length / text.split(' ').length;

    if (avgSentenceLength > 20 || technicalDensity > 0.05) {
      return 'complex';
    } else if (avgSentenceLength > 15 || technicalDensity > 0.02) {
      return 'moderate';
    }
    return 'simple';
  }
}