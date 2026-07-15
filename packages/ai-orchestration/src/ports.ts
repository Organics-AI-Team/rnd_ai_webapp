/**
 * Injected port contracts for the governed agentic loop.
 *
 * The orchestration package never constructs providers, repositories, or
 * policy engines itself; the AI gateway wires concrete adapters into these
 * ports. Every port method receives {@link TrustedRuntimeContext} out-of-band
 * so tenant identity, actor identity, and correlation never travel through
 * model-visible input.
 */

import type { ApprovalResultV1, QualityDimensionsV1 } from "./contracts";

/**
 * Server-resolved identity and lineage for one run. Built exclusively from a
 * verified principal plus stored tenant policy — never from client JSON.
 * This object is passed beside model input, never inside it.
 */
export interface TrustedRuntimeContext {
  readonly tenant_id: string;
  readonly actor_profile_id: string;
  readonly run_id: string;
  readonly parent_run_id: string | null;
  readonly delegation_depth: number;
  readonly correlation_id: string;
}

/** Declaration of one callable tool for a native tool-calling model turn. */
export interface ToolDeclarationV1 {
  readonly name: string;
  readonly description: string;
  /** JSON-schema-shaped parameter description; provider adapters translate it. */
  readonly parameters: Record<string, unknown>;
}

/** Chat role visible to the model; system content comes from the context pack only. */
export type LoopMessageRole = "user" | "assistant" | "tool";

/** One rendered conversation message for a model turn. */
export interface LoopMessageV1 {
  readonly role: LoopMessageRole;
  readonly content: string;
  /** Ties a tool-result message back to the assistant tool call it answers. */
  readonly tool_call_id: string | null;
}

/** One native tool call emitted by the model. */
export interface ModelToolCallV1 {
  readonly call_id: string;
  readonly tool_name: string;
  readonly arguments: unknown;
}

/** Token and cost usage reported for one model turn; cost is a decimal string. */
export interface ModelTurnUsageV1 {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cost_usd: string;
}

/** The single assistant turn returned by one {@link ModelGateway} call. */
export interface ModelTurnV1 {
  readonly content: string | null;
  readonly tool_calls: readonly ModelToolCallV1[];
  readonly usage: ModelTurnUsageV1;
}

/** Request for exactly one native tool-calling model turn. */
export interface ModelTurnRequestV1 {
  readonly system: string;
  readonly messages: readonly LoopMessageV1[];
  readonly tools: readonly ToolDeclarationV1[];
}

/**
 * The only port that reaches a model provider. Exactly one assistant turn per
 * call; the agent node is the sole caller.
 */
export interface ModelGateway {
  /**
   * Execute one native tool-calling turn.
   *
   * @param request - System context pack, conversation, and declared tools.
   * @param context - Trusted identity outside model input.
   * @returns The single assistant turn (text and/or tool calls) with usage.
   * @throws Error only for transport/provider failures; malformed tool calls
   *         are returned, not thrown, so the loop can retry deterministically.
   */
  complete_turn(
    request: ModelTurnRequestV1,
    context: TrustedRuntimeContext,
  ): Promise<ModelTurnV1>;
}

/** Trust label attached to every observation the model later reads. */
export type ObservationTrust =
  | "trusted_system"
  | "trusted_user"
  | "untrusted_content";

/** Side-effect classification for a registered tool. */
export type SideEffectClass = "read" | "draft" | "commit";

/**
 * Runtime description of one registered tool as the governor needs it:
 * enforcement metadata and the output contract, never prose cards.
 */
export interface ToolRuntimeDefinitionV1 {
  readonly name: string;
  readonly version: string;
  readonly side_effect: SideEffectClass;
  readonly required_permission: string | null;
  /** Zod-compatible schema; act validates every tool output against it. */
  readonly output_schema: { safeParse(value: unknown): { success: boolean; error?: unknown } };
  /** Trust label for content this tool returns; retrieval defaults untrusted. */
  readonly result_trust: ObservationTrust;
  /** Whether the tool result is a tenant artifact draft requiring validation. */
  readonly produces_artifact: boolean;
  /** Additional attempts permitted for retryable execution errors. */
  readonly retry: number;
  readonly timeout_ms: number;
}

/** Execution request for one gated action. */
export interface ToolExecutionRequestV1 {
  readonly idempotency_key: string;
  readonly tool_name: string;
  readonly arguments: unknown;
  readonly run_id: string;
  readonly iteration: number;
}

/** Normalized result of one tool execution attempt. */
export interface ToolExecutionResultV1 {
  readonly status: "ok" | "error";
  readonly output: unknown;
  readonly error_code: string | null;
  readonly safe_error_message: string | null;
  readonly retryable: boolean;
  readonly cost_usd: string;
  readonly latency_ms: number;
}

