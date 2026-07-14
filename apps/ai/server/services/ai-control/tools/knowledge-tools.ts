/**
 * Governed knowledge search tool (G3 Task 4, Step 7).
 *
 * Replaces the legacy qdrant_search / search_fda_database / MySkin Zod
 * registry tools with one governed knowledge.search definition. The model
 * never chooses collections, embedding versions, or payload filters — the
 * injected KnowledgeSearchPort (the G3 Task 5 KnowledgeGateway) owns
 * partitioning and tenant filter injection.
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

const MODULE = "knowledge-tools";

export const knowledge_search_input_schema = z
  .object({
    query: z.string().min(1).max(500),
    scope: z.enum(["platform", "tenant", "both"]).optional(),
    top_k: z.number().int().min(1).max(20).optional(),
  })
  .strict();

export const knowledge_search_output_schema = z
  .object({
    results: z.array(
      z
        .object({
          source_id: z.string(),
          source_name: z.string(),
          scope: z.enum(["platform", "tenant"]),
          excerpt: z.string(),
          relevance_score: z.number().min(0).max(1),
          content_hash: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export type KnowledgeSearchInput = z.infer<typeof knowledge_search_input_schema>;
export type KnowledgeSearchOutput = z.infer<typeof knowledge_search_output_schema>;

/** Narrow read port over the partitioned knowledge gateway. */
export interface KnowledgeSearchPort {
  search_knowledge(
    args: KnowledgeSearchInput,
    context: TrustedToolContext,
  ): Promise<KnowledgeSearchOutput>;
}

/** Ports required by the knowledge tools. */
export interface KnowledgeToolPorts {
  readonly knowledge_search: KnowledgeSearchPort;
}

/**
 * Build the governed knowledge.search ToolDefinition over an injected port.
 *
 * @param ports - Narrow knowledge gateway port (fake in tests).
 * @returns Immutable array containing the knowledge.search definition.
 */
export function create_knowledge_tool_definitions(
  ports: KnowledgeToolPorts,
): readonly ToolDefinition<any, any>[] {
  log_info(MODULE, "create_knowledge_tool_definitions — start");
  return [
    {
      name: "knowledge.search",
      version: "1.0.0",
      description:
        "Semantic search over governed platform and tenant knowledge with citations.",
      input_schema: knowledge_search_input_schema,
      output_schema: knowledge_search_output_schema,
      required_permission: TOOL_PERMISSIONS.knowledge_search,
      side_effect: "read",
      approval_requirement: "none",
      timeout_ms: 15_000,
      retry: { max_attempts: 2, backoff_ms: 200 },
      capability_card_path: "tools/knowledge.search.md",
      execute: (args: KnowledgeSearchInput, context: TrustedToolContext) =>
        ports.knowledge_search.search_knowledge(args, context),
    },
  ];
}
