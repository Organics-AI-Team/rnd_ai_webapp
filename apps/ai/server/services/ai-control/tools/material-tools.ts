/**
 * Governed material search tool (spec §11.1).
 *
 * Structured, non-semantic filtering of the tenant's own raw-material
 * catalog (price ceiling, in-stock, INCI exclusions) — the queries the
 * semantic knowledge.search cannot answer exactly. The model never supplies
 * tenant scope or raw filters; the injected port owns repository access.
 *
 * @author AI Management System
 * @date 2026-07-28
 */

import { z } from "zod";

import { log_info } from "../logger";
import {
  TOOL_PERMISSIONS,
  type ToolDefinition,
  type TrustedToolContext,
} from "../tool-definition";

const MODULE = "material-tools";

export const material_search_input_schema = z
  .object({
    query: z.string().min(1).max(200).optional(),
    max_price: z.number().positive().max(1_000_000).optional(),
    in_stock_only: z.boolean().optional(),
    exclude_inci: z.array(z.string().min(1).max(120)).max(10).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export const material_search_output_schema = z
  .object({
    result_count: z.number().int().min(0),
    total_count: z.number().int().min(0),
    materials: z.array(
      z
        .object({
          material_id: z.string(),
          rm_code: z.string(),
          name: z.string(),
          inci_name: z.string(),
          cas_no: z.string(),
          supplier: z.string(),
          price_thb_per_kg: z.number().nullable(),
          benefits: z.array(z.string()),
          functions: z.array(z.string()),
          in_stock: z.boolean(),
        })
        .strict(),
    ),
    // Steering feedback surfaced INSIDE the tool result on zero matches —
    // the observation is the one channel models reliably react to; without
    // it, models re-queried concept terms until LOOP_DETECTED (observed on
    // two agents in production).
    hint: z.string().max(500).optional(),
  })
  .strict();

export type MaterialSearchInput = z.infer<typeof material_search_input_schema>;
export type MaterialSearchOutput = z.infer<typeof material_search_output_schema>;

/** Narrow read port over the tenant-scoped product repository. */
export interface MaterialSearchPort {
  search_materials(
    args: MaterialSearchInput,
    context: TrustedToolContext,
  ): Promise<MaterialSearchOutput>;
}

/** Ports required by the material tools. */
export interface MaterialToolPorts {
  readonly material_search: MaterialSearchPort;
}

/**
 * Build the governed material.search ToolDefinition over an injected port.
 *
 * @param ports - Narrow product-repository port (fake in tests).
 * @returns Immutable array containing the material.search definition.
 */
export function create_material_tool_definitions(
  ports: MaterialToolPorts,
): readonly ToolDefinition<any, any>[] {
  log_info(MODULE, "create_material_tool_definitions — start");
  return [
    {
      name: "material.search",
      version: "1.0.0",
      description:
        "Structured search over the tenant's raw-material catalog with price/stock/exclusion filters.",
      input_schema: material_search_input_schema,
      output_schema: material_search_output_schema,
      required_permission: TOOL_PERMISSIONS.material_search,
      side_effect: "read",
      approval_requirement: "none",
      timeout_ms: 10_000,
      retry: { max_attempts: 2, backoff_ms: 200 },
      capability_card_path: "tools/material.search.md",
      execute: (args: MaterialSearchInput, context: TrustedToolContext) =>
        ports.material_search.search_materials(args, context),
    },
  ];
}
