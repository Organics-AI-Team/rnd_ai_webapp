import { AIRequest, AIResponse, FeedbackPatterns } from '../../types/ai-types';
import { Feedback } from '../../types/feedback-types';

/**
 * Interface defining the contract for all AI services
 */
export interface IAIService {
  /**
   * Generate an AI response based on the request
   */
  generateResponse(request: AIRequest): Promise<AIResponse>;

  /**
   * Add feedback for learning and improvement
   */
  addFeedback(feedback: Feedback): void;

  /**
   * Get feedback history for a user
   */
  getFeedbackHistory(userId: string): Feedback[];

  /**
   * Analyze feedback patterns for insights
   */
  analyzeFeedbackPatterns(userId: string): FeedbackPatterns;

  /**
   * Get learning insights and recommendations
   */
  getLearningInsights(userId: string): {
    feedbackPatterns: FeedbackPatterns;
    currentPreferences: any;
    recommendations: string[];
  };
}

/**
 * Factory interface for creating AI services
 */
export interface IAIServiceFactory {
  createService(provider: string, apiKey: string, config?: any): IAIService;
  getSupportedProviders(): string[];
}

/**
 * Service registry for managing multiple AI services
 */
export interface IAIServiceRegistry {
  registerService(name: string, service: IAIService): void;
  getService(name: string): IAIService | undefined;
  removeService(name: string): boolean;
  listServices(): string[];
}