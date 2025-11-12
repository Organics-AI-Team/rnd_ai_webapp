/**
 * Streaming AI Response Service
 * Implements real-time streaming responses using LangGraph.js and Server-Sent Events
 */

import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { START, END, StateGraph, MessagesAnnotation } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import { concat } from '@langchain/core/utils/stream';
import { AIRequest, AIResponse } from '../../types/ai-types';

export interface StreamingChunk {
  type: 'content' | 'metadata' | 'error' | 'complete';
  content?: string;
  metadata?: {
    model: string;
    confidence?: number;
    sources?: string[];
    category?: string;
  };
  error?: string;
  isComplete?: boolean;
}

export interface StreamingOptions {
  onChunk?: (chunk: StreamingChunk) => void;
  onError?: (error: Error) => void;
  onComplete?: (fullResponse: string) => void;
  includeMetadata?: boolean;
  timeout?: number;
  maxTokens?: number;
}

/**
 * Streaming AI Service using LangGraph.js
 */
export class StreamingAIService {
  private apiKey: string;
  private defaultConfig: any;

  constructor(apiKey: string, config?: any) {
    this.apiKey = apiKey;
    this.defaultConfig = {
      model: 'gpt-4',
      temperature: 0.6,
      maxTokens: 1000,
      streaming: true,
      ...config,
    };
  }

  /**
   * Generate streaming AI response
   */
  async *generateStreamingResponse(
    request: AIRequest,
    options: StreamingOptions = {}
  ): AsyncGenerator<StreamingChunk> {
    const startTime = Date.now();

    try {
      // Build LangGraph for streaming
      const graph = await this.buildStreamingGraph();

      // Prepare messages
      const messages = this.prepareMessages(request);

      // Create streaming configuration
      const streamConfig = {
        recursionLimit: 10,
        signal: AbortSignal.timeout(options.timeout || 30000),
      };

      // Start streaming
      const eventStream = await graph.streamEvents(
        { messages },
        { version: "v2", ...streamConfig }
      );

      let aggregatedResponse = '';
      let metadataSent = false;

      // Process streaming events
      for await (const { event, name, data } of eventStream) {
        if (event === 'on_chat_model_stream') {
          const { chunk } = data;

          if (chunk && chunk.content) {
            // Handle different content types
            let contentChunk = '';

            if (typeof chunk.content === 'string') {
              contentChunk = chunk.content;
            } else if (Array.isArray(chunk.content)) {
              contentChunk = chunk.content
                .map(part => typeof part === 'string' ? part : (part.text || ''))
                .join('');
            }

            if (contentChunk) {
              aggregatedResponse = concat(aggregatedResponse, contentChunk);

              const chunk: StreamingChunk = {
                type: 'content',
                content: contentChunk,
              };

              yield chunk;
              options.onChunk?.(chunk);
            }
          }
        } else if (event === 'on_graph_end' && !metadataSent && options.includeMetadata) {
          // Send metadata when graph completes
          const metadata: StreamingChunk = {
            type: 'metadata',
            metadata: {
              model: this.defaultConfig.model,
              category: this.categorizeResponse(aggregatedResponse),
              confidence: this.assessConfidence(aggregatedResponse),
              sources: this.extractSources(aggregatedResponse),
            },
          };

          yield metadata;
          options.onChunk?.(metadata);
          metadataSent = true;
        }
      }

      // Send completion signal
      const completionChunk: StreamingChunk = {
        type: 'complete',
        content: aggregatedResponse,
        isComplete: true,
      };

      yield completionChunk;
      options.onComplete?.(aggregatedResponse);

    } catch (error) {
      const errorChunk: StreamingChunk = {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };

      yield errorChunk;
      options.onError?.(error as Error);
    }
  }

  /**
   * Generate response with Server-Sent Events for web streaming
   */
  async generateSSEStream(
    request: AIRequest,
    options: StreamingOptions = {}
  ): Promise<ReadableStream<Uint8Array>> {
    const encoder = new TextEncoder();

    return new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of this.generateStreamingResponse(request, options)) {
            // Format as Server-Sent Event
            const sseData = this.formatSSEChunk(chunk);
            controller.enqueue(encoder.encode(sseData));

            // Add delay to prevent overwhelming the client
            await new Promise(resolve => setTimeout(resolve, 10));
          }

