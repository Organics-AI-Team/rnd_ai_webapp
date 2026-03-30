/**
 * ReactAgentService — ReAct (Reason + Act) Agent with Gemini Function Calling
 *
 * Implements a Thought -> Action -> Observation -> Answer loop using
 * Google Gemini's native function calling. Routes tool calls to dedicated
 * handlers for Qdrant search, MongoDB queries, formula calculations,
 * web search, context memory retrieval, formula generation, reference
 * formula search, formula revision, and formula-with-comments loading.
 *
 * @author AI Management System
 * @date 2026-03-27
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  get_react_tool_declarations,
  ReactToolName,
} from './tool-definitions';
import { get_react_system_prompt } from './react-system-prompt';

// Tool handler imports — files created by parallel tasks.
// If a handler does not exist yet, runtime will throw a clear error on first call.
import { handle_qdrant_search } from './tool-handlers/qdrant-search-handler';
import { handle_mongo_query } from './tool-handlers/mongo-query-handler';
import { handle_formula_calculate } from './tool-handlers/formula-calc-handler';
import { handle_web_search } from './tool-handlers/web-search-handler';
import { handle_context_memory } from './tool-handlers/context-memory-handler';
import { handle_generate_formula } from './tool-handlers/generate-formula-handler';
import { handle_search_reference_formulas } from './tool-handlers/search-reference-formulas-handler';
import { handle_revise_formula } from './tool-handlers/revise-formula-handler';
import { handle_get_formula_with_comments } from './tool-handlers/get-formula-with-comments-handler';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Runtime configuration for the ReactAgentService.
 *
 * @property model          - Gemini model identifier. Default 'gemini-2.0-flash'.
 * @property temperature    - Sampling temperature (0-2). Default 0.7.
 * @property max_tokens     - Maximum output tokens per generation. Default 9000.
 * @property max_iterations - ReAct loop ceiling to prevent runaway calls. Default 5.
 */
export interface ReactAgentConfig {
  model: string;
  temperature: number;
  max_tokens: number;
  max_iterations: number;
}

/**
 * Inbound request payload for the ReAct agent.
 *
 * @property prompt               - The user's natural-language query (required).
 * @property user_id              - Authenticated user identifier (required).
 * @property session_id           - Optional chat session ID for context_memory lookups.
 * @property conversation_history - Optional prior turns for multi-turn context.
 */
export interface ReactAgentRequest {
  prompt: string;
  user_id: string;
  session_id?: string;
  conversation_history?: Array<{ role: string; content: string }>;
}

/**
 * Structured response returned by the ReAct agent.
 *
 * @property response        - Final natural-language answer.
 * @property success         - Whether the agent completed without fatal errors.
 * @property tool_calls      - Ordered log of every tool invocation and its result.
 * @property iterations      - Number of ReAct loop iterations consumed.
 * @property processing_time - Wall-clock milliseconds from request to response.
 * @property model           - Gemini model identifier used for this request.
 */
export interface ReactAgentResponse {
  response: string;
  success: boolean;
  tool_calls: Array<{ name: string; args: Record<string, unknown>; result: string }>;
  iterations: number;
  processing_time: number;
  model: string;
}

// ---------------------------------------------------------------------------
// Default Configuration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ReactAgentConfig = {
  model: process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview',
  temperature: 0.7,
  max_tokens: 9000,
  max_iterations: 8,
};

// ---------------------------------------------------------------------------
// Tool Handler Router (maps tool name -> handler function)
// ---------------------------------------------------------------------------

/**
 * Central registry that maps each ReactToolName to its async handler.
 * Each handler receives (args, session_id?) and returns a serialised string result.
 */
const TOOL_HANDLER_MAP: Record<
  ReactToolName,
  (args: Record<string, unknown>, session_id?: string) => Promise<string>
