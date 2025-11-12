/**
 * Agent API Service
 * Client-side service that calls server-side agent API with tool support
 */

import { BaseAIService } from '../core/base-ai-service';
import { AIRequest, AIResponse, AIModelConfig } from '../../types/ai-types';

/**
 * Service that calls the raw materials agent API endpoint
 */
export class AgentAPIService extends BaseAIService {
  private apiEndpoint: string;

  constructor(apiEndpoint: string, config?: Partial<AIModelConfig>, serviceName?: string) {
    const defaultConfig: AIModelConfig = {
      model: 'gemini-2.0-flash-exp',
      temperature: 0.7,
      maxTokens: 9000,
      ...config
    };

    super('', defaultConfig, serviceName); // No API key needed for client

    this.apiEndpoint = apiEndpoint;
    console.log(`🔧 [AgentAPIService] Initialized for endpoint: ${apiEndpoint}`);
  }

  async generateResponse(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();

    console.log('🤖 [AgentAPIService] Calling agent API:', {
      endpoint: this.apiEndpoint,
      prompt: request.prompt,
      userId: request.userId
    });

    try {
      // Call the agent API
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: request.prompt,
          userId: request.userId,
          conversationHistory: request.context?.conversationHistory || []
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `API request failed with status ${response.status}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'API request failed');
      }

      const endTime = Date.now();
      const latency = endTime - startTime;

      console.log('✅ [AgentAPIService] Received response from agent API');

      // Create response object
      return this.createResponse(
        data.response,
        data.model || this.defaultConfig.model,
        this.defaultConfig,
        false, // No feedback patterns on client side
        request.context?.category,
        latency
      );

    } catch (error: any) {
      console.error('❌ [AgentAPIService] Error:', error);
      throw new Error(`Agent API request failed: ${error.message}`);
    }
  }

  /**
   * Override token estimation
   */
  protected estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
  }
}
