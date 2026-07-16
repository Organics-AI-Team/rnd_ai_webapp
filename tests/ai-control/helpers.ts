/**
 * Shared deterministic test helpers for the governed AI tool catalogue suite.
 *
 * Provides policy/context factories, in-memory fakes for every injected port,
 * synthetic tool factories, and temp capability-card writers. No network, no
 * real Mongo/Qdrant/Gemini — everything here is pure in-process state.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  formula_artifact_v1_schema,
  type FormulaArtifactV1,
} from "@rnd-ai/ai-orchestration";

import type {
  ApprovalRequirement,
  SideEffectClass,
  ToolDefinition,
  ToolPermission,
  TrustedToolContext,
} from "../../apps/ai/server/services/ai-control/tool-definition";
import type { EffectiveAIPolicy } from "../../apps/ai/server/services/ai-control/policy-types";
import type {
  ToolAuditEvent,
  ToolExecutionContext,
  ToolUsageEntry,
} from "../../apps/ai/server/services/ai-control/tool-executor";

/** Fixed tenant identifiers used across the suite. */
export const tenant_a = "tenant_a_000000000000000000";
export const tenant_b = "tenant_b_000000000000000000";

/** Canonical evidence-bearing formula artifact shared by governed-tool tests. */
export function governed_formula_artifact(): FormulaArtifactV1 {
  return formula_artifact_v1_schema.parse({
    name: "Evidence-backed synthetic serum",
    product_type: "serum",
    batch_size: "100",
    batch_unit: "g",
    ingredients: [
      {
        material_id: "water",
        rm_code: "WATER",
        phase: "A",
        percentage: "95",
        amount: "95",
        unit: "g",
        cost: "0",
        source_ids: [],
        rationale: "Water phase base.",
        is_water: true,
        external_unverified: false,
      },
      {
        material_id: "rm-niacinamide",
        rm_code: "RM-NIA",
        phase: "A",
        percentage: "5",
        amount: "5",
        unit: "g",
        cost: "1.25",
        source_ids: ["source-niacinamide"],
        rationale: "Evidence-backed active at the supported usage level.",
        is_water: false,
        external_unverified: false,
      },
    ],
    claims: [
      {
        text: "Supports a brightening positioning.",
        source_ids: ["source-niacinamide"],
      },
    ],
    warnings: [
      "Laboratory, stability, safety, and regulatory review remain required before production.",
    ],
  });
}

/**
 * Build a complete EffectiveAIPolicy for tests.
 *
 * @param overrides - Partial policy fields to override the permissive defaults.
 * @returns A fully-populated immutable policy snapshot.
 */
export function make_policy(
  overrides: Partial<EffectiveAIPolicy> = {},
): EffectiveAIPolicy {
  return {
    tenant_id: tenant_a,
    version: 1,
    hash: "a".repeat(64),
    enabled: true,
    provider_models: { gemini: ["gemini-2.5-flash"] },
    allowed_tools: [
      "formula.search",
      "formula.draft",
      "formula.revise",
      "formula.comment",
      "formula.confirm",
      "knowledge.search",
      "web.search",
      "tool.echo",
    ],
    monthly_request_limit: 10_000n,
    monthly_token_limit: 50_000_000n,
    monthly_cost_limit_microusd: 500_000_000n,
    per_user_monthly_request_limit: 1_000n,
    per_user_monthly_token_limit: 5_000_000n,
    per_user_monthly_cost_limit_microusd: 50_000_000n,
    per_run_token_limit: 200_000n,
    per_run_cost_limit_microusd: 2_000_000n,
    max_concurrent_runs: 3,
    default_locale: "th-TH",
    max_iterations: 12,
    approval_rules: { "formula.confirm": "manager" },
    ...overrides,
  };
}

/**
 * Build a trusted ToolExecutionContext for tests.
 *
 * @param overrides - Partial context fields (e.g. narrowed permissions).
 * @returns Execution context bound to tenant A with broad permissions.
 */
export function make_context(
  overrides: Partial<ToolExecutionContext> = {},
): ToolExecutionContext {
  return {
    tenant_id: tenant_a,
    actor_profile_id: "profile_0001",
    permissions: [
      "formula:read",
      "formula:draft:create",
      "formula:draft:update_own",
      "formula:comment:create",
      "formula:confirm",
      "tenant:knowledge:read",
      "ai:run",
      "tool:echo",
    ],
    policy: make_policy(),
    run_id: "run_0001",
    step_id: "step_0001",
    correlation_id: "corr_0001",
    ...overrides,
  };
}

/** In-memory UsageService fake capturing every metered entry. */
export class FakeUsageService {
  public readonly entries: ToolUsageEntry[] = [];

  /**
   * Record a metered tool usage entry.
   *
   * @param entry - Usage entry produced by the executor.
   */
  async record_tool_usage(entry: ToolUsageEntry): Promise<void> {
    this.entries.push(entry);
  }
}

/** In-memory audit log fake capturing every attempt event. */
export class FakeAuditLog {
  public readonly events: ToolAuditEvent[] = [];

  /**
   * Record an audit event for a tool execution attempt.
   *
   * @param event - Audit event produced by the executor.
   */
  async record_tool_audit_event(event: ToolAuditEvent): Promise<void> {
    this.events.push(event);
  }
}