> = {
  qdrant_search: (args) => handle_qdrant_search(args as any),
  mongo_query: (args) => handle_mongo_query(args as any),
  formula_calculate: (args) => handle_formula_calculate(args as any),
  web_search: (args) => handle_web_search(args as any),
  context_memory: (args) => handle_context_memory(args as any),
  generate_formula: (args) => handle_generate_formula(args as any),
  search_reference_formulas: (args) => handle_search_reference_formulas(args as any),
  revise_formula: (args) => handle_revise_formula(args as any),
  get_formula_with_comments: (args) => handle_get_formula_with_comments(args as any),
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * ReactAgentService
 *
 * Orchestrates the ReAct reasoning loop:
 *   1. Initialise Gemini model with tool declarations + system prompt.
 *   2. Feed user prompt (and optional history) into generateContent.
 *   3. Loop: if the model emits functionCall parts, execute each tool and
 *      feed results back as functionResponse parts.
 *   4. When the model emits a pure text part (or max_iterations is hit),
 *      return the final answer.
 */
export class ReactAgentService {
  private gen_ai: GoogleGenerativeAI;
  private config: ReactAgentConfig;

  /**
   * Create a new ReactAgentService instance.
   *
   * @param api_key         - Google AI API key. Falls back to GEMINI_API_KEY
   *                          or NEXT_PUBLIC_GEMINI_API_KEY env vars if omitted.
   * @param config_override - Partial config to merge over defaults.
   * @throws Error if no API key is available from any source.
   */
  constructor(api_key?: string, config_override?: Partial<ReactAgentConfig>) {
    console.log('[ReactAgentService] constructor() - start');

    const resolved_key =
      api_key ||
      process.env.GEMINI_API_KEY ||
      process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
      '';

    if (!resolved_key) {
      const error_message =
        'ReactAgentService requires a Gemini API key. Provide one via constructor, ' +
        'GEMINI_API_KEY, or NEXT_PUBLIC_GEMINI_API_KEY environment variable.';
      console.error(`[ReactAgentService] constructor() - ${error_message}`);
      throw new Error(error_message);
    }

    this.gen_ai = new GoogleGenerativeAI(resolved_key);
    this.config = { ...DEFAULT_CONFIG, ...config_override };

    console.log('[ReactAgentService] constructor() - initialised', {
      model: this.config.model,
      temperature: this.config.temperature,
      max_tokens: this.config.max_tokens,
      max_iterations: this.config.max_iterations,
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Execute the full ReAct loop for a user request.
   *
   * @param request - ReactAgentRequest containing prompt, user_id, and optional history.
   * @returns ReactAgentResponse with the final answer and tool-call trace.
   */
  async execute(request: ReactAgentRequest): Promise<ReactAgentResponse> {
    const start_time = Date.now();
    console.warn('[ReactAgentService] execute() - start', {
      user_id: request.user_id,
      session_id: request.session_id,
      prompt_length: request.prompt.length,
      history_turns: request.conversation_history?.length ?? 0,
      model: this.config.model,
    });

    const tool_calls: ReactAgentResponse['tool_calls'] = [];
    let iterations = 0;
    let final_response = '';

    try {
      // ----- 1. Build Gemini model with tools & system prompt -----
      const tool_declarations = get_react_tool_declarations();
      const system_prompt = get_react_system_prompt();

      const model = this.gen_ai.getGenerativeModel({
        model: this.config.model,
        generationConfig: {
          temperature: this.config.temperature,
          maxOutputTokens: this.config.max_tokens,
        },
        systemInstruction: system_prompt,
        tools: [{ functionDeclarations: tool_declarations as any }],
      });

      // ----- 2. Convert conversation history to Gemini Content format -----
      const contents = this._build_contents(request);

      // ----- 3. ReAct loop -----
      while (iterations < this.config.max_iterations) {
        iterations += 1;
        console.log(
          `[ReactAgentService] execute() - iteration ${iterations}/${this.config.max_iterations}`
        );

        const result = await model.generateContent({ contents });
        const candidate = result.response.candidates?.[0];

        if (!candidate?.content?.parts) {
          console.warn(
            '[ReactAgentService] execute() - no parts in candidate, breaking loop'
          );
          break;
        }

        // Separate function-call parts from text parts
        const function_call_parts = candidate.content.parts.filter(
          (p: any) => p.functionCall
        );
        const text_parts = candidate.content.parts.filter(
          (p: any) => p.text
        );

        // 3c. If response has only text parts -> final answer
        if (function_call_parts.length === 0) {
          final_response = text_parts.map((p: any) => p.text).join('');
          console.log(
            '[ReactAgentService] execute() - received text-only response, breaking loop'
          );
          break;
        }

        // 3b. If response has functionCall parts -> execute each tool
        // Add the model's response (with function calls) to contents
        contents.push({
          role: 'model',
          parts: candidate.content.parts as any,
        });

        const function_response_parts: any[] = [];

        for (const part of function_call_parts) {
          const fc = (part as any).functionCall;
          const tool_name: ReactToolName = fc.name;
          const tool_args: Record<string, unknown> = fc.args ?? {};

          console.log(
            `[ReactAgentService] execute() - tool call: ${tool_name}`,
            tool_args
          );

          const tool_result = await this._execute_tool(
            tool_name,
            tool_args,
            request.session_id
          );

          tool_calls.push({
            name: tool_name,
            args: tool_args,
            result: tool_result,
          });

          function_response_parts.push({
            functionResponse: {
              name: tool_name,
              response: { result: tool_result },
            },
          });
        }

        // Add tool results back to contents for the next iteration
        contents.push({
          role: 'user',
          parts: function_response_parts,
        });
      }

      // ----- 4. If max iterations hit without a text answer -----
      if (!final_response && tool_calls.length > 0) {
        console.warn(
          `[ReactAgentService] execute() - max iterations (${this.config.max_iterations}) reached, synthesising partial answer`
        );
        final_response = this._synthesise_partial_answer(tool_calls);
      } else if (!final_response) {
        final_response =
          'I was unable to generate a response. Please try rephrasing your question.';
      }

      const processing_time = Date.now() - start_time;

      console.warn('[ReactAgentService] execute() - complete', {
        iterations,
        tool_call_count: tool_calls.length,
        processing_time_ms: processing_time,
        response_length: final_response.length,
      });

      return {
        response: final_response,
        success: true,
        tool_calls,
        iterations,
        processing_time,
        model: this.config.model,
      };
    } catch (error: any) {
      const processing_time = Date.now() - start_time;
      console.error('[ReactAgentService] execute() - error', {
        message: error.message,
        stack: error.stack,
        iterations,
        tool_call_count: tool_calls.length,
      });

      return {
        response: `An error occurred while processing your request: ${error.message}`,
        success: false,
        tool_calls,
        iterations,
        processing_time,
        model: this.config.model,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Execute a single tool by name, routing through TOOL_HANDLER_MAP.
   *
   * @param tool_name  - One of the ReactToolName values.
   * @param args       - Arguments extracted from the model's functionCall.
   * @param session_id - Optional session ID forwarded to context_memory handler.
   * @returns Serialised string result (JSON or plain text).
   */
  private async _execute_tool(
    tool_name: ReactToolName,
    args: Record<string, unknown>,
    session_id?: string
  ): Promise<string> {
    console.log(`[ReactAgentService] _execute_tool() - start: ${tool_name}`);

    const handler = TOOL_HANDLER_MAP[tool_name];

    if (!handler) {
      const error_msg = `Unknown tool: ${tool_name}. Available tools: ${Object.keys(TOOL_HANDLER_MAP).join(', ')}`;
      console.error(`[ReactAgentService] _execute_tool() - ${error_msg}`);
      return JSON.stringify({ error: error_msg });
    }

    try {
      const result = await handler(args, session_id);
      console.log(
        `[ReactAgentService] _execute_tool() - complete: ${tool_name}, result_length=${result.length}`
      );
      return result;
    } catch (error: any) {
      console.error(
        `[ReactAgentService] _execute_tool() - error in ${tool_name}:`,
        error.message
      );
      return JSON.stringify({
        error: `Tool '${tool_name}' failed: ${error.message}`,
      });
    }
  }

  /**
   * Build the initial Gemini Content[] array from the request.
   * Converts conversation_history to Gemini's { role, parts } format
   * and appends the current user prompt as the final entry.
   *
   * @param request - The incoming ReactAgentRequest.
   * @returns Content[] ready for model.generateContent({ contents }).
   */
  private _build_contents(
    request: ReactAgentRequest
  ): Array<{ role: string; parts: any[] }> {
    console.log('[ReactAgentService] _build_contents() - start');

    const contents: Array<{ role: string; parts: any[] }> = [];

    // Append prior conversation history (if any)
    if (request.conversation_history && request.conversation_history.length > 0) {
      for (const turn of request.conversation_history) {
        contents.push({
          role: turn.role === 'user' ? 'user' : 'model',
          parts: [{ text: turn.content }],
        });
      }
      console.log(
        `[ReactAgentService] _build_contents() - added ${request.conversation_history.length} history turns`
      );
    }

    // Append current user prompt
    contents.push({
      role: 'user',
      parts: [{ text: request.prompt }],
    });

    console.log(
      `[ReactAgentService] _build_contents() - complete, total entries: ${contents.length}`
    );
    return contents;
  }

  /**
   * When max iterations are exhausted, synthesise a best-effort answer
   * from the accumulated tool results.
   *
   * @param tool_calls - Array of tool call records with names, args, and results.
   * @returns A human-readable summary string.
   */
  private _synthesise_partial_answer(
    tool_calls: ReactAgentResponse['tool_calls']
  ): string {
    console.log(
      '[ReactAgentService] _synthesise_partial_answer() - start',
      { tool_call_count: tool_calls.length }
    );

    const summary_lines: string[] = [
      'I reached the maximum number of reasoning steps. Here is what I found so far:\n',
    ];

    for (const call of tool_calls) {
      summary_lines.push(`**Tool: ${call.name}**`);

      // Attempt to parse JSON results for cleaner display
      try {
        const parsed = JSON.parse(call.result);
        if (parsed.error) {
          summary_lines.push(`- Error: ${parsed.error}`);
        } else {
          summary_lines.push(
            `- Result: ${JSON.stringify(parsed).slice(0, 500)}${
              JSON.stringify(parsed).length > 500 ? '...' : ''
            }`
          );
        }
      } catch {
        // Plain text result
        summary_lines.push(
          `- Result: ${call.result.slice(0, 500)}${
            call.result.length > 500 ? '...' : ''
          }`
        );
      }

      summary_lines.push('');
    }

    summary_lines.push(
      'Please refine your question if you need more specific information.'
    );

    const partial_answer = summary_lines.join('\n');
    console.log(
      '[ReactAgentService] _synthesise_partial_answer() - complete',
      { answer_length: partial_answer.length }
    );

    return partial_answer;
  }
}
