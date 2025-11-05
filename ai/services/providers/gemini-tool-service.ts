/**
 * Gemini Tool Calling Service
 * Extends GeminiService with native function calling support
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { BaseAIService } from '../core/base-ai-service';
import { AIRequest, AIResponse, AIModelConfig } from '../../types/ai-types';
import { ToolRegistry } from '../../agents/core/tool-registry';
import { ToolDefinition } from '../../agents/core/tool-types';

/**
 * Gemini service with native function calling capabilities
 */
export class GeminiToolService extends BaseAIService {
  private genAI: GoogleGenerativeAI;
  private toolRegistry: ToolRegistry;
  private maxToolIterations: number = 5; // Prevent infinite loops

  constructor(
    apiKey: string,
    toolRegistry: ToolRegistry,
    config?: Partial<AIModelConfig>,
    serviceName?: string
  ) {
    const defaultConfig: AIModelConfig = {
      model: 'gemini-2.0-flash-exp',
      temperature: 0.7,
      maxTokens: 9000,
      ...config
    };

    super(apiKey, defaultConfig, serviceName);

    console.log('🔧 [GeminiToolService] Initializing with tool support');
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.toolRegistry = toolRegistry;
  }

  /**
   * Convert Zod schema to Gemini function declaration format
   */
  private convert_tool_to_function_declaration(tool: ToolDefinition): any {
    console.log(`🔄 [GeminiToolService] Converting tool to function declaration: ${tool.name}`);

    // Extract Zod schema properties
    const zodShape = tool.parameters.shape;
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(zodShape)) {
      const zodField = value as any;

      // Unwrap ZodOptional and ZodDefault to get the inner type
      let innerType = zodField;
      let isOptional = false;

      // Handle ZodOptional wrapper
      if (zodField._def?.typeName === 'ZodOptional') {
        isOptional = true;
        innerType = zodField._def.innerType;
      }

      // Handle ZodDefault wrapper (which might wrap ZodOptional)
      if (innerType._def?.typeName === 'ZodDefault') {
        isOptional = true; // Has default = optional
        innerType = innerType._def.innerType;
      }

      // Handle ZodOptional inside ZodDefault
      if (innerType._def?.typeName === 'ZodOptional') {
        isOptional = true;
        innerType = innerType._def.innerType;
      }

      // Determine type using string literals (compatible with Gemini API)
      let type = 'STRING';
      const typeName = innerType._def?.typeName || zodField._def?.typeName;

      if (typeName === 'ZodNumber') {
        type = 'NUMBER';
      } else if (typeName === 'ZodBoolean') {
        type = 'BOOLEAN';
      } else if (typeName === 'ZodObject') {
        type = 'OBJECT';
      } else if (typeName === 'ZodArray') {
        type = 'ARRAY';
      } else if (typeName === 'ZodEnum') {
        type = 'STRING'; // Enums are strings with restricted values
      }

      // Get description from original zodField
      const description = zodField.description || innerType.description || `Parameter: ${key}`;

      properties[key] = {
        type,
        description
      };

      // Add to required array only if NOT optional
      if (!isOptional) {
        required.push(key);
      }
    }

    console.log(`✅ [GeminiToolService] Converted ${tool.name}: ${required.length} required params, ${Object.keys(properties).length - required.length} optional params`);

    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'OBJECT',
        properties,
        required
      }
    };
  }

  /**
   * Generate response with tool calling support
   */
  async generateResponse(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();

    console.log('🤖 [GeminiToolService] generateResponse with tools:', {
      prompt: request.prompt,
      userId: request.userId,
      availableTools: this.toolRegistry.list_tools().map(t => t.name)
    });

    try {
      // Get user preferences and adjust parameters
      const userPreferences = await this.getUserPreferences(request.userId);
      const { config: adjustedConfig, feedbackPatterns } = this.adjustParameters(
        request.userId,
        this.defaultConfig
      );

      // Get available tools
      const toolDefinitions = this.toolRegistry.list_tools();
      const functionDeclarations = toolDefinitions.map(tool =>
        this.convert_tool_to_function_declaration(tool)
      );

      console.log(`🔧 [GeminiToolService] Registered ${functionDeclarations.length} functions`);

      // Create model with tools
      const model = this.genAI.getGenerativeModel({
        model: adjustedConfig.model,
        generationConfig: {
          temperature: adjustedConfig.temperature,
          maxOutputTokens: adjustedConfig.maxTokens,
        },
        tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined
      });

      // Create enhanced prompt with context
      const enhancedPrompt = this.enhancePrompt(
        request.prompt,
        userPreferences,
        feedbackPatterns
      );

      // Create conversation history
      const history = request.context?.conversationHistory?.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      })) || [];

      const chat = model.startChat({ history });

      // Start conversation with tool calling loop
      let finalResponse = '';
      let toolCallCount = 0;
      let currentPrompt = enhancedPrompt;

      while (toolCallCount < this.maxToolIterations) {
        console.log(`🔄 [GeminiToolService] Iteration ${toolCallCount + 1}/${this.maxToolIterations}`);

        const result = await chat.sendMessage(currentPrompt);
        const response = result.response;

        // Check if AI wants to call a function
        const functionCalls = response.functionCalls();

        if (!functionCalls || functionCalls.length === 0) {
          // No function calls - get final text response
          finalResponse = response.text();
          console.log('✅ [GeminiToolService] Final response received (no tool calls)');
          break;
        }

        // Execute all function calls
        console.log(`🔧 [GeminiToolService] Executing ${functionCalls.length} function call(s)`);
        const functionResults = [];

        for (const functionCall of functionCalls) {
          console.log(`📞 [GeminiToolService] Function call: ${functionCall.name}`, functionCall.args);

          const toolResult = await this.toolRegistry.execute_tool({
            name: functionCall.name,
            arguments: functionCall.args
          });

          functionResults.push({
            functionResponse: {
              name: functionCall.name,
              response: toolResult.success ? toolResult.data : { error: toolResult.error }
            }
          });

          console.log(`✅ [GeminiToolService] Function result:`, toolResult);
        }

        // Send function results back to AI
        const functionResponseResult = await chat.sendMessage(functionResults as any);
        toolCallCount++;

        // Check if we got a final response
        const functionResponseText = functionResponseResult.response.text();
        if (functionResponseText) {
          finalResponse = functionResponseText;
          console.log('✅ [GeminiToolService] Final response received after tool execution');
          break;
        }

        // If no text yet, continue loop with empty prompt to trigger next action
        currentPrompt = '';
      }

      if (!finalResponse) {
        console.warn('⚠️ [GeminiToolService] Max iterations reached without final response');
        finalResponse = 'I encountered an issue processing your request. Please try again.';
      }

      const endTime = Date.now();
      const latency = endTime - startTime;

      console.log(`✅ [GeminiToolService] Response generated with ${toolCallCount} tool call(s) in ${latency}ms`);

      // Create response object
      return this.createResponse(
        finalResponse,
        adjustedConfig.model,
        adjustedConfig,
        feedbackPatterns.totalFeedback > 0,
        request.context?.category,
        latency
      );

    } catch (error: any) {
      console.error('🔥 [GeminiToolService] Error:', error);
      console.error('🔥 Error details:', {
        message: error.message,
        stack: error.stack
      });

      throw new Error(`Failed to generate AI response with tools: ${error.message}`);
    }
  }

  /**
   * Override token estimation for Gemini's tokenizer
   */
  protected estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
  }
}