/**
 * The only component allowed to run tool side effects. Implementations must
 * be idempotent per idempotency_key so node replay never duplicates effects.
 */
export interface ToolExecutor {
  /**
   * Look up governor-facing metadata for a registered tool.
   *
   * @param tool_name - Catalogue tool name.
   * @param context - Trusted identity outside model input.
   * @returns The runtime definition, or null when the tool is not registered.
   */
  describe(
    tool_name: string,
    context: TrustedRuntimeContext,
  ): ToolRuntimeDefinitionV1 | null;

  /**
   * Execute one authorized action exactly once per idempotency key.
   *
   * @param request - Gated action with its idempotency key.
   * @param context - Trusted identity outside model input.
   * @returns Normalized execution result; failures are returned, not thrown.
   */
  execute(
    request: ToolExecutionRequestV1,
    context: TrustedRuntimeContext,
  ): Promise<ToolExecutionResultV1>;
}

/** Deterministic finding produced by artifact validation. */
export interface ArtifactValidationFindingV1 {
  readonly code: string;
  readonly severity: "blocking" | "warning";
  readonly safe_message: string;
}

/** Deterministic artifact validation outcome. */
export interface ArtifactValidationV1 {
  readonly valid: boolean;
  readonly findings: readonly ArtifactValidationFindingV1[];
  /**
   * Deterministic quality dimensions computed by the validating adapter, which
   * holds the material evidence the orchestration package deliberately does not.
   * Optional so pre-existing adapters/tests remain valid; the finalize node
   * surfaces it in the run output when present.
   */
  readonly quality_dimensions?: QualityDimensionsV1;
}

/** Deterministic validation and persistence of tenant artifacts (e.g. formulas). */
export interface ArtifactService {
  /**
   * Validate a draft artifact deterministically (no model involvement).
   *
   * @param artifact - Tool-produced artifact payload.
   * @param context - Trusted identity outside model input.
   * @returns Blocking and warning findings; blocking findings must return to
   *          the agent as observations, never silently pass.
   */
  validate_draft(
    artifact: unknown,
    context: TrustedRuntimeContext,
  ): Promise<ArtifactValidationV1>;
}

/** Persistence port for run lifecycle records owned by the gateway. */
export interface RunRepository {
  /**
   * Record terminal success for a run.
   *
   * @param run_id - Internal run identifier.
   * @param output - Versioned public output payload.
   * @param context - Trusted identity outside model input.
   */
  mark_completed(
    run_id: string,
    output: unknown,
    context: TrustedRuntimeContext,
  ): Promise<void>;

  /**
   * Record terminal failure for a run.
   *
   * @param run_id - Internal run identifier.
   * @param error - Versioned safe error payload.
   * @param context - Trusted identity outside model input.
   */
  mark_failed(
    run_id: string,
    error: unknown,
    context: TrustedRuntimeContext,
  ): Promise<void>;
}

/** Durable approval workflow port (G4.7). */
export interface ApprovalService {
  /**
   * Idempotently ensure a pending approval exists for an action.
   *
   * @param run_id - Internal run identifier.
   * @param action_idempotency_key - Key of the action awaiting approval.
   * @param summary - Safe human-readable action summary.
   * @param context - Trusted identity outside model input.
   * @returns Stable approval identifier (same key returns the same approval).
   */
  ensure_pending(
    run_id: string,
    action_idempotency_key: string,
    summary: string,
    context: TrustedRuntimeContext,
  ): Promise<{ approval_id: string }>;

  /**
   * Verify a resume payload against the stored approval: tenant, checkpoint,
   * permission, decider, expiry, and current status. Never trusts the resume
   * blob's authority claims.
   *
   * @param args - Run + action key + the untrusted resume payload.
   * @param context - Trusted identity outside model input.
   * @returns The verified approval outcome.
   * @throws Error (rejected) when the resume is invalid, expired, or the decider
   *         is not authorized.
   */
  verify_resume(
    args: {
      readonly run_id: string;
      readonly action_idempotency_key: string;
      readonly resume: unknown;
    },
    context: TrustedRuntimeContext,
  ): Promise<ApprovalResultV1>;

  /**
   * Count the approvals recorded for a run (proves exactly-once on replay).
   *
   * @param run_id - Internal run identifier.
   * @returns The number of distinct approvals created for the run.
   */
  count_for_run(run_id: string): Promise<number>;
}

/** Usage metering and reconciliation port. */
export interface UsageService {
  /**
   * Reconcile final token/cost usage onto the run's usage ledger.
   *
   * @param run_id - Internal run identifier.
   * @param usage - Final counters (tokens, decimal cost string, call counts).
   * @param context - Trusted identity outside model input.
   */
  reconcile(
    run_id: string,
    usage: {
      readonly model_calls: number;
      readonly tool_calls: number;
      readonly tokens_used: number;
      readonly cost_usd_used: string;
    },
    context: TrustedRuntimeContext,
  ): Promise<void>;
}

