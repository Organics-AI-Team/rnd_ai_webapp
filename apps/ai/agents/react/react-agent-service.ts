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
import type { ToolHandlerContext } from './types';

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
import { handle_confirm_formula } from './tool-handlers/confirm-formula-handler';

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

// Re-export ToolHandlerContext for backward compatibility
export type { ToolHandlerContext } from './types';

/**
 * Inbound request payload for the ReAct agent.
 *
 * @property prompt               - The user's natural-language query (required).
 * @property user_id              - Authenticated user identifier (required).
 * @property organization_id      - User's organization ID for DB writes (optional).
 * @property session_id           - Optional chat session ID for context_memory lookups.
 * @property conversation_history - Optional prior turns for multi-turn context.
 */
export interface ReactAgentRequest {
  prompt: string;
  user_id: string;
  organization_id?: string;
  session_id?: string;
  conversation_history?: Array<{ role: string; content: string }>;
}

export interface ReactAgentArtifact {
  language: 'th' | 'en';
  processSteps: Array<{ key: string; label: string }>;
  formula?: Record<string, any>;
  citations?: Array<{
    source: string;
    rm_code?: string;
    inci_name?: string;
    trade_name?: string;
    score?: number;
  }>;
  warnings?: Array<{ severity?: string; message: string }>;
  quickActions?: Array<{ label: string; prompt?: string; href?: string }>;
  partial?: boolean;
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
  artifacts: ReactAgentArtifact;
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

const TERMINAL_TOOL_NAMES = new Set<ReactToolName>([
  'generate_formula',
  'revise_formula',
  'confirm_formula',
]);

// ---------------------------------------------------------------------------
// Tool Handler Router (maps tool name -> handler function)
// ---------------------------------------------------------------------------

/**
 * Central registry that maps each ReactToolName to its async handler.
 * Each handler receives (args, context?) and returns a serialised string result.
 * Context carries user_id, organization_id, session_id for DB persistence.
 */
const TOOL_HANDLER_MAP: Record<
  ReactToolName,
  (args: Record<string, unknown>, context?: ToolHandlerContext) => Promise<string>
> = {
  qdrant_search: (args) => handle_qdrant_search(args as any),
  mongo_query: (args) => handle_mongo_query(args as any),
  formula_calculate: (args) => handle_formula_calculate(args as any),
  web_search: (args) => handle_web_search(args as any),
  context_memory: (args, ctx) => handle_context_memory(args as any),
  generate_formula: (args, ctx) => handle_generate_formula(args as any, ctx),
  search_reference_formulas: (args) => handle_search_reference_formulas(args as any),
  revise_formula: (args, ctx) => handle_revise_formula(args as any, ctx),
  get_formula_with_comments: (args) => handle_get_formula_with_comments(args as any),
  confirm_formula: (args, ctx) => handle_confirm_formula(args as any, ctx),
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
    const response_language = this._detect_language(request.prompt);
    let artifacts: ReactAgentArtifact = {
      language: response_language,
      processSteps: [],
    };

    // Build handler context from request for DB persistence
    const handler_context: ToolHandlerContext = {
      user_id: request.user_id,
      organization_id: request.organization_id,
      session_id: request.session_id,
    };

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
            handler_context
          );

          tool_calls.push({
            name: tool_name,
            args: tool_args,
            result: tool_result,
          });
          artifacts = this._build_artifacts(tool_calls, response_language);

          if (TERMINAL_TOOL_NAMES.has(tool_name) && !this._tool_result_has_error(tool_result)) {
            final_response = this._format_terminal_tool_response(tool_name, tool_result, response_language);
            console.log(
              `[ReactAgentService] execute() - terminal tool ${tool_name} completed, returning formatted response`
            );
            break;
          }