/** Approval service fake with a switchable decision. */
export class FakeApprovalService {
  /** Whether a durable manager approval exists for any query. */
  public approved = false;
  public queries: Array<Record<string, string>> = [];

  /**
   * Answer whether a durable manager approval covers the action.
   *
   * @param query - Tenant/run/tool/arguments-hash approval lookup.
   * @returns The configured approval decision.
   */
  async has_manager_approval(query: {
    tenant_id: string;
    run_id: string;
    tool_name: string;
    arguments_hash: string;
  }): Promise<boolean> {
    this.queries.push({ ...query });
    return this.approved;
  }
}

/**
 * Bundle of fresh executor port fakes for one test.
 *
 * @returns Object with usage, audit, and approval fakes.
 */
export function make_ports() {
  return {
    usage_service: new FakeUsageService(),
    audit_log: new FakeAuditLog(),
    approval_service: new FakeApprovalService(),
  };
}

/** Body sections every tool capability card must contain. */
export const REQUIRED_CARD_SECTIONS = [
  "## Purpose",
  "## When to use",
  "## When NOT to use",
  "## Arguments",
  "## Result interpretation",
  "## Failure modes",
  "## Example",
] as const;

/**
 * Create a temp directory for synthetic capability cards.
 *
 * @returns Absolute path of a fresh temp directory.
 */
export function make_temp_cards_root(): string {
  return mkdtempSync(join(tmpdir(), "ai-cards-"));
}

/**
 * Write a syntactically valid capability card file.
 *
 * @param file_path - Absolute path of the .md file to write.
 * @param frontmatter - Frontmatter key/value pairs to serialize.
 * @param body - Optional markdown body; defaults to all required sections.
 * @returns The absolute path written.
 */
export function write_card_file(
  file_path: string,
  frontmatter: Record<string, string>,
  body?: string,
): string {
  const lines = Object.entries(frontmatter).map(([key, value]) => `${key}: ${value}`);
  const default_body = REQUIRED_CARD_SECTIONS.map(
    (section) => `${section}\n\nContent for ${section.replace("## ", "")}.`,
  ).join("\n\n");
  const content = `---\n${lines.join("\n")}\n---\n\n${body ?? default_body}\n`;
  mkdirSync(join(file_path, ".."), { recursive: true });
  writeFileSync(file_path, content, "utf8");
  return file_path;
}

/**
 * Write a card matching a tool definition into a cards root.
 *
 * @param cards_root - Root directory that holds tools/ subdirectory.
 * @param definition - Tool definition whose governance fields the card mirrors.
 * @returns Absolute path of the written card.
 */
export function write_matching_tool_card(
  cards_root: string,
  definition: Pick<
    ToolDefinition<unknown, unknown>,
    "name" | "version" | "side_effect" | "required_permission"
  >,
): string {
  return write_card_file(join(cards_root, "tools", `${definition.name}.md`), {
    name: definition.name,
    version: definition.version,
    kind: "tool",
    side_effect: definition.side_effect,
    required_permission: definition.required_permission,
  });
}

/** Options accepted by the synthetic echo tool factory. */
export interface EchoToolOptions {
  readonly name?: string;
  readonly version?: string;
  readonly side_effect?: SideEffectClass;
  readonly approval_requirement?: ApprovalRequirement;
  readonly required_permission?: ToolPermission;
  readonly timeout_ms?: number;
  readonly retry?: { max_attempts: number; backoff_ms: number };
  readonly capability_card_path?: string;
  readonly execute?: (
    args: { query: string },
    context: TrustedToolContext,
  ) => Promise<{ echoed: string }>;
  readonly input_schema?: z.ZodType<{ query: string }>;
  readonly output_schema?: z.ZodType<{ echoed: string }>;
}

/**
 * Build a synthetic echo tool with a matching card on disk.
 *
 * @param cards_root - Temp cards root where the matching card is written.
 * @param options - Overrides for definition fields and behavior.
 * @returns ToolDefinition ready for catalogue registration.
 */
export function make_echo_tool(
  cards_root: string,
  options: EchoToolOptions = {},
): ToolDefinition<{ query: string }, { echoed: string }> {
  // This synthetic-only permission exercises arbitrary test cards; production
  // definitions cannot bypass the shared Permission union.
  const required_permission =
    options.required_permission ?? ("tool:echo" as ToolPermission);
  const definition: ToolDefinition<{ query: string }, { echoed: string }> = {
    name: options.name ?? "tool.echo",
    version: options.version ?? "1.0.0",
    description: "Deterministic echo tool used only in tests.",
    input_schema:
      options.input_schema ?? z.object({ query: z.string().min(1) }).strict(),
    output_schema:
      options.output_schema ?? z.object({ echoed: z.string() }).strict(),
    required_permission,
    side_effect: options.side_effect ?? "read",
    approval_requirement: options.approval_requirement ?? "none",
    timeout_ms: options.timeout_ms ?? 1_000,
    retry: options.retry ?? { max_attempts: 1, backoff_ms: 0 },
    capability_card_path:
      options.capability_card_path ??
      write_card_file(join(cards_root, "tools", `${options.name ?? "tool.echo"}.md`), {
        name: options.name ?? "tool.echo",
        version: options.version ?? "1.0.0",
        kind: "tool",
        side_effect: options.side_effect ?? "read",
        required_permission,
      }),
    execute:
      options.execute ?? (async (args) => ({ echoed: args.query })),
  };
  return definition;
}
