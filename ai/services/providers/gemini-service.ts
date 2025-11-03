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
      maxTokens: 9000,
      ...config
    };

    super(apiKey, defaultConfig);

    this.model = new ChatGoogleGenerativeAI({
      apiKey: apiKey,
      model: defaultConfig.model,
      temperature: defaultConfig.temperature,
      maxOutputTokens: defaultConfig.maxTokens,
    });
  }

  async generateResponse(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();

    console.log('🤖 Gemini generateResponse called:', {
      prompt: request.prompt,
      userId: request.userId,
      context: request.context
    });

    try {
      // Get user preferences and adjust parameters
      const userPreferences = await this.getUserPreferences(request.userId);
      const { config: adjustedConfig, feedbackPatterns } = this.adjustParameters(
        request.userId,
        this.defaultConfig
      );

      console.log('⚙️ Service parameters:', {
        originalConfig: this.defaultConfig,
        adjustedConfig,
        feedbackPatterns
      });

      // Create enhanced prompt
      const enhancedPrompt = this.enhancePrompt(
        request.prompt,
        userPreferences,
        feedbackPatterns
      );

      console.log('✨ Enhanced prompt:', enhancedPrompt);

      // Generate response using Gemini
      console.log('🔄 Calling Gemini model...');
      const response = await this.model.invoke(enhancedPrompt);
      console.log('✅ Received response from Gemini:', response);

      const endTime = Date.now();
      const latency = endTime - startTime;

      // Update model temperature and max output tokens if adjusted
      if (adjustedConfig.temperature !== this.defaultConfig.temperature) {
        this.model.temperature = adjustedConfig.temperature;
      }
      if (adjustedConfig.maxTokens !== this.defaultConfig.maxTokens) {
        this.model.maxOutputTokens = adjustedConfig.maxTokens;
      }

      // Extract response content safely
      let responseText = '';
      if (response && response.content) {
        if (typeof response.content === 'string') {
          responseText = response.content;
        } else if (response.content.text) {
          responseText = response.content.text;
        } else {
          // Try to convert to string directly
          responseText = String(response.content);
        }
      } else {
        responseText = 'No response generated';
      }

      // Create response object using base class method
      return this.createResponse(
        responseText,
        adjustedConfig.model,
        adjustedConfig,
        feedbackPatterns.totalFeedback > 0,
        request.context?.category,
        latency
      );

    } catch (error) {
      console.error('🔥 Gemini Service Error:', error);
      console.error('🔥 Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });

      // Check if this is the original split error
      if (error.message && error.message.includes('split')) {
        console.error('🚨 This is the split error - response extraction issue');
      }

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