          function_response_parts.push({
            functionResponse: {
              name: tool_name,
              response: { result: tool_result },
            },
          });
        }

        if (final_response) {
          break;
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
        artifacts = { ...this._build_artifacts(tool_calls, response_language), partial: true };
        final_response = this._synthesise_partial_answer(tool_calls, response_language);
      } else if (!final_response) {
        final_response = response_language === 'th'
          ? 'ยังสร้างคำตอบไม่ได้ กรุณาลองปรับคำถามให้เฉพาะเจาะจงขึ้น'
          : 'I was unable to generate a response. Please try rephrasing your question.';
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
        artifacts,
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
        response: response_language === 'th'
          ? `เกิดข้อผิดพลาดระหว่างประมวลผล: ${error.message}`
          : `An error occurred while processing your request: ${error.message}`,
        success: false,
        tool_calls,
        artifacts: { ...artifacts, partial: true },
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
   * @param tool_name - One of the ReactToolName values.
   * @param args      - Arguments extracted from the model's functionCall.
   * @param context   - User/org context forwarded to handlers for DB writes.
   * @returns Serialised string result (JSON or plain text).
   */
  private async _execute_tool(
    tool_name: ReactToolName,
    args: Record<string, unknown>,
    context?: ToolHandlerContext
  ): Promise<string> {
    console.log(`[ReactAgentService] _execute_tool() - start: ${tool_name}`);

    const handler = TOOL_HANDLER_MAP[tool_name];

    if (!handler) {
      const error_msg = `Unknown tool: ${tool_name}. Available tools: ${Object.keys(TOOL_HANDLER_MAP).join(', ')}`;
      console.error(`[ReactAgentService] _execute_tool() - ${error_msg}`);
      return JSON.stringify({ error: error_msg });
    }

    try {
      const result = await handler(args, context);
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
    tool_calls: ReactAgentResponse['tool_calls'],
    language: 'th' | 'en' = 'th',
  ): string {
    console.log(
      '[ReactAgentService] _synthesise_partial_answer() - start',
      { tool_call_count: tool_calls.length }
    );

    const terminal_call = [...tool_calls]
      .reverse()
      .find((call) => TERMINAL_TOOL_NAMES.has(call.name as ReactToolName));
    if (terminal_call && !this._tool_result_has_error(terminal_call.result)) {
      return this._format_terminal_tool_response(
        terminal_call.name as ReactToolName,
        terminal_call.result,
        language,
      );
    }

    const search_calls = tool_calls.filter((call) => call.name === 'qdrant_search');
    if (search_calls.length > 0) {
      return this._format_search_fallback(search_calls[search_calls.length - 1].result, language);
    }

    const summary_lines: string[] = language === 'th'
      ? [
          'ขออภัย ระบบใช้เวลาคิดครบขีดจำกัดก่อนสรุปคำตอบได้สมบูรณ์',
          '',
          'ข้อมูลบางส่วนถูกค้นคืนแล้ว แต่ยังไม่ได้สังเคราะห์เป็นคำตอบสุดท้าย กรุณาลองถามให้แคบลงหรือแบ่งคำถามเป็นส่วนย่อย เช่น สูตร, วัตถุดิบ, หรือราคา batch',
        ]
      : [
          'The agent reached its reasoning limit before completing a final answer.',
          '',
          'Some data was retrieved, but it was not fully synthesized. Please narrow the question or split it into formula, ingredient, or cost steps.',
        ];

    const partial_answer = summary_lines.join('\n');
    console.log(
      '[ReactAgentService] _synthesise_partial_answer() - complete',
      { answer_length: partial_answer.length }
    );

    return partial_answer;
  }

  private _tool_result_has_error(result: string): boolean {
    try {
      const parsed = JSON.parse(result);
      return Boolean(parsed?.error);
    } catch {
      return /^error:/i.test(result.trim()) || result.toLowerCase().includes(' failed ');
    }
  }

  private _format_terminal_tool_response(
    tool_name: ReactToolName,
    result: string,
    language: 'th' | 'en' = 'th',
  ): string {
    try {
      const parsed = JSON.parse(result);
      if (parsed?.error) {
        return language === 'th'
          ? `ขออภัย พบปัญหาในการประมวลผล: ${parsed.error}`
          : `There was a processing issue: ${parsed.error}`;
      }

      if (tool_name === 'generate_formula') {
        return this._format_generated_formula(parsed, language);
      }

      if (tool_name === 'confirm_formula') {
        const title = language === 'th' ? 'ยืนยันสูตรเรียบร้อยแล้ว' : 'Formula confirmed';
        return [
          title,
          '',
          parsed.formula_code ? `- Formula code: ${parsed.formula_code}` : null,
          parsed.version ? `- Version: v${String(parsed.version).padStart(2, '0')}` : null,
          parsed.status ? `- Status: ${parsed.status}` : null,
        ].filter(Boolean).join('\n');
      }

      if (tool_name === 'revise_formula') {
        return this._format_generated_formula(parsed, language);
      }
    } catch {
      // Fall through to plain text cleanup below.
    }

    return result
      .replace(/^Result:\s*/i, '')
      .slice(0, 4000);
  }

  private _format_generated_formula(
    formula: Record<string, any>,
    language: 'th' | 'en' = 'th',
  ): string {
    const lines: string[] = [];
    const name = formula.formula_name || formula.formulaName || 'AI-generated formula';
    const batch_size = formula.batch_size_grams || formula.totalAmount || 100;

    lines.push(`## ${name}`);
    lines.push('');
    lines.push(language === 'th'
      ? `สร้างสูตร draft สำหรับ **${formula.product_type || 'cosmetic product'}** ขนาด batch ${batch_size} g แล้ว`
      : `Draft formula created for **${formula.product_type || 'cosmetic product'}**, batch size ${batch_size} g`);

    if (Array.isArray(formula.target_benefits) && formula.target_benefits.length > 0) {
      lines.push(language === 'th'
        ? `เป้าหมาย: ${formula.target_benefits.join(', ')}`
        : `Targets: ${formula.target_benefits.join(', ')}`);
    }

    if (formula.formula_code || formula.formula_id) {
      lines.push('');
      lines.push(language === 'th' ? '**บันทึกในระบบแล้ว**' : '**Saved to system**');
      if (formula.formula_code) lines.push(`- Code: ${formula.formula_code}`);
      if (formula.formula_id) lines.push(`- ID: ${formula.formula_id}`);
      lines.push('- Status: draft v0');
    }

    lines.push('');
    lines.push(language === 'th'
      ? `รวม: **${formula.total_percentage ?? '100'}%**`
      : `Total: **${formula.total_percentage ?? '100'}%**`);
    if (formula.estimated_cost_thb != null) {
      lines.push(language === 'th'
        ? `ต้นทุนประมาณ: **${formula.estimated_cost_thb} THB / ${batch_size} g**`
        : `Estimated cost: **${formula.estimated_cost_thb} THB / ${batch_size} g**`);
    }

    if (Array.isArray(formula.warnings) && formula.warnings.length > 0) {
      lines.push('');
      lines.push(language === 'th'
        ? `มีจุดที่ต้องตรวจสอบ ${formula.warnings.length} รายการ ดูรายละเอียดในกล่องสูตรด้านล่าง`
        : `${formula.warnings.length} review item(s) found. See the formula panel below.`);
    }

    lines.push('');
    lines.push(language === 'th'
      ? 'ควรให้ R&D ตรวจ stability, pH, preservative efficacy และผล SPF/PA ตาม lab protocol ก่อนผลิตจริง'
      : 'R&D should validate stability, pH, preservative efficacy, and SPF/PA results before production.');

    if (formula.formula_id) {
      lines.push('');
      lines.push(language === 'th'
        ? 'ถ้าตรวจแล้วใช้ได้ สามารถกด action หรือพิมพ์ confirm สูตรนี้ เพื่อบันทึกเป็น v01'
        : 'If this draft is acceptable, use the confirm action or type confirm to save it as v01.');
    }

    return lines.join('\n');
  }

  private _format_search_fallback(result: string, language: 'th' | 'en' = 'th'): string {
    const cleaned = result
      .replace(/^Qdrant search results\s+—/i, 'ผลค้นหา RAG:')
      .replace(/─{3,}/g, '')
      .trim();

    if (language === 'en') {
      return [
        'RAG search completed, but the agent timed out before fully synthesizing the answer.',
        '',
        cleaned.slice(0, 2500),
        '',
        'Try narrowing the request, for example: choose the top 5, generate a formula, or calculate cost.',
      ].join('\n');
    }

    return [
      'ระบบค้นข้อมูลจาก RAG ได้แล้ว แต่ยังสรุปคำตอบไม่ทันภายในรอบการคิดที่กำหนด',
      '',
      cleaned.slice(0, 2500),
      '',
      'ลองถามแบบเจาะจงขึ้น เช่น ต้องการ “เลือก 5 ตัวที่เหมาะสุด”, “ทำสูตร”, หรือ “คำนวณต้นทุน”',
    ].join('\n');
  }

  private _detect_language(prompt: string): 'th' | 'en' {
    return /[\u0E00-\u0E7F]/.test(prompt) ? 'th' : 'en';
  }

  private _build_artifacts(
    tool_calls: ReactAgentResponse['tool_calls'],
    language: 'th' | 'en',
  ): ReactAgentArtifact {
    const latest_formula_call = [...tool_calls]
      .reverse()
      .find((call) => ['generate_formula', 'revise_formula'].includes(call.name));
    const raw_formula = latest_formula_call ? this._parse_json(latest_formula_call.result) : undefined;
    const formula = raw_formula && !raw_formula.error
      ? this._normalize_formula_artifact(raw_formula)
      : raw_formula;
    const citations = this._build_citations(tool_calls, formula);
    const warnings = Array.isArray(formula?.warnings)
      ? formula.warnings.map((warning: any) => ({
          severity: warning.severity,
          message: String(warning.message || warning),
        }))
      : [];

    return {
      language,
      processSteps: this._build_process_steps(tool_calls, language),
      formula: formula && !formula.error ? formula : undefined,
      citations,
      warnings,
      quickActions: this._build_quick_actions(formula, language),
    };
  }

  private _parse_json(value: string): Record<string, any> | undefined {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  private _normalize_formula_artifact(formula: Record<string, any>): Record<string, any> {
    if (Array.isArray(formula.ingredients)) {
      return formula;
    }

    const phases = formula.phases;
    if (!phases || typeof phases !== 'object') {
      return formula;
    }

    const ingredients: Record<string, any>[] = [];
    for (const [phase_label, phase_ingredients] of Object.entries(phases)) {
      if (!Array.isArray(phase_ingredients)) continue;

      for (const ingredient of phase_ingredients) {
        if (!ingredient || typeof ingredient !== 'object') continue;
        ingredients.push({
          phase: (ingredient as Record<string, any>).phase || phase_label,
          phase_label,
          ...(ingredient as Record<string, any>),
        });
      }
    }

    const total_percentage = ingredients.reduce((sum, ingredient) => {
      const percentage = Number(ingredient.percentage);
      return Number.isFinite(percentage) ? sum + percentage : sum;
    }, 0);

    return {
      ...formula,
      ingredients,
      total_percentage: formula.total_percentage ?? Number(total_percentage.toFixed(4)),
    };
  }

  private _build_process_steps(
    tool_calls: ReactAgentResponse['tool_calls'],
    language: 'th' | 'en',
  ): Array<{ key: string; label: string }> {
    const labels: Record<string, { th: string; en: string }> = {
      qdrant_search: { th: 'ค้นวัตถุดิบจากฐานข้อมูล RAG', en: 'Searched ingredient RAG database' },
      mongo_query: { th: 'ค้นข้อมูลแบบ exact match ใน MongoDB', en: 'Looked up exact records in MongoDB' },
      formula_calculate: { th: 'คำนวณสูตรหรือต้นทุน', en: 'Calculated formula or cost' },
      web_search: { th: 'ค้นข้อมูลภายนอก', en: 'Searched external sources' },
      context_memory: { th: 'อ่านบริบทจากแชทก่อนหน้า', en: 'Loaded prior chat context' },
      generate_formula: { th: 'สร้างสูตร draft', en: 'Generated draft formula' },
      search_reference_formulas: { th: 'ค้นสูตรอ้างอิง', en: 'Searched reference formulas' },
      revise_formula: { th: 'ปรับสูตรตาม feedback', en: 'Revised formula from feedback' },
      get_formula_with_comments: { th: 'อ่านสูตรและคอมเมนต์', en: 'Loaded formula comments' },
      confirm_formula: { th: 'ยืนยันสูตรเป็น version ทางการ', en: 'Confirmed formula version' },
    };

    return [...new Set(tool_calls.map((call) => call.name))].map((key) => ({
      key,
      label: labels[key]?.[language] || key.replace(/_/g, ' '),
    }));
  }

  private _build_citations(
    tool_calls: ReactAgentResponse['tool_calls'],
    formula?: Record<string, any>,
  ): ReactAgentArtifact['citations'] {
    const citations: ReactAgentArtifact['citations'] = [];

    if (Array.isArray(formula?.ingredients)) {
      for (const ing of formula.ingredients.slice(0, 12)) {
        if (ing.rm_code && ing.rm_code !== 'WATER' && ing.rm_code !== 'AUTO') {
          citations.push({
            source: 'raw_materials_myskin',
            rm_code: ing.rm_code,
            inci_name: ing.inci_name,
            trade_name: ing.trade_name,
            score: ing.score,
          });
        }
      }
    }

    for (const call of tool_calls.filter((item) => item.name === 'qdrant_search')) {
      citations.push({
        source: String(call.args.collection || 'raw_materials_myskin'),
      });
    }

    const seen = new Set<string>();
    return citations.filter((item) => {
      const key = `${item.source}:${item.rm_code || item.inci_name || item.trade_name || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 12);
  }

  private _build_quick_actions(
    formula: Record<string, any> | undefined,
    language: 'th' | 'en',
  ): ReactAgentArtifact['quickActions'] {
    if (!formula || formula.error) return [];

    const formula_id = formula.formula_id;
    if (language === 'en') {
      return [
        formula_id ? { label: 'Confirm v01', prompt: `confirm formula ${formula_id}` } : null,
        { label: 'Lighter texture', prompt: 'Revise this formula to make the texture lighter and less sticky.' },
        { label: 'Reduce cost', prompt: 'Revise this formula to reduce cost while keeping the main benefits.' },
        formula_id ? { label: 'Open formula', href: `/formulas?formula=${formula_id}` } : null,
      ].filter(Boolean) as ReactAgentArtifact['quickActions'];
    }

    return [
      formula_id ? { label: 'Confirm เป็น v01', prompt: `confirm สูตรนี้ ${formula_id}` } : null,
      { label: 'ปรับ texture ให้เบา', prompt: 'ช่วยปรับสูตรนี้ให้ texture เบาขึ้น ซึมง่าย และเหนียวน้อยลง' },
      { label: 'ลดต้นทุน', prompt: 'ช่วยปรับสูตรนี้ให้ต้นทุนต่ำลง แต่ยังคง benefit หลักไว้' },
      formula_id ? { label: 'เปิดสูตร', href: `/formulas?formula=${formula_id}` } : null,
    ].filter(Boolean) as ReactAgentArtifact['quickActions'];
  }
}
