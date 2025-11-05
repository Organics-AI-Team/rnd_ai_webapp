/**
 * Tool Registry Implementation
 * Manages registration and execution of AI-callable tools
 */

import { Tool, ToolCall, ToolResult, ToolDefinition, ToolRegistry } from './tool-types';

/**
 * Default tool registry implementation
 */
export class DefaultToolRegistry implements ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  constructor() {
    console.log('🔧 [ToolRegistry] Initializing tool registry');
  }

  /**
   * Register a tool
   */
  register_tool(tool: Tool): void {
    console.log(`📝 [ToolRegistry] Registering tool: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  /**
   * Get a tool by name
   */
  get_tool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * List all available tool definitions (for AI)
   */
  list_tools(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }));
  }

  /**
   * Check if tool exists
   */
  has_tool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Execute a tool call
   */
  async execute_tool(toolCall: ToolCall): Promise<ToolResult> {
    const startTime = Date.now();
    console.log(`🔧 [ToolRegistry] Executing tool: ${toolCall.name}`, toolCall.arguments);

    const tool = this.get_tool(toolCall.name);

    if (!tool) {
      console.error(`❌ [ToolRegistry] Tool not found: ${toolCall.name}`);
      return {
        success: false,
        error: `Tool "${toolCall.name}" not found`,
        toolName: toolCall.name,
        executionTime: Date.now() - startTime
      };
    }

    try {
      // Enhanced parameter validation with detailed error reporting
      console.log(`🔍 [ToolRegistry] Validating parameters for ${toolCall.name}:`, toolCall.arguments);

      const validatedParams = tool.parameters.parse(toolCall.arguments);
      console.log(`✅ [ToolRegistry] Parameters validated successfully for ${toolCall.name}:`, validatedParams);

      // Execute tool handler
      const result = await tool.handler(validatedParams);

      const executionTime = Date.now() - startTime;
      console.log(`✅ [ToolRegistry] Tool executed successfully: ${toolCall.name} (${executionTime}ms)`);

      return {
        success: true,
        data: result,
        toolName: toolCall.name,
        executionTime
      };
    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      console.error(`❌ [ToolRegistry] Tool execution failed: ${toolCall.name}`, error);

      // Enhanced error reporting
      let errorMessage = error.message || 'Unknown error';

      if (error.name === 'ZodError') {
        const fieldErrors = error.errors?.map((err: any) =>
          `${err.path?.join('.')}: ${err.message}`
        ).join(', ') || 'Validation failed';
        errorMessage = `Parameter validation failed: ${fieldErrors}`;
        console.error(`🔍 [ToolRegistry] Validation details:`, error.errors);
      }

      return {
        success: false,
        error: errorMessage,
        toolName: toolCall.name,
        executionTime,
        // Add hint for common issues
        hint: errorMessage.includes('Invalid input')
          ? 'Check that parameter types match expectations (strings, numbers, booleans)'
          : undefined
      };
    }
  }
}

/**
 * Get singleton tool registry instance
 */
let registryInstance: DefaultToolRegistry | null = null;

export function get_tool_registry(): DefaultToolRegistry {
  if (!registryInstance) {
    registryInstance = new DefaultToolRegistry();
  }
  return registryInstance;
}
