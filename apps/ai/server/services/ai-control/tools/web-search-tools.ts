/**
 * Governed web search tool (G3 Task 4, Step 7).
 *
 * Replaces the legacy web_search ReAct handler (Gemini Google-Search
 * grounding) with a governed web.search definition. Provider credentials
 * and model choice live entirely inside the injected WebSearchPort adapter;
 * the model only ever supplies a query.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { z } from "zod";

import { log_info } from "../logger";
import {
  TOOL_PERMISSIONS,
  type ToolDefinition,
  type TrustedToolContext,
} from "../tool-definition";

const MODULE = "web-search-tools";

export const web_search_input_schema = z
  .object({
    query: z.string().min(1).max(300),
    max_results: z.number().int().min(1).max(10).optional(),
  })
  .strict();

export const web_search_output_schema = z
  .object({
    answer: z.string(),
    sources: z.array(
      z
        .object({
          title: z.string(),
          url: z.string(),
          snippet: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export type WebSearchInput = z.infer<typeof web_search_input_schema>;
export type WebSearchOutput = z.infer<typeof web_search_output_schema>;

/** Narrow read port over the approved external web-search adapter. */
export interface WebSearchPort {
  search_web(
    args: WebSearchInput,
    context: TrustedToolContext,
  ): Promise<WebSearchOutput>;
}

/** Ports required by the web search tools. */
export interface WebSearchToolPorts {
  readonly web_search: WebSearchPort;
}

/**
 * Build the governed web.search ToolDefinition over an injected port.
 *
 * @param ports - Narrow web-search adapter port (fake in tests).
 * @returns Immutable array containing the web.search definition.
 */
export function create_web_search_tool_definitions(
  ports: WebSearchToolPorts,
): readonly ToolDefinition<any, any>[] {
  log_info(MODULE, "create_web_search_tool_definitions — start");
  return [
    {
      name: "web.search",
      version: "1.0.0",
      description:
        "Grounded external web search for public cosmetic-science and regulatory information.",
      input_schema: web_search_input_schema,
      output_schema: web_search_output_schema,
      required_permission: TOOL_PERMISSIONS.web_search,
      side_effect: "read",
      approval_requirement: "none",
      timeout_ms: 20_000,
      retry: { max_attempts: 2, backoff_ms: 300 },
      capability_card_path: "tools/web.search.md",
      execute: (args: WebSearchInput, context: TrustedToolContext) =>
        ports.web_search.search_web(args, context),
    },
  ];
}
