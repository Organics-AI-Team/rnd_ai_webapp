import { ChatOpenAI } from '@langchain/openai';
import { BaseAIService } from '../core/base-ai-service';
import { AIRequest, AIResponse, AIModelConfig } from '../../types/ai-types';
import { FeedbackAnalyzer } from '../core/feedback-analyzer';
import { START, END, StateGraph, MessagesAnnotation, MemorySaver } from '@langchain/langgraph';
import { BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';

type GraphState = {
  messages: BaseMessage[];
};

/**
 * LangGraph-based AI service that orchestrates prompt preparation and model invocation
 */
export class LangGraphService extends BaseAIService {
  constructor(apiKey: string, config?: Partial<AIModelConfig>, serviceName?: string) {
    const defaultConfig: AIModelConfig = {
      model: 'gpt-4o',
      temperature: 0.6,
      maxTokens: 500,
      presencePenalty: 0.1,
      frequencyPenalty: 0.1,
      ...config
    };

    super(apiKey, defaultConfig, serviceName);
  }

  async generateResponse(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();

    try {
      const userPreferences = await this.getUserPreferences(request.userId);
      const { config: adjustedConfig, feedbackPatterns } = this.adjustParameters(
        request.userId,
        this.defaultConfig
      );

      const systemPrompt = this.buildSystemPrompt(userPreferences, feedbackPatterns);
      const userPrompt = this.buildUserPrompt(request);
      const enhancedPrompt = this.enhancePrompt(
        userPrompt,
        userPreferences,
        feedbackPatterns
      );

      const graph = await this.buildGraph(adjustedConfig);
      const result = await graph.invoke({
        messages: [
          new SystemMessage(systemPrompt),
          new HumanMessage(enhancedPrompt)
        ]
      } as GraphState);

      const aiMessage = result.messages[result.messages.length - 1];
      const responseText = this.extractMessageText(aiMessage);
      const latency = Date.now() - startTime;

      return this.createResponse(
        responseText,
        adjustedConfig.model,
        adjustedConfig,
        feedbackPatterns.totalFeedback > 0,
        request.context?.category,
        latency
      );
    } catch (error) {
      console.error('LangGraph Service Error:', error);
      throw new Error('Failed to generate AI response via LangGraph');
    }
  }

  private async buildGraph(config: AIModelConfig) {
    const llm = new ChatOpenAI({
      openAIApiKey: this.apiKey,
      modelName: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens
    });

    const workflow = new StateGraph(MessagesAnnotation);

    workflow.addNode('chatModel', async (state: GraphState) => {
      const response = await llm.invoke(state.messages);
      return {
        messages: [response]
      };
    });

    workflow.addEdge(START, 'chatModel');
    workflow.addEdge('chatModel', END);

    return workflow.compile({
      checkpointer: new MemorySaver()
    });
  }

  private buildSystemPrompt(preferences: any, feedbackPatterns: any): string {
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
6. If feedback indicates inaccuracies, verify facts before responding`;
  }

  private buildUserPrompt(request: AIRequest): string {
    if (!request.context) {
      return request.prompt;
    }

    const contextString = typeof request.context === 'string'
      ? request.context
      : JSON.stringify(request.context, null, 2);

    return `${request.prompt}\n\nAdditional Context:\n${contextString}`;
  }

  private extractMessageText(message: BaseMessage): string {
    const { content } = message;
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map(part => {
          if (typeof part === 'string') return part;
          if (typeof part === 'object' && part !== null && 'text' in part) {
            return String((part as { text?: unknown }).text ?? '');
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }

    return String(content ?? '');
  }
}
