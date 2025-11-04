import OpenAI from 'openai';
import { BaseAIService } from '../core/base-ai-service';
import { AIRequest, AIResponse, AIModelConfig } from '../../types/ai-types';
import { Feedback } from '../../types/feedback-types';
import { FeedbackAnalyzer } from '../core/feedback-analyzer';

/**
 * OpenAI GPT service implementation using the base AI service
 */
export class OpenAIService extends BaseAIService {
  private openai: OpenAI;

  constructor(apiKey: string, config?: Partial<AIModelConfig>) {
    const defaultConfig: AIModelConfig = {
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 500,
      presencePenalty: 0.1,
      frequencyPenalty: 0.1,
      ...config
    };

    super(apiKey, defaultConfig);
    this.openai = new OpenAI({ apiKey });
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

      // Generate response using OpenAI
      const completion = await this.openai.chat.completions.create({
        model: adjustedConfig.model,
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt(userPreferences, feedbackPatterns)
          },
          {
            role: 'user',
            content: enhancedPrompt
          }
        ],
        temperature: adjustedConfig.temperature,
        max_tokens: adjustedConfig.maxTokens,
        presence_penalty: adjustedConfig.presencePenalty,
        frequency_penalty: adjustedConfig.frequencyPenalty
      });

      const response = completion.choices[0]?.message?.content ||
        'I apologize, but I couldn\'t generate a response.';

      const endTime = Date.now();
      const latency = endTime - startTime;

      // Create response object using base class method
      return this.createResponse(
        response,
        adjustedConfig.model,
        adjustedConfig,
        feedbackPatterns.totalFeedback > 0,
        request.context?.category,
        latency
      );

    } catch (error) {
      console.error('OpenAI Service Error:', error);
      throw new Error('Failed to generate AI response');
    }
  }

  /**
   * Override token estimation for OpenAI's tokenizer
   */
  protected estimateTokens(text: string): number {
    // OpenAI's tiktoken would be more accurate, but this is a reasonable approximation
    return Math.ceil(text.length / 4);
  }

  /**
   * Generate system prompt based on user preferences and feedback
   */
  private getSystemPrompt(preferences: any, feedbackPatterns: any): string {
    return `You are a helpful AI assistant that adapts to user feedback and preferences.

User Preferences:
- Preferred Length: ${preferences.preferredLength}
- Preferred Style: ${preferences.preferredStyle}
- Preferred Complexity: ${preferences.preferredComplexity}

${FeedbackAnalyzer.generateFeedbackInstructions(feedbackPatterns)}

Guidelines:
1. Be clear, accurate, and helpful
2. Adapt your response style based on user feedback
3. Focus on providing value while respecting preferences
4. If user has given feedback about length being too long/short, adjust accordingly
5. If user finds responses unclear, use simpler language and better structure
6. If feedback indicates inaccuracies, be extra careful with facts`;
  }
}