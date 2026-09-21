/**
 * Governed tool catalogue (G3 Task 4).
 *
 * The single registry of every AI-invocable tool. Registration enforces:
 * strict input schemas free of identity/scope/datastore fields, a present
 * and frontmatter-consistent capability card (design §4.2/4.3 — "a card is
 * part of the tool's definition of done"), and unique stable names.
 * Policy filtering only ever narrows the registered set.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { z } from "zod";

import { load_capability_card, resolve_cards_root } from "./card-loader";
import { ToolGovernanceError } from "./errors";
import { log_info } from "./logger";
import type { EffectiveAIPolicy } from "./policy-types";
import {
  is_forbidden_input_key,
  type AnyToolDefinition,
  type ToolDefinition,
} from "./tool-definition";

const MODULE = "tool-catalogue";

/** Construction options for the catalogue. */
export interface ToolCatalogueOptions {
  /** Cards root for resolving relative capability_card_path values. */
  readonly cards_root?: string;
}

/**
 * Assert the model-visible input schema is a strict Zod object.
 *
 * @param definition - Candidate tool definition.
 * @returns The schema narrowed to a ZodObject for shape inspection.
 * @throws ToolGovernanceError TOOL_SCHEMA_NOT_STRICT when the schema is not
 *         a strict object schema.
 */
function assert_strict_object_schema(
  definition: AnyToolDefinition,
): z.ZodObject<z.ZodRawShape> {
  const schema = definition.input_schema as unknown;
  if (!(schema instanceof z.ZodObject)) {
    throw new ToolGovernanceError(
      "TOOL_SCHEMA_NOT_STRICT",
      `Tool ${definition.name} input schema must be a strict z.object().`,
    );
  }
  const unknown_keys = (schema as z.ZodObject<z.ZodRawShape>)._def.unknownKeys;
  if (unknown_keys !== "strict") {
    throw new ToolGovernanceError(
      "TOOL_SCHEMA_NOT_STRICT",
      `Tool ${definition.name} input schema must call .strict().`,
    );
  }
  return schema as z.ZodObject<z.ZodRawShape>;
}

/**
 * Assert no declared schema field (at any object depth) is a forbidden
 * identity/scope/datastore key.
 *
 * @param definition - Candidate tool definition.
 * @param schema - Strict object schema to inspect recursively.
 * @throws ToolGovernanceError TOOL_SCHEMA_FORBIDDEN_FIELD on violation.
 */
function assert_no_forbidden_declared_fields(
  definition: AnyToolDefinition,
  schema: z.ZodObject<z.ZodRawShape>,
): void {
  const visit = (candidate: unknown): void => {
    if (!(candidate instanceof z.ZodObject)) {
      if (candidate instanceof z.ZodOptional || candidate instanceof z.ZodNullable) {
        visit(candidate.unwrap());
      }
      if (candidate instanceof z.ZodArray) {
        visit(candidate.element);
      }
      return;
    }
    for (const [key, nested] of Object.entries(candidate.shape)) {
      if (is_forbidden_input_key(key)) {
        throw new ToolGovernanceError(
          "TOOL_SCHEMA_FORBIDDEN_FIELD",
          `Tool ${definition.name} declares forbidden input field "${key}".`,
        );
      }
      visit(nested);
    }
  };
  visit(schema);
}

/**
 * Assert the capability card exists and matches the definition exactly on
 * name, version, side_effect, and required_permission (design §4.3).
 *
 * @param definition - Candidate tool definition.
 * @param cards_root - Cards root for relative card paths.
 * @throws ToolGovernanceError TOOL_CARD_MISSING or TOOL_CARD_DRIFT.
 */
function assert_card_matches_definition(
  definition: AnyToolDefinition,
  cards_root: string,
): void {
  const card = load_capability_card(definition.capability_card_path, cards_root);
  const drift_reasons: string[] = [];
  if (card.kind !== "tool") drift_reasons.push(`kind=${card.kind}`);
  if (card.name !== definition.name) drift_reasons.push(`name=${card.name}`);
  if (card.version !== definition.version) drift_reasons.push(`version=${card.version}`);
  if (card.side_effect !== definition.side_effect) {
    drift_reasons.push(`side_effect=${String(card.side_effect)}`);
  }
  if (card.required_permission !== definition.required_permission) {
    drift_reasons.push(`required_permission=${String(card.required_permission)}`);
  }
  if (drift_reasons.length > 0) {
    throw new ToolGovernanceError(
      "TOOL_CARD_DRIFT",
      `Capability card for ${definition.name} drifts from its definition: ${drift_reasons.join(", ")}.`,
    );
  }
}

/**
 * Registry of governed tool definitions with policy-allowlist filtering.
 */
export class ToolCatalogue {
  private readonly definitions = new Map<string, AnyToolDefinition>();
  private readonly cards_root_override?: string;

  /**
   * Create a catalogue.
   *
   * @param options - Optional cards root override (used by tests and
   *                  alternate deployments); production uses the default
   *                  repo cards directory.
   */
  constructor(options: ToolCatalogueOptions = {}) {
    this.cards_root_override = options.cards_root;
  }

  /**
   * Resolve the cards root for this catalogue instance.
   *
   * @returns Absolute cards root path.
   */
  private cards_root(): string {
    return this.cards_root_override ?? resolve_cards_root();
  }

  /**
   * Register one governed tool definition.
   *
   * @param definition - Complete ToolDefinition with capability card.
   * @throws ToolGovernanceError TOOL_ALREADY_REGISTERED,
   *         TOOL_SCHEMA_NOT_STRICT, TOOL_SCHEMA_FORBIDDEN_FIELD,
   *         TOOL_CARD_MISSING, TOOL_CARD_DRIFT, or CARD_INVALID.
   */
  register<I, O>(definition: ToolDefinition<I, O>): void {
    log_info(MODULE, "register — start", {
      tool: definition.name,
      version: definition.version,
    });
    if (this.definitions.has(definition.name)) {
      throw new ToolGovernanceError(
        "TOOL_ALREADY_REGISTERED",
        `Tool ${definition.name} is already registered.`,
      );
    }
    const erased = definition as unknown as AnyToolDefinition;
    const schema = assert_strict_object_schema(erased);
    assert_no_forbidden_declared_fields(erased, schema);
    assert_card_matches_definition(erased, this.cards_root());
    this.definitions.set(definition.name, erased);
    log_info(MODULE, "register — done", { tool: definition.name });
  }

  /**
   * Look up a registered tool by name.
   *
   * @param name - Stable tool name.
   * @returns The definition, or undefined when unknown.
   */
  get(name: string): AnyToolDefinition | undefined {
    return this.definitions.get(name);
  }

  /**
   * List all registered tool definitions in registration order.
   *
   * @returns Immutable snapshot array of definitions.
   */
  list(): readonly AnyToolDefinition[] {
    return [...this.definitions.values()];
  }

  /**
   * Narrow the catalogue by a tenant policy allowlist.
   *
   * @param policy - Compiled effective tenant policy.
   * @returns Definitions whose names appear in policy.allowed_tools;
   *          an empty array when the policy disables AI entirely.
   */
  filter_by_policy(policy: EffectiveAIPolicy): readonly AnyToolDefinition[] {
    if (!policy.enabled) return [];
    const allowed = new Set(policy.allowed_tools);
    return this.list().filter((definition) => allowed.has(definition.name));
  }
}
