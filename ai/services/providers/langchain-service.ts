import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import { BaseAIService } from '../core/base-ai-service';
import { AIRequest, AIResponse, AIModelConfig } from '../../types/ai-types';
import { Feedback } from '../../types/feedback-types';
import { FeedbackAnalyzer } from '../core/feedback-analyzer';

/**
 * LangChain-based AI service implementation using the base AI service
 * Provides advanced chain building and prompt management capabilities
 */
export class LangChainService extends BaseAIService {
  private model: ChatOpenAI;

  constructor(apiKey: string, config?: Partial<AIModelConfig>, serviceName?: string) {
    const defaultConfig: AIModelConfig = {
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 500,
      ...config
    };

    super(apiKey, defaultConfig, serviceName);

    this.model = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName: defaultConfig.model,
      temperature: defaultConfig.temperature,
      maxTokens: defaultConfig.maxTokens,
    });
  }

  async generateResponse(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();

    try {
      // Get user preferences and feedback patterns
      const userPreferences = await this.getUserPreferences(request.userId);
      const { config: adjustedConfig, feedbackPatterns } = this.adjustParameters(
        request.userId,
        this.defaultConfig
      );

      // Create the prompt chain based on feedback and preferences
      const chain = await this.createFeedbackAwareChain(userPreferences, feedbackPatterns);

      // Update model parameters if they were adjusted
      this.model.temperature = adjustedConfig.temperature;
      this.model.maxTokens = adjustedConfig.maxTokens;

      // Generate response using the chain
      const response = await chain.invoke({
        prompt: request.prompt,
        context: request.context,
        userPreferences,
        feedbackPatterns
      });

      const endTime = Date.now();
      const latency = endTime - startTime;

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
      console.error('LangChain Service Error:', error);
      throw new Error('Failed to generate AI response');
    }
  }

  /**
   * Creates a LangChain sequence that adapts based on feedback and preferences
   */
  private async createFeedbackAwareChain(
    userPreferences: any,
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
        feedbackInstructions: () => FeedbackAnalyzer.generateFeedbackInstructions(feedbackPatterns)
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

  /**
   * Get learning insights specific to LangChain service
   */
  getLearningInsights(userId: string) {
    const baseInsights = super.getLearningInsights(userId);
    const feedback = this.getFeedbackHistory(userId);

    // Add LangChain-specific insights
    const chainComplexity = this.assessChainComplexity(feedback.length);
    const promptOptimization = this.assessPromptOptimization(feedback);

    return {
      ...baseInsights,
      langChainSpecific: {
        chainComplexity,
        promptOptimization,
        recommended: this.generateLangChainRecommendations(feedback)
      }
    };
  }

  private assessChainComplexity(feedbackCount: number): 'simple' | 'moderate' | 'complex' {
    if (feedbackCount < 5) return 'simple';
    if (feedbackCount < 20) return 'moderate';
    return 'complex';
  }

  private assessPromptOptimization(feedback: any[]): string {
    const avgScore = feedback.reduce((sum, f) => sum + f.score, 0) / feedback.length || 0;
    if (avgScore > 4.2) return 'Excellent';
    if (avgScore > 3.5) return 'Good';
    return 'Needs improvement';
  }

  private generateLangChainRecommendations(feedback: any[]): string[] {
    const recommendations = [];
    const recentFeedback = feedback.slice(-10);

    const unclearCount = recentFeedback.filter(f => f.type === 'unclear').length;
    if (unclearCount > 2) {
      recommendations.push('Consider adding more structured prompts to your chains');
    }

    const shortCount = recentFeedback.filter(f => f.type === 'too_short').length;
    if (shortCount > 2) {
      recommendations.push('Add output parsers for more structured responses');
    }

    return recommendations;
  }
}