/** Read-only knowledge/context seeding port used by ingress. */
export interface KnowledgeGateway {
  /**
   * Load a safe summary of prior thread context for run seeding.
   *
   * @param thread_id - Conversation thread identifier from validated input.
   * @param context - Trusted identity outside model input.
   * @returns Summary text or null when the thread has no prior context.
   */
  load_thread_summary(
    thread_id: string,
    context: TrustedRuntimeContext,
  ): Promise<string | null>;
}

/** Injectable clock so budget deadlines are deterministic under test. */
export interface Clock {
  /** @returns Current time as an ISO-8601 UTC string. */
  now_iso(): string;
  /** @returns Current time in epoch milliseconds. */
  now_ms(): number;
}

/** Injectable identifier source so events and observations are deterministic under test. */
export interface IdGenerator {
  /** @returns A new unique identifier string. */
  next_id(): string;
}

/** Structured logger port; adapters attach transport and redaction. */
export interface LoopLogger {
  /**
   * Emit one structured log record.
   *
   * @param level - Severity channel.
   * @param event - Stable snake_case event name (e.g. "agent_node.start").
   * @param fields - Correlation fields; must never include secrets or prompts.
   */
  log(
    level: "debug" | "info" | "warn" | "error",
    event: string,
    fields: Record<string, unknown>,
  ): void;
}

/**
 * Verdict for one proposed action, computed deterministically by the injected
 * policy engine from stored tenant policy — never from model claims.
 */
export type ActionVerdictV1 =
  | { readonly kind: "allowed" }
  | {
      readonly kind: "denied";
      readonly reason_code: string;
      readonly safe_reason: string;
      /** Fatal denials (emergency disable, revoked pins) end the run instead of re-planning. */
      readonly fatal: boolean;
    }
  | {
      readonly kind: "approval_required";
      readonly reason_code: string;
      readonly safe_reason: string;
    };

/** Minimal action shape the policy engine evaluates. */
export interface PolicyActionV1 {
  readonly tool_name: string;
  readonly arguments: unknown;
}

/**
 * Deterministic per-action authorization: emergency disable, pinned policy
 * status, tool allowlist, permission, budget reservation, and approval class.
 */
export interface PolicyEngine {
  /**
   * Evaluate one proposed action immediately before execution.
   *
   * @param action - Proposed tool call (name + arguments only).
   * @param context - Trusted identity outside model input.
   * @returns Allowed, denied (with safe reason), or approval_required verdict.
   */
  evaluate_action(
    action: PolicyActionV1,
    context: TrustedRuntimeContext,
  ): Promise<ActionVerdictV1>;
}

/** Full injected port set consumed by the loop nodes. */
export interface OrchestrationPorts {
  readonly model: ModelGateway;
  readonly knowledge: KnowledgeGateway;
  readonly tools: ToolExecutor;
  readonly artifacts: ArtifactService;
  readonly runs: RunRepository;
  readonly approvals: ApprovalService;
  readonly usage: UsageService;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** Tunable loop-governance knobs; defaults live in {@link default_loop_config}. */
export interface LoopConfig {
  /** Identical normalized proposals at/beyond this count trip LOOP_DETECTED. */
  readonly loop_detection_threshold: number;
  /** Additional model attempts after a malformed/unknown tool call (plan: 1). */
  readonly max_model_retries: number;
  /** Upper bound of questions accepted in one clarification request. */
  readonly max_clarification_questions: number;
}

/** Default governance configuration; override per deployment, never inline. */
export const default_loop_config: LoopConfig = Object.freeze({
  loop_detection_threshold: 3,
  max_model_retries: 1,
  max_clarification_questions: 3,
});

/**
 * Everything a node receives beside graph state: ports, deterministic policy,
 * trusted identity, governance configuration, and structured logging.
 */
export interface AgentLoopRuntime {
  readonly ports: OrchestrationPorts;
  readonly policy: PolicyEngine;
  readonly context: TrustedRuntimeContext;
  readonly config: LoopConfig;
  readonly logger: LoopLogger | null;
}

/**
 * Emit a structured loop log entry when a logger is wired.
 *
 * @param runtime - Node runtime carrying the optional logger and context.
 * @param level - Severity channel.
 * @param event - Stable snake_case event name.
 * @param fields - Extra structured fields (correlation IDs are added here).
 */
export function log_loop_event(
  runtime: AgentLoopRuntime,
  level: "debug" | "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown> = {},
): void {
  runtime.logger?.log(level, event, {
    run_id: runtime.context.run_id,
    correlation_id: runtime.context.correlation_id,
    ...fields,
  });
}