          // Send final termination event
          controller.enqueue(encoder.encode('event: end\ndata: {}\n\n'));
          controller.close();

        } catch (error) {
          const errorChunk: StreamingChunk = {
            type: 'error',
            error: error instanceof Error ? error.message : 'Stream error',
          };

          const sseData = this.formatSSEChunk(errorChunk);
          controller.enqueue(encoder.encode(sseData));
          controller.close();
        }
      },
    });
  }

  /**
   * Format chunk as Server-Sent Event
   */
  private formatSSEChunk(chunk: StreamingChunk): string {
    const data = JSON.stringify(chunk);
    return `event: ${chunk.type}\ndata: ${data}\n\n`;
  }

  /**
   * Build streaming LangGraph
   */
  private async buildStreamingGraph() {
    const llm = new ChatOpenAI({
      openAIApiKey: this.apiKey,
      modelName: this.defaultConfig.model,
      temperature: this.defaultConfig.temperature,
      maxTokens: this.defaultConfig.maxTokens,
      streaming: true,
      callbacks: [
        {
          handleLLMNewToken(token: string) {
            // Token-level streaming handled by streamEvents
          },
        },
      ],
    });

    const workflow = new StateGraph(MessagesAnnotation);

    // Node for processing user input
    workflow.addNode('processInput', async (state: any) => {
      const messages = state.messages;
      return { messages };
    });

    // Node for generating response
    workflow.addNode('generateResponse', async (state: any) => {
      const response = await llm.invoke(state.messages);
      return {
        messages: [response],
      };
    });

    // Node for post-processing
    workflow.addNode('postProcess', async (state: any) => {
      const lastMessage = state.messages[state.messages.length - 1];

      // Extract metadata from response
      const processedMessage = {
        ...lastMessage,
        metadata: {
          category: this.categorizeResponse(lastMessage.content as string),
          confidence: this.assessConfidence(lastMessage.content as string),
          sources: this.extractSources(lastMessage.content as string),
        },
      };

      return {
        messages: [processedMessage],
      };
    });

    // Define workflow edges
    workflow.addEdge(START, 'processInput');
    workflow.addEdge('processInput', 'generateResponse');
    workflow.addEdge('generateResponse', 'postProcess');
    workflow.addEdge('postProcess', END);

    return workflow.compile();
  }

  /**
   * Prepare messages for LangGraph
   */
  private prepareMessages(request: AIRequest): BaseMessage[] {
    const messages: BaseMessage[] = [];

    // Add system prompt
    const systemPrompt = this.buildSystemPrompt(request);
    messages.push(new SystemMessage(systemPrompt));

    // Add context if provided
    if (request.context) {
      const contextString = typeof request.context === 'string'
        ? request.context
        : JSON.stringify(request.context, null, 2);

      messages.push(new HumanMessage(`Context: ${contextString}`));
    }

    // Add user message
    messages.push(new HumanMessage(request.prompt));

    return messages;
  }

  /**
   * Build enhanced system prompt
   */
  private buildSystemPrompt(request: AIRequest): string {
    return `You are an expert R&D AI assistant specializing in cosmetics, ingredients, and formulations.

RESPONSE GUIDELINES:
1. Provide accurate, science-based information
2. Include sources when available
3. Suggest practical applications
4. Consider safety and regulatory aspects
5. Structure responses clearly with sections
6. Respond in the language of the user's query

DOMAIN EXPERTISE:
- Cosmetic ingredients and their properties
- Formulation science and stability
- Regulatory compliance (FDA, EU, etc.)
- Safety assessment and toxicology
- Efficacy testing and claims
- Market trends and consumer preferences

RESPONSE FORMAT:
- Start with a direct answer
- Provide supporting details and evidence
- Include practical applications or considerations
- Mention relevant regulations or safety notes
- Suggest related topics for further exploration

Remember to be helpful, accurate, and professional while maintaining an engaging tone.`;
  }

  /**
   * Categorize response content
   */
  private categorizeResponse(content: string): string {
    const categories = {
      'ingredients': ['ingredient', 'compound', 'substance', 'extract', 'material'],
      'formulations': ['formulation', 'recipe', 'mixture', 'product', 'emulsion'],
      'regulations': ['regulation', 'compliance', 'safety', 'fda', 'eu', 'restriction'],
      'testing': ['test', 'study', 'clinical', 'efficacy', 'performance'],
      'applications': ['application', 'use', 'benefit', 'effect', 'skin'],
    };

    const contentLower = content.toLowerCase();
    let maxScore = 0;
    let bestCategory = 'general';

    for (const [category, keywords] of Object.entries(categories)) {
      const score = keywords.filter(keyword =>
        contentLower.includes(keyword)
      ).length;

      if (score > maxScore) {
        maxScore = score;
        bestCategory = category;
      }
    }

    return bestCategory;
  }

  /**
   * Assess response confidence
   */
  private assessConfidence(content: string): number {
    // Simple heuristic-based confidence assessment
    let confidence = 0.7; // Base confidence

    // Boost confidence for scientific content
    const scientificIndicators = [
      'study', 'research', 'clinical', 'data', 'evidence',
      'according to', 'based on', 'shown to', 'demonstrated'
    ];

    const scientificCount = scientificIndicators.filter(indicator =>
      content.toLowerCase().includes(indicator)
    ).length;

    confidence += scientificCount * 0.05;

    // Boost confidence for structured content
    if (content.includes('\n') || content.match(/\d+\./)) {
      confidence += 0.1;
    }

    // Cap at 1.0
    return Math.min(confidence, 1.0);
  }

  /**
   * Extract sources from content
   */
  private extractSources(content: string): string[] {
    const sourcePatterns = [
      /(?:source|reference|according to|based on):\s*([^,\n.]+)/gi,
      /\[([^\]]+)\]/g,
      /"(https?:\/\/[^"]+)"/g,
      /(\w+\s+et\s+al\.?,?\s*\d{4})/gi, // Academic citations
    ];

    const sources: string[] = [];
    sourcePatterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) {
        sources.push(...matches.map(match =>
          match.replace(/^(?:source|reference|according to|based on):\s*/i, '').trim()
        ));
      }
    });

    return [...new Set(sources)].slice(0, 5); // Remove duplicates and limit to 5
  }

  /**
   * Generate response with progress callbacks
   */
  async generateWithProgress(
    request: AIRequest,
    options: {
      onProgress?: (progress: number, content: string) => void;
      onComplete?: (response: AIResponse) => void;
      onError?: (error: Error) => void;
    } = {}
  ): Promise<AIResponse> {
    let fullContent = '';
    let chunkCount = 0;

    try {
      for await (const chunk of this.generateStreamingResponse(request)) {
        if (chunk.type === 'content' && chunk.content) {
          fullContent += chunk.content;
          chunkCount++;

          // Estimate progress (rough approximation)
          const progress = Math.min((chunkCount / 50) * 100, 95); // Assume ~50 chunks for full response
          options.onProgress?.(progress, fullContent);
        }
      }

      // Final progress update
      options.onProgress?.(100, fullContent);

      // Create final response
      const response: AIResponse = {
        response: fullContent,
        confidence: this.assessConfidence(fullContent),
        sources: this.extractSources(fullContent),
        metadata: {
          model: this.defaultConfig.model,
          category: this.categorizeResponse(fullContent),
          language: 'en',
          feedback: true,
        },
      };

      options.onComplete?.(response);
      return response;

    } catch (error) {
      options.onError?.(error as Error);
      throw error;
    }
  }

  /**
   * Batch streaming for multiple requests
   */
  async *batchStream(
    requests: AIRequest[],
    options: StreamingOptions = {}
  ): AsyncGenerator<{ requestId: string; chunk: StreamingChunk }> {
    const streams = requests.map(async (request, index) => {
      const requestId = `req_${index}_${Date.now()}`;
      const stream = this.generateStreamingResponse(request, options);

      return { requestId, stream };
    });

    // Process all streams concurrently
    const settledStreams = await Promise.allSettled(streams);

    for (const settledStream of settledStreams) {
      if (settledStream.status === 'fulfilled') {
        const { requestId, stream } = settledStream.value;

        try {
          for await (const chunk of stream) {
            yield { requestId, chunk };
          }
        } catch (error) {
          yield {
            requestId,
            chunk: {
              type: 'error',
              error: error instanceof Error ? error.message : 'Stream error',
            },
          };
        }
      } else {
        const requestId = `req_failed_${Date.now()}`;
        yield {
          requestId,
          chunk: {
            type: 'error',
            error: settledStream.reason?.message || 'Stream initialization failed',
          },
        };
      }
    }
  }
}