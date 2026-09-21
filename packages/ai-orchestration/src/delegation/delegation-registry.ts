/**
 * Specialist delegation registry (G4.6).
 *
 * Declares the three specialists a run may delegate to, each as a governed
 * read-class capability. Registration enforces that a specialist's tool
 * allowlist contains NO delegation tool — so a specialist can never delegate,
 * capping delegation depth at 1. Budgets and iteration ceilings are declared
 * here so the compiler/gateway can reserve a slice before dispatch.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import type { SpecialistKey } from "../schemas/specialist";

/** Prefix identifying a delegation tool (e.g. "delegate.formulation"). */
export const DELEGATION_TOOL_PREFIX = "delegate.";

/** Hard cap: a parent (depth 0) may delegate; a specialist (depth 1) may not. */
export const MAX_DELEGATION_DEPTH = 1;

/** Static definition of one specialist. */
export interface SpecialistDefinition {
  readonly key: SpecialistKey;
  /** Agent card name loaded for the specialist's system context. */
  readonly agent_card: string;
  /** Tools the specialist may use; never includes a delegation tool. */
  readonly tool_allowlist: readonly string[];
  /** Maximum reasoning iterations for the specialist loop. */
  readonly max_iterations: number;
  /** Fraction of the parent's remaining budget reserved before dispatch. */
  readonly budget_fraction: number;
}

/** Read-only tools (no draft/commit); used to permit parallel delegation. */
const READ_ONLY_TOOLS = new Set([
  "knowledge.search",
  "formula.search",
  "material.search",
  "web.search",
]);

const DEFINITIONS: Readonly<Record<SpecialistKey, SpecialistDefinition>> =
  Object.freeze({
    raw_material_research: {
      key: "raw_material_research",
      agent_card: "raw_material_research",
      tool_allowlist: ["knowledge.search", "formula.search", "material.search", "web.search"],
      max_iterations: 6,
      budget_fraction: 0.3,
    },
    formulation: {
      key: "formulation",
      agent_card: "formulation",
      tool_allowlist: [
        "formula.search",
        "formula.draft",
        "formula.revise",
        "formula.comment",
        "knowledge.search",
        "material.search",
      ],
      max_iterations: 8,
      budget_fraction: 0.4,
    },
    sales_rnd: {
      key: "sales_rnd",
      agent_card: "sales_rnd",
      tool_allowlist: ["knowledge.search", "formula.search", "web.search"],
      max_iterations: 6,
      budget_fraction: 0.3,
    },
  });

/**
 * Whether a tool name is a delegation tool.
 *
 * @param tool_name - Candidate tool name.
 * @returns True when the name is a delegation tool.
 */
export function is_delegation_tool(tool_name: string): boolean {
  return tool_name.startsWith(DELEGATION_TOOL_PREFIX);
}

/**
 * Whether a specialist is fully read-only (its allowlist has only read tools).
 * Only read-only specialists may run as concurrent delegation branches.
 *
 * @param definition - Specialist definition.
 * @returns True when every allowlisted tool is read-only.
 */
export function is_read_only_specialist(definition: SpecialistDefinition): boolean {
  return definition.tool_allowlist.every((tool) => READ_ONLY_TOOLS.has(tool));
}

/**
 * Validate one specialist definition: its allowlist may not include any
 * delegation tool (enforces the depth-1 cap at registration).
 *
 * @param definition - Specialist definition to validate.
 * @throws Error when the allowlist contains a delegation tool.
 */
export function assert_valid_specialist(definition: SpecialistDefinition): void {
  const offending = definition.tool_allowlist.find(is_delegation_tool);
  if (offending) {
    throw new Error(
      `Specialist '${definition.key}' allowlist must not include a delegation tool ('${offending}').`,
    );
  }
}

// Fail fast at module load if any definition violates the depth-1 invariant.
for (const definition of Object.values(DEFINITIONS)) {
  assert_valid_specialist(definition);
}

/**
 * Resolve a specialist definition by key (accepts an optional "delegate."
 * prefix), or null when unknown.
 *
 * @param key - Specialist key, with or without the delegation prefix.
 * @returns The specialist definition, or null.
 */
export function get_specialist(key: string): SpecialistDefinition | null {
  const normalized = key.startsWith(DELEGATION_TOOL_PREFIX)
    ? key.slice(DELEGATION_TOOL_PREFIX.length)
    : key;
  return (DEFINITIONS as Record<string, SpecialistDefinition>)[normalized] ?? null;
}

/**
 * The delegation tool names exposed to a parent run (one per specialist).
 *
 * @returns Delegation tool names.
 */
export function delegation_tool_names(): readonly string[] {
  return Object.keys(DEFINITIONS).map((key) => `${DELEGATION_TOOL_PREFIX}${key}`);
}

/** All specialist definitions. */
export const SPECIALIST_DEFINITIONS = DEFINITIONS;
