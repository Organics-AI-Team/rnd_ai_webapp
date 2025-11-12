/**
 * Gemini Tool Calling Service
 * Extends GeminiService with native function calling support
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { BaseAIService } from '../core/base-ai-service';
import { AIRequest, AIResponse, AIModelConfig } from '../../types/ai-types';
import { DefaultToolRegistry } from '../../agents/core/tool-registry';
import { ToolRegistry, ToolDefinition } from '../../agents/core/tool-types';

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

        // For arrays, we need to determine the item type
        const arrayType = innerType._def?.type;
        let itemType = 'STRING'; // Default array item type

        if (arrayType?._def?.typeName === 'ZodNumber') {
          itemType = 'NUMBER';
        } else if (arrayType?._def?.typeName === 'ZodBoolean') {
          itemType = 'BOOLEAN';
        } else if (arrayType?._def?.typeName === 'ZodObject') {
          itemType = 'OBJECT';
        } else if (arrayType?._def?.typeName === 'ZodArray') {
          itemType = 'ARRAY'; // Nested array
        }

        // Get description from original zodField
        const description = zodField.description || innerType.description || `Parameter: ${key}`;

        properties[key] = {
          type,
          description,
          items: {
            type: itemType
          }
        };

        continue; // Skip the rest since we already handled this property
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
   * Convert and validate function call arguments to proper types
   */
  private convert_and_validate_arguments(tool: ToolDefinition, args: any): any {
    console.log(`🔧 [GeminiToolService] Converting arguments for tool: ${tool.name}`);
    console.log(`🔍 [GeminiToolService] Original arguments:`, args);

    const zodShape = tool.parameters.shape;
    const convertedArgs: any = {};

    for (const [key, value] of Object.entries(zodShape)) {
      const zodField = value as any;
      let rawValue = args[key];

      // Skip if no value provided
      if (rawValue === undefined || rawValue === null) {
        continue;
      }

      // Unwrap ZodOptional and ZodDefault to get the inner type
      let innerType = zodField;
      let isOptional = false;

      // Handle the structure: ZodDefault → ZodOptional → ActualType
      if (zodField._def?.type === 'default') {
        isOptional = true;
        innerType = zodField._def.innerType;
        console.log(`🔄 [GeminiToolService] Unwrapping ZodDefault for ${key}`);
      }

      if (innerType._def?.type === 'optional') {
        isOptional = true;
        innerType = innerType._def.innerType;
        console.log(`🔄 [GeminiToolService] Unwrapping ZodOptional for ${key}`);
      }

      // Get the actual type by checking the innerType structure recursively
      let actualType = null;

      // Debug logging for type detection - enhanced
      console.log(`🔍 [GeminiToolService] Analyzing Zod structure for ${key}:`, {
        zodField_defTypeName: zodField._def?.typeName,
        zodField_type: zodField.type,
        innerType_defTypeName: innerType._def?.typeName,
        innerType_type: innerType.type,
        innerType_defType: innerType._def?.type,
        hasInnerType: !!innerType,
        hasZodFieldDef: !!zodField._def,
        hasInnerTypeDef: !!innerType._def,
        originalType: zodField.type
      });

      // Navigate through nested wrappers to find the actual type
      let currentType = innerType;
      while (currentType && actualType === null) {
        // Check for direct type property (most common)
        if (currentType.type && ['string', 'number', 'boolean', 'object', 'array'].includes(currentType.type)) {
          actualType = currentType.type;
          break;
        }

        // Check _def.type (Zod primitives)
        if (currentType._def?.type && ['string', 'number', 'boolean', 'object', 'array'].includes(currentType._def.type)) {
          actualType = currentType._def.type;
          break;
        }

        // Check for ZodDefault type - unwrap to innerType
        if (currentType._def?.type === 'default' && currentType._def.innerType) {
          console.log(`🔄 [GeminiToolService] Unwrapping ZodDefault for ${key}`);
          currentType = currentType._def.innerType;
          continue;
        }

        // Check for ZodOptional type - unwrap to innerType
        if (currentType._def?.type === 'optional' && currentType._def.innerType) {
          console.log(`🔄 [GeminiToolService] Unwrapping ZodOptional for ${key}`);
          currentType = currentType._def.innerType;
          continue;
        }

        // Move to innerType if available
        if (currentType.innerType) {
          currentType = currentType.innerType;
          continue;
        }

        // Can't find type, break
        break;
      }

      // Additional check: if we still haven't found the type, try direct typeName inspection
      if (!actualType && innerType._def?.typeName) {
        const typeName = innerType._def.typeName;
        console.log(`🔍 [GeminiToolService] Using direct typeName inspection for ${key}: ${typeName}`);

        if (typeName === 'ZodNumber') actualType = 'number';
        else if (typeName === 'ZodBoolean') actualType = 'boolean';
        else if (typeName === 'ZodString') actualType = 'string';
        else if (typeName === 'ZodObject') actualType = 'object';
        else if (typeName === 'ZodArray') actualType = 'array';
      }

      // Enhanced fallback with better detection
      if (!actualType) {
        // Try to determine from the field's def structure at different levels
        let checkField = zodField;
        let checkInner = innerType;

        // Check both the original field and the unwrapped inner type
        for (const fieldToCheck of [checkField, checkInner]) {
          if (fieldToCheck._def?.typeName === 'ZodNumber') { actualType = 'number'; break; }
          else if (fieldToCheck._def?.typeName === 'ZodBoolean') { actualType = 'boolean'; break; }
          else if (fieldToCheck._def?.typeName === 'ZodString') { actualType = 'string'; break; }
          else if (fieldToCheck._def?.typeName === 'ZodObject') { actualType = 'object'; break; }
          else if (fieldToCheck._def?.typeName === 'ZodArray') { actualType = 'array'; break; }
        }

        // Final fallback if still not found
        if (!actualType) {
          actualType = 'string'; // safe fallback
        }
      }

      console.log(`✅ [GeminiToolService] Detected type for ${key}: ${actualType}`);
      console.log(`🔍 [GeminiToolService] Processing ${key}: type=${actualType}, rawValue=${rawValue}, optional=${isOptional}`);

      // Convert based on expected type
      try {
        switch (actualType) {
          case 'number':
            let numValue = rawValue;
            if (typeof rawValue === 'string') {
              numValue = parseFloat(rawValue);
            }
            if (isNaN(numValue)) {
              throw new Error(`Invalid number for ${key}: ${rawValue}`);
            }
            convertedArgs[key] = numValue;
            console.log(`✅ [GeminiToolService] Converted ${key}: ${rawValue} → ${numValue} (number)`);
            break;

          case 'boolean':
            let boolValue = rawValue;
            if (typeof rawValue === 'string') {
              const lowerVal = rawValue.toLowerCase();
              boolValue = lowerVal === 'true' || lowerVal === '1' || lowerVal === 'yes';
            } else {
              boolValue = Boolean(rawValue);
            }
            convertedArgs[key] = boolValue;
            console.log(`✅ [GeminiToolService] Converted ${key}: ${rawValue} → ${boolValue} (boolean)`);
            break;

          case 'object':
            let objValue = rawValue;
            if (typeof rawValue === 'string') {
              try {
                objValue = JSON.parse(rawValue);
              } catch {
                console.warn(`⚠️ Could not parse JSON for ${key}, using empty object`);
                objValue = {};
              }
            } else if (typeof rawValue !== 'object') {
              objValue = {};
            }
            convertedArgs[key] = objValue;
            console.log(`✅ [GeminiToolService] Converted ${key}: ${rawValue} → ${objValue} (object)`);
            break;

          case 'array':
            let arrValue = rawValue;
            if (typeof rawValue === 'string') {
              try {
                arrValue = JSON.parse(rawValue);
              } catch {
                console.warn(`⚠️ Could not parse array for ${key}, using empty array`);
                arrValue = [];
              }
            } else if (!Array.isArray(rawValue)) {
              arrValue = [rawValue];
            }
            convertedArgs[key] = arrValue;
            console.log(`✅ [GeminiToolService] Converted ${key}: ${rawValue} → ${arrValue} (array)`);
            break;

          case 'string':
          default:
            // For strings and other types, use as-is
            convertedArgs[key] = rawValue;
            console.log(`✅ [GeminiToolService] Kept ${key} as string: ${rawValue}`);
            break;
        }
      } catch (error) {
        console.warn(`⚠️ Error converting ${key}: ${error}, using original value`);
        convertedArgs[key] = rawValue;
      }
    }

    console.log(`✅ [GeminiToolService] Final converted arguments:`, convertedArgs);
    return convertedArgs;
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

      // Get system instructions (only once, not per message)
      let systemInstructions = '';
      try {
        if (typeof window === 'undefined') {
          const { RawMaterialsAgent } = require('../../agents/raw-materials-ai/agent');
          systemInstructions = RawMaterialsAgent.getInstructions();
        } else {
          systemInstructions = this.getDefaultSystemInstructions();
        }
      } catch (error) {
        console.warn('⚠️ [GeminiToolService] Could not load system instructions:', error);
      }

      // Create model with tools AND system instruction
      const model = this.genAI.getGenerativeModel({
        model: adjustedConfig.model,
        generationConfig: {
          temperature: adjustedConfig.temperature,
          maxOutputTokens: adjustedConfig.maxTokens,
        },
        systemInstruction: systemInstructions || undefined,
        tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined
      });

      // Use ONLY the user's prompt, without repeating system instructions
      const enhancedPrompt = request.prompt;

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

          // Get tool definition for argument conversion
          const toolDefinition = this.toolRegistry.get_tool(functionCall.name);
          if (!toolDefinition) {
            console.error(`❌ [GeminiToolService] Tool not found: ${functionCall.name}`);
            functionResults.push({
              functionResponse: {
                name: functionCall.name,
                response: { error: `Tool not found: ${functionCall.name}` }
              }
            });
            continue;
          }

          // Convert and validate arguments
          const convertedArgs = this.convert_and_validate_arguments(toolDefinition, functionCall.args);

          const toolResult = await this.toolRegistry.execute_tool({
            name: functionCall.name,
            arguments: convertedArgs
          });

          // Transform response to prioritize table_display if present
          let responseData = toolResult.success ? toolResult.data : { error: toolResult.error };

          if (toolResult.success && toolResult.data && toolResult.data.table_display) {
            // 🔴 CRITICAL: Wrap table in special markers to prevent AI from modifying it
            // Gemini was stripping pipe characters even when told not to
            // Solution: Present as "pre-formatted output" that must be copied verbatim
            const wrappedTable = `📊 **DATABASE QUERY RESULTS** (Output this section EXACTLY as shown below)\n\n${toolResult.data.table_display}\n\n*(End of database results - Add your expert analysis AFTER this point)*`;

            responseData = {
              // Single field: pre-formatted output ready to display
              formatted_output: wrappedTable,
              // Instruction embedded in the output itself
              summary: `Found ${toolResult.data.returned || 0} materials from ${toolResult.data.database}. The table above is pre-formatted markdown - copy it EXACTLY to your response without modification.`,
              // IMPORTANT: Do NOT include raw materials array
            };

            console.log(`🎯 [GeminiToolService] Transformed response to prioritize table_display with protection markers`);
          }

          functionResults.push({
            functionResponse: {
              name: functionCall.name,
              response: responseData
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
   * Override enhancePrompt to include tool instructions
   */
  protected enhancePrompt(
    originalPrompt: string,
    preferences: any,
    feedbackPatterns: any
  ): string {
    // Get the enhanced system prompt from RawMaterialsAgent (server-side only)
    // Use dynamic import to prevent client-side bundling of MongoDB dependencies
    let systemInstructions = '';

    try {
      // Only try to load system instructions on server side
      if (typeof window === 'undefined') {
        const { RawMaterialsAgent } = require('../../agents/raw-materials-ai/agent');
        systemInstructions = RawMaterialsAgent.getInstructions();
      } else {
        // Client-side fallback - use basic instructions
        systemInstructions = this.getDefaultSystemInstructions();
      }

      // Combine system instructions with user prompt
      let enhancedPrompt = `SYSTEM INSTRUCTIONS:
${systemInstructions}

USER QUERY:
${originalPrompt}`;

      // Add feedback-based instructions if available
      const feedbackInstructions = this.generateFeedbackInstructions?.(feedbackPatterns);
      if (feedbackInstructions) {
        enhancedPrompt = `${enhancedPrompt}\n\nFEEDBACK GUIDANCE:\n${feedbackInstructions}`;
      }

      // Add user preference instructions if available
      const preferenceInstructions = this.generateGeminiPreferenceInstructions?.(preferences);
      if (preferenceInstructions) {
        enhancedPrompt = `${enhancedPrompt}\n\nUSER PREFERENCES:\n${preferenceInstructions}`;
      }

      console.log('📝 [GeminiToolService] Enhanced prompt with system instructions');
      return enhancedPrompt;
    } catch (error) {
      console.warn('⚠️ [GeminiToolService] Could not load system instructions, using original prompt:', error);
      return originalPrompt;
    }
  }

  /**
   * Helper method to generate feedback instructions (if not available in parent)
   */
  private generateFeedbackInstructions(feedbackPatterns: any): string {
    if (!feedbackPatterns || !feedbackPatterns.suggestions) {
      return '';
    }
    return feedbackPatterns.suggestions.map((suggestion: string) => `- ${suggestion}`).join('\n');
  }

  /**
   * Helper method to generate preference instructions (if not available in parent)
   */
  private generateGeminiPreferenceInstructions(preferences: any): string {
    if (!preferences) {
      return '';
    }

    const instructions = [];
    if (preferences.responseStyle) {
      instructions.push(`Response style: ${preferences.responseStyle}`);
    }
    if (preferences.detailLevel) {
      instructions.push(`Detail level: ${preferences.detailLevel}`);
    }
    if (preferences.language) {
      instructions.push(`Language: ${preferences.language}`);
    }

    return instructions.join('\n');
  }

  /**
   * Default system instructions for client-side usage
   * This avoids importing MongoDB-dependent services on the client
   */
  private getDefaultSystemInstructions(): string {
    return `
You are Dr. Arun "Ake" Prasertkul, R&D Raw Material Specialist.

🔥 **CRITICAL: ALWAYS USE TOOLS - NEVER GIVE DIRECT ADVICE WITHOUT SEARCHING!** 🔥

Available Tools:
1. search_fda_database - Search FDA database for ingredients/materials (31,179 items)
2. check_stock_availability - Check stock availability (3,111 items)
3. get_material_profile - Get detailed material profile with benefits and use cases
4. search_materials_by_usecase - Find materials for specific product types (serum, cream, mask)

**MANDATORY TOOL USAGE FOR THESE QUERY TYPES:**

✅ **ALWAYS CALL search_fda_database WHEN USER ASKS:**
- "แนะนำ..." (recommend...)
- "หา..." (find...)
- "ค้นหา..." (search...)
- "มีอะไร..." (what is there...)
- "สารสำหรับ..." (ingredients for...)
- "วัตถุดิบสำหรับ..." (materials for...)
- "list X ingredients"
- Any request for ingredient recommendations

✅ **ALWAYS CALL check_stock_availability WHEN USER ASKS:**
- "มี...ไหม" (do you have...)
- "สั่งได้ไหม" (can I order...)
- "เรามี..." (do we have...)

✅ **ALWAYS CALL get_material_profile WHEN USER ASKS:**
- "สารนี้ทำอะไร" (what does this ingredient do)
- "...ใช้ทำอะไร" (what is ... used for)

**QUERY EXAMPLES → TOOL CALLS:**
- "แนะนำ สาร 5 ตัวที่ช่วยลดสิว" → search_fda_database(query="ลดสิว", limit=5)
- "หาวัตถุดิบสำหรับใบหน้า" → search_fda_database(query="ใบหน้า", limit=5)
- "list antioxidant ingredients" → search_fda_database(query="antioxidant", limit=5)
- "มี vitamin C ไหม" → check_stock_availability(query="vitamin C")

⚠️ **WARNING: NEVER respond with general advice without calling tools first!**
⚠️ **If search returns 0 results, suggest alternative search terms in English/Thai!**

**RESPONSE FORMAT:**
1. Call tool first
2. Present results in table format
3. Add expert analysis
`;
  }

  /**
   * Override token estimation for Gemini's tokenizer
   */
  protected estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
  }
}
