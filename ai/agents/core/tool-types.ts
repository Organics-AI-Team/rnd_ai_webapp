/**
 * Tool Types and Interfaces
 * Defines the contract for AI-callable tools
 */

import { z } from 'zod';

/**
 * Tool definition for AI function calling
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodObject<any>;
}

/**
 * Executable tool with handler function
 */
export interface Tool<TParams = any, TResult = any> {
  name: string;
  description: string;
  parameters: z.ZodObject<any>;
  handler: (params: TParams) => Promise<TResult>;
}

/**
 * Tool call request from AI
 */
export interface ToolCall {
  name: string;
  arguments: any;
  id?: string;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  toolName: string;
  executionTime?: number;
}

/**
 * Tool registry for managing available tools
 */
export interface ToolRegistry {
  register_tool(tool: Tool): void;
  get_tool(name: string): Tool | undefined;
  list_tools(): ToolDefinition[];
  has_tool(name: string): boolean;
  execute_tool(toolCall: ToolCall): Promise<ToolResult>;
}
