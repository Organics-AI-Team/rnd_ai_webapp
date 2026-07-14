/**
 * Governed ToolDefinition contract (G3 Task 4 + agentic design §4.3).
 *
 * Every AI-invocable capability is declared once, here, with a stable
 * name/version, strict Zod input/output schemas, a named permission, a
 * side-effect class, an approval requirement, timeout/retry policy, an
 * execute() that only ever receives trusted injected context, and a
 * required capability card path (CI-enforced at registration).
 *
 * Model-visible input schemas must never carry security scope: no tenant,
 * organization, user, actor, permission, provider-key, collection, or raw
 * Mongo filter fields. The catalogue rejects definitions that try.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import type { z } from "zod";

/** Side-effect classification for a governed tool. */
export type SideEffectClass = "read" | "draft_write" | "commit";

/** Declared approval requirement for a governed tool. */
export type ApprovalRequirement = "none" | "manager";

/**
 * Named permission string, e.g. "formula:confirm".
 * Will align with the shared auth Permission contract once G1/G2 land it
 * in packages/shared-types (tracked integration TODO).
 */
export type ToolPermission = string;

/** Canonical permission names used by the governed tool catalogue. */
export const TOOL_PERMISSIONS = {
  formula_read: "formula:read",
  formula_draft: "formula:draft",
  formula_revise: "formula:revise",
  formula_comment: "formula:comment",
  formula_confirm: "formula:confirm",
  knowledge_search: "knowledge:search",
  web_search: "web:search",
} as const;

/** Bounded retry policy for one tool call. */
export interface ToolRetryPolicy {
  /** Total attempts including the first; 1 disables retry. */
  readonly max_attempts: number;
  /** Fixed delay between attempts in milliseconds. */
  readonly backoff_ms: number;
}

/**
 * Trusted per-call context injected by the ToolExecutor.
 *
 * Adapters receive tenant/actor scope only through this object — never
 * through model-visible arguments. Ports must apply `tenant_id` to every
 * repository query they issue.
 */
export interface TrustedToolContext {
  /** Tenant that owns the run; injected from the verified principal. */
  readonly tenant_id: string;
  /** Acting user profile ID for audit trails. */
  readonly actor_profile_id: string;
  /** AIRun identifier the call belongs to. */
  readonly run_id: string;
  /** End-to-end correlation ID for log stitching. */
  readonly correlation_id: string;
  /** Deterministic call idempotency key (run/step/tool/arguments hash). */
  readonly idempotency_key: string;
  /** Cancellation signal honoring the executor timeout. */
  readonly signal: AbortSignal;
}

/**
 * Declarative definition of one governed AI tool.
 *
 * @typeParam I - Validated model-visible input type (strict schema).
 * @typeParam O - Validated output type returned to the orchestrator.
 */
export interface ToolDefinition<I, O> {
  /** Stable dotted tool name, e.g. "formula.search". */
  readonly name: string;
  /** Semantic version of the tool contract. */
  readonly version: string;
  /** One-line model-facing description (the card carries the full doc). */
  readonly description: string;
  /** Strict Zod schema validating model-proposed arguments. */
  readonly input_schema: z.ZodType<I>;
  /** Zod schema validating adapter output before release. */
  readonly output_schema: z.ZodType<O>;
  /** Named permission the acting principal must hold. */
  readonly required_permission: ToolPermission;
  /** Side-effect class driving idempotency and retry rules. */
  readonly side_effect: SideEffectClass;
  /** Declared approval requirement; policy may escalate, never relax. */
  readonly approval_requirement: ApprovalRequirement;
  /** Hard wall-clock execution budget per attempt in milliseconds. */
  readonly timeout_ms: number;
  /** Bounded retry policy (read-class tools only; writes never retry). */
  readonly retry: ToolRetryPolicy;
  /**
   * Path to the tool's markdown capability card, resolved against the
   * cards root when relative. Required; registration fails without it
   * or when its frontmatter drifts from this definition (design §4.3).
   */
  readonly capability_card_path: string;
  /**
   * Execute the tool with validated arguments and trusted context.
   *
   * @param args - Arguments already validated against input_schema.
   * @param context - Trusted per-call context injected by the executor.
   * @returns Output that must satisfy output_schema.
   */
  execute(args: I, context: TrustedToolContext): Promise<O>;
}

/** Type-erased tool definition stored in the catalogue. */
export type AnyToolDefinition = ToolDefinition<unknown, unknown>;

/**
 * Model-visible argument keys that are always forbidden, in any casing or
 * nesting depth, because they would carry security scope or raw datastore
 * access into model-controlled input.
 */
export const FORBIDDEN_INPUT_KEYS: readonly string[] = [
  "tenantid",
  "tenant_id",
  "organizationid",
  "organization_id",
  "orgid",
  "org_id",
  "userid",
  "user_id",
  "actorid",
  "actor_id",
  "actorprofileid",
  "actor_profile_id",
  "permission",
  "permissions",
  "role",
  "roles",
  "apikey",
  "api_key",
  "providerkey",
  "provider_key",
  "credential",
  "credentials",
  "token",
  "secret",
  "collection",
  "collectionname",
  "collection_name",
  "database",
  "db",
  "filter",
  "filters",
  "pipeline",
  "projection",
];

/**
 * Decide whether one argument key is forbidden in model-visible input.
 *
 * @param key - Raw object key from model-proposed arguments.
 * @returns True when the key is identity/scope/datastore-shaped or a Mongo
 *          operator (starts with "$").
 */
export function is_forbidden_input_key(key: string): boolean {
  if (key.startsWith("$")) return true;
  return FORBIDDEN_INPUT_KEYS.includes(key.toLowerCase());
}

/**
 * Recursively find the first forbidden key inside model-proposed arguments.
 *
 * @param value - Raw (unvalidated) model-proposed arguments.
 * @returns The offending key name, or null when the value is clean.
 */
export function find_forbidden_input_key(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = find_forbidden_input_key(item);
      if (found) return found;
    }
    return null;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (is_forbidden_input_key(key)) return key;
    const found = find_forbidden_input_key(nested);
    if (found) return found;
  }
  return null;
}
