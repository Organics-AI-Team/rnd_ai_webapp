/**
 * Governed tool aggregation (G3 Task 4).
 *
 * Exposes one factory that assembles the complete governed catalogue input
 * from injected ports, plus fail-closed NOT_WIRED ports for production use
 * until the real repository/gateway adapters land (G3 Tasks 5-7 wiring).
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { ToolGovernanceError } from "../errors";
import { log_info } from "../logger";
import type { ToolDefinition } from "../tool-definition";
import {
  create_formula_tool_definitions,
  type FormulaToolPorts,
} from "./formula-tools";
import {
  create_knowledge_tool_definitions,
  type KnowledgeToolPorts,
} from "./knowledge-tools";
import {
  create_material_tool_definitions,
  type MaterialToolPorts,
} from "./material-tools";
import {
  create_web_search_tool_definitions,
  type WebSearchToolPorts,
} from "./web-search-tools";

const MODULE = "governed-tools";

/** Complete port surface consumed by the governed tool catalogue. */
export interface GovernedToolPorts
  extends FormulaToolPorts,
    KnowledgeToolPorts,
    MaterialToolPorts,
    WebSearchToolPorts {}

/**
 * Build every governed ToolDefinition (8 tools) from injected ports.
 *
 * @param ports - Narrow ports for formula, knowledge, material, and web capabilities.
 * @returns Immutable array of all governed tool definitions.
 */
export function create_all_governed_tool_definitions(
  ports: GovernedToolPorts,
): readonly ToolDefinition<any, any>[] {
  log_info(MODULE, "create_all_governed_tool_definitions — start");
  const definitions = [
    ...create_formula_tool_definitions(ports),
    ...create_knowledge_tool_definitions(ports),
    ...create_material_tool_definitions(ports),
    ...create_web_search_tool_definitions(ports),
  ];
  log_info(MODULE, "create_all_governed_tool_definitions — done", {
    count: definitions.length,
  });
  return definitions;
}

/**
 * Build a fail-closed rejection for an unwired production adapter.
 *
 * @param port_name - Name of the port method that is not wired yet.
 * @returns Function that always rejects with NOT_WIRED.
 */
function not_wired(port_name: string): () => Promise<never> {
  return async () => {
    throw new ToolGovernanceError(
      "NOT_WIRED",
      `Adapter ${port_name} is not wired yet; production integration lands with the AI gateway.`,
    );
  };
}

/**
 * Production placeholder ports that fail closed with NOT_WIRED.
 *
 * Guarantees the governed catalogue can be registered (cards enforced in
 * CI) while making any premature production invocation an explicit, typed
 * failure instead of a silent legacy fallback.
 *
 * @returns GovernedToolPorts whose every method rejects with NOT_WIRED.
 */
export function create_not_wired_governed_tool_ports(): GovernedToolPorts {
  return {
    formula_search: { search_formulas: not_wired("formula_search.search_formulas") },
    formula_draft: {
      create_draft_formula: not_wired("formula_draft.create_draft_formula"),
    },
    formula_revise: { revise_formula: not_wired("formula_revise.revise_formula") },
    formula_comment: {
      add_formula_comment: not_wired("formula_comment.add_formula_comment"),
    },
    formula_confirm: { confirm_formula: not_wired("formula_confirm.confirm_formula") },
    knowledge_search: {
      search_knowledge: not_wired("knowledge_search.search_knowledge"),
    },
    material_search: {
      search_materials: not_wired("material_search.search_materials"),
    },
    web_search: { search_web: not_wired("web_search.search_web") },
  };
}
