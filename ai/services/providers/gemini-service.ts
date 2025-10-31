import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { BaseAIService } from '../core/base-ai-service';
import { AIRequest, AIResponse, AIModelConfig } from '../../types/ai-types';
import { Feedback } from '../../types/feedback-types';
import { FeedbackAnalyzer } from '../core/feedback-analyzer';

/**
 * Google Gemini service implementation using the base AI service
 */
export class GeminiService extends BaseAIService {
  private model: ChatGoogleGenerativeAI;

  constructor(apiKey: string, config?: Partial<AIModelConfig>) {
    const defaultConfig: AIModelConfig = {
      model: 'gemini-2.5-flash',
      temperature: 0.7,
      maxTokens: 500,
      ...config
    };

    super(apiKey, defaultConfig);

    this.model = new ChatGoogleGenerativeAI({
      apiKey: apiKey,
      modelName: defaultConfig.model,
      temperature: defaultConfig.temperature,
      maxOutputTokens: defaultConfig.maxTokens,
    });
  }

  async generateResponse(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();

    try {
      // Get user preferences and adjust parameters
      const userPreferences = await this.getUserPreferences(request.userId);
      const { config: adjustedConfig, feedbackPatterns } = this.adjustParameters(
        request.userId,
        this.defaultConfig
      );

      // Create enhanced prompt
      const enhancedPrompt = this.enhancePrompt(
        request.prompt,
        userPreferences,
        feedbackPatterns
      );

      // Generate response using Gemini
      const response = await this.model.invoke(enhancedPrompt);

      const endTime = Date.now();
      const latency = endTime - startTime;

      // Update model temperature and max output tokens if adjusted
      if (adjustedConfig.temperature !== this.defaultConfig.temperature) {
        this.model.temperature = adjustedConfig.temperature;
      }
      if (adjustedConfig.maxTokens !== this.defaultConfig.maxTokens) {
        this.model.maxOutputTokens = adjustedConfig.maxTokens;
      }

      // Create response object using base class method
      return this.createResponse(
        response as string,
        adjustedConfig.model,
        adjustedConfig,
        feedbackPatterns.totalFeedback > 0,
        request.context?.category,
        latency
      );

    } catch (error) {
      console.error('Gemini Service Error:', error);
      throw new Error('Failed to generate AI response');
    }
  }

  /**
   * Override token estimation for Gemini's tokenizer
   */
  protected estimateTokens(text: string): number {
    // Gemini uses a different tokenization, this is a reasonable approximation
    return Math.ceil(text.length / 3.5);
  }
}