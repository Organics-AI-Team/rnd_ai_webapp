/**
 * Governed tool executor (G3 Task 4, Step 6).
 *
 * The only path from a model-proposed tool call to a side effect. Order of
 * enforcement per call: policy allowlist → permission → forbidden-key scan →
 * strict input validation → approval evaluation → idempotency (duplicate
 * side-effect suppression) → trusted-context injection → timeout/retry →
 * output validation → usage metering → audit. Every attempt writes an audit
 * event, success or not. Model output only ever proposes; this module and
 * its injected ports decide (program invariant 7).
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { ToolGovernanceError, as_tool_governance_error } from "./errors";
import { hash_canonical, sha256_hex } from "./hashing";
import { log_error, log_info } from "./logger";
import type { EffectiveAIPolicy } from "./policy-types";
import type { ToolCatalogue } from "./tool-catalogue";
import {
  find_forbidden_input_key,
  type AnyToolDefinition,
  type ApprovalRequirement,
  type SideEffectClass,
  type TrustedToolContext,
} from "./tool-definition";

const MODULE = "tool-executor";

/** Model-proposed tool call, exactly as decoded from the provider turn. */
export interface ToolCallProposal {
  /** Proposed tool name. */
  readonly name: string;
  /** Raw model-proposed arguments (untrusted). */
  readonly arguments: unknown;
}

/**
 * Trusted execution context for one tool call, derived by the AI gateway
 * from the verified principal, the pinned policy snapshot, and the run.
 * Never populated from model output.
 */
export interface ToolExecutionContext {
  readonly tenant_id: string;
  readonly actor_profile_id: string;
  /** Named permissions held by the acting principal. */
  readonly permissions: readonly string[];
  /** Immutable compiled policy snapshot pinned on the run. */
  readonly policy: EffectiveAIPolicy;
  readonly run_id: string;
  /** Loop step identifier; part of the call idempotency key. */
  readonly step_id: string;
  readonly correlation_id: string;
}

/** Metered usage entry emitted for every successful tool execution. */
export interface ToolUsageEntry {
  readonly tenant_id: string;
  readonly actor_profile_id: string;
  readonly run_id: string;
  readonly tool_name: string;
  readonly tool_version: string;
  readonly idempotency_key: string;
  readonly tool_calls: number;
  readonly duration_ms: number;
  readonly outcome: "success";
  readonly occurred_at: string;
}

/** Audit event written for every execution attempt, success or failure. */
export interface ToolAuditEvent {
  readonly tenant_id: string;
  readonly actor_profile_id: string;
  readonly run_id: string;
  readonly step_id: string;
  readonly correlation_id: string;
  readonly tool_name: string;
  readonly side_effect: SideEffectClass | null;
  readonly idempotency_key: string | null;
  readonly arguments_hash: string | null;
  readonly outcome: "success" | "denied" | "failed" | "duplicate";
  readonly error_code: string | null;
  readonly duration_ms: number;
  readonly occurred_at: string;
}

/** Port metering tool usage into the tenant usage ledger (G3 Task 3). */
export interface UsageServicePort {
  record_tool_usage(entry: ToolUsageEntry): Promise<void>;
}

/** Port persisting append-only tool audit events. */
export interface AuditLogPort {
  record_tool_audit_event(event: ToolAuditEvent): Promise<void>;
}

/** Port answering whether a durable manager approval covers an action. */
export interface ApprovalServicePort {
  has_manager_approval(query: {
    tenant_id: string;
    run_id: string;
    tool_name: string;
    arguments_hash: string;
  }): Promise<boolean>;
}

/** Port storing completed side-effect results by idempotency key. */
export interface IdempotencyStorePort {
  get(key: string): Promise<unknown | undefined>;
  put(key: string, output: unknown): Promise<void>;
}

/** Injected ports required by the executor; all fakes in tests. */
export interface ToolExecutorPorts {
  readonly usage_service: UsageServicePort;
  readonly audit_log: AuditLogPort;
  readonly approval_service: ApprovalServicePort;
  /** Optional override; defaults to an in-process store per executor. */
  readonly idempotency_store?: IdempotencyStorePort;
}

/** Result of one governed tool execution. */
export interface ToolExecutionResult<O = any> {
  readonly tool_name: string;
  readonly idempotency_key: string;
  readonly output: O;
  readonly duration_ms: number;
  /** Attempts actually performed (1 unless a read retry occurred). */
  readonly attempts: number;
  /** True when a recorded side-effect result was returned without re-running. */
  readonly from_cache: boolean;
}

/**
 * Default in-process idempotency store. Production wiring replaces this
 * with a durable per-run store at gateway integration (G3 Task 7).
 */
class InMemoryIdempotencyStore implements IdempotencyStorePort {
  private readonly results = new Map<string, unknown>();

  /**
   * Read a recorded result.
   *
   * @param key - Call idempotency key.
   * @returns Stored output or undefined.
   */
  async get(key: string): Promise<unknown | undefined> {
    return this.results.get(key);
  }

  /**
   * Record a completed result.
   *
   * @param key - Call idempotency key.
   * @param output - Validated tool output to memoize.
   */
  async put(key: string, output: unknown): Promise<void> {
    this.results.set(key, output);
  }
}

/**
 * Resolve the strongest approval requirement between the definition and
 * the tenant policy (policy may escalate, never relax).
 *
 * @param definition - Registered tool definition.
 * @param policy - Effective tenant policy snapshot.
 * @returns "manager" when either source requires it, else "none".
 */
function resolve_approval_requirement(
  definition: AnyToolDefinition,
  policy: EffectiveAIPolicy,
): ApprovalRequirement {
  const policy_rule = policy.approval_rules[definition.name] ?? "none";
  return definition.approval_requirement === "manager" || policy_rule === "manager"
    ? "manager"
    : "none";
}

/**
 * Sleep helper for bounded retry backoff.
 *
 * @param duration_ms - Delay in milliseconds.
 * @returns Promise resolving after the delay.
 */
function sleep(duration_ms: number): Promise<void> {
  return new Promise((resolve_sleep) => setTimeout(resolve_sleep, duration_ms));
}

/**
 * Execute model-proposed tool calls under tenant policy governance.
 */
export class ToolExecutor {
  private readonly catalogue: ToolCatalogue;
  private readonly ports: ToolExecutorPorts;
  private readonly idempotency_store: IdempotencyStorePort;

  /**
   * Create an executor bound to a catalogue and injected ports.
   *
   * @param catalogue - Governed tool catalogue (already registered).
   * @param ports - Usage, audit, approval, and optional idempotency ports.
   */
  constructor(catalogue: ToolCatalogue, ports: ToolExecutorPorts) {
    this.catalogue = catalogue;
    this.ports = ports;
    this.idempotency_store =
      ports.idempotency_store ?? new InMemoryIdempotencyStore();
  }

  /**
   * Execute one model-proposed tool call end to end.
   *
   * @param proposal - Untrusted tool name and arguments from the model turn.
   * @param context - Trusted execution context from the AI gateway.
   * @returns Validated ToolExecutionResult.
   * @throws ToolGovernanceError with a stable code on any denial or failure.
   */
  async execute(
    proposal: ToolCallProposal,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const started_at = Date.now();
    log_info(MODULE, "execute — start", {
      tool: proposal.name,
      run_id: context.run_id,
      step_id: context.step_id,
      correlation_id: context.correlation_id,
    });
    let definition: AnyToolDefinition | undefined;
    let idempotency_key: string | null = null;
    let arguments_hash: string | null = null;
    try {
      definition = this.catalogue.get(proposal.name);
      if (!definition) {
        throw new ToolGovernanceError(
          "TOOL_UNKNOWN",
          `Tool ${proposal.name} is not registered in the governed catalogue.`,
        );
      }
      this.assert_policy_allows(definition, context);
      this.assert_permission(definition, context);
      const validated_args = this.validate_input(definition, proposal.arguments);
      arguments_hash = hash_canonical(validated_args);
      idempotency_key = this.derive_idempotency_key(
        definition,
        context,
        arguments_hash,
      );
      await this.assert_approval(definition, context, arguments_hash);

      if (definition.side_effect !== "read") {
        const recorded = await this.idempotency_store.get(idempotency_key);
        if (recorded !== undefined) {
          const duration_ms = Date.now() - started_at;
          await this.audit(context, definition, {
            idempotency_key,
            arguments_hash,
            outcome: "duplicate",
            error_code: null,
            duration_ms,
          });
          log_info(MODULE, "execute — duplicate side effect suppressed", {
            tool: definition.name,
            run_id: context.run_id,
          });
          return {
            tool_name: definition.name,
            idempotency_key,
            output: recorded,
            duration_ms,
            attempts: 0,
            from_cache: true,
          };
        }
      }

      const { output, attempts } = await this.run_with_timeout_and_retry(
        definition,
        validated_args,
        context,
        idempotency_key,
      );
      const validated_output = this.validate_output(definition, output);
      if (definition.side_effect !== "read") {
        await this.idempotency_store.put(idempotency_key, validated_output);
      }
      const duration_ms = Date.now() - started_at;
      await this.ports.usage_service.record_tool_usage({
        tenant_id: context.tenant_id,
        actor_profile_id: context.actor_profile_id,
        run_id: context.run_id,
        tool_name: definition.name,
        tool_version: definition.version,
        idempotency_key,
        tool_calls: 1,
        duration_ms,
        outcome: "success",
        occurred_at: new Date().toISOString(),
      });
      await this.audit(context, definition, {
        idempotency_key,
        arguments_hash,
        outcome: "success",
        error_code: null,
        duration_ms,
      });
      log_info(MODULE, "execute — done", {
        tool: definition.name,
        run_id: context.run_id,
        duration_ms,
        attempts,
      });
      return {
        tool_name: definition.name,
        idempotency_key,
        output: validated_output,
        duration_ms,
        attempts,
        from_cache: false,
      };
    } catch (error) {
      const governance_error =
        as_tool_governance_error(error) ??
        new ToolGovernanceError(
          "TOOL_EXECUTION_FAILED",
          `Tool ${proposal.name} failed to execute.`,
        );
      const duration_ms = Date.now() - started_at;
      const denial_codes = new Set([
        "TOOL_UNKNOWN",
        "TOOL_NOT_ALLOWED",
        "POLICY_DISABLED",
        "TOOL_PERMISSION_DENIED",
        "TOOL_INPUT_INVALID",
        "TOOL_APPROVAL_REQUIRED",
      ]);
      await this.audit(context, definition ?? null, {
        tool_name: proposal.name,
        idempotency_key,
        arguments_hash,
        outcome: denial_codes.has(governance_error.code) ? "denied" : "failed",
        error_code: governance_error.code,
        duration_ms,
      });
      log_error(MODULE, "execute — error", {
        tool: proposal.name,
        run_id: context.run_id,
        correlation_id: context.correlation_id,
        code: governance_error.code,
        duration_ms,
      });
      throw governance_error;
    }
  }

  /**
   * Enforce the tenant policy allowlist and enabled flag.
   *
   * @param definition - Resolved tool definition.
   * @param context - Trusted execution context.
   * @throws ToolGovernanceError POLICY_DISABLED or TOOL_NOT_ALLOWED.
   */
  private assert_policy_allows(
    definition: AnyToolDefinition,
    context: ToolExecutionContext,
  ): void {
    if (!context.policy.enabled) {
      throw new ToolGovernanceError(
        "POLICY_DISABLED",
        "AI is disabled by the tenant policy.",
      );
    }
    if (!context.policy.allowed_tools.includes(definition.name)) {
      throw new ToolGovernanceError(
        "TOOL_NOT_ALLOWED",
        `Tool ${definition.name} is not in the tenant policy allowlist.`,
      );
    }
  }

  /**
   * Enforce the tool's named permission against the acting principal.
   *
   * @param definition - Resolved tool definition.
   * @param context - Trusted execution context.
   * @throws ToolGovernanceError TOOL_PERMISSION_DENIED.
   */
  private assert_permission(
    definition: AnyToolDefinition,
    context: ToolExecutionContext,
  ): void {
    if (!context.permissions.includes(definition.required_permission)) {
      throw new ToolGovernanceError(
        "TOOL_PERMISSION_DENIED",
        `Missing permission ${definition.required_permission} for ${definition.name}.`,
      );
    }
  }

  /**
   * Scan for forbidden keys, then strictly validate model input.
   *
   * @param definition - Resolved tool definition.
   * @param raw_arguments - Untrusted model-proposed arguments.
   * @returns Arguments validated against the strict input schema.
   * @throws ToolGovernanceError TOOL_INPUT_INVALID.
   */
  private validate_input(
    definition: AnyToolDefinition,
    raw_arguments: unknown,
  ): unknown {
    const forbidden_key = find_forbidden_input_key(raw_arguments);
    if (forbidden_key) {
      throw new ToolGovernanceError(
        "TOOL_INPUT_INVALID",
        `Model input for ${definition.name} carries forbidden field "${forbidden_key}".`,
      );
    }
    const parsed = definition.input_schema.safeParse(raw_arguments);
    if (!parsed.success) {
      throw new ToolGovernanceError(
        "TOOL_INPUT_INVALID",
        `Input for ${definition.name} failed strict validation.`,
      );
    }
    return parsed.data;
  }

  /**
   * Enforce the strongest approval requirement for the action.
   *
   * @param definition - Resolved tool definition.
   * @param context - Trusted execution context.
   * @param arguments_hash - Canonical hash binding the approval to the args.
   * @throws ToolGovernanceError TOOL_APPROVAL_REQUIRED when no durable
   *         manager approval covers the exact action.
   */
  private async assert_approval(
    definition: AnyToolDefinition,
    context: ToolExecutionContext,
    arguments_hash: string,
  ): Promise<void> {
    const requirement = resolve_approval_requirement(definition, context.policy);
    if (requirement === "none") return;
    const approved = await this.ports.approval_service.has_manager_approval({
      tenant_id: context.tenant_id,
      run_id: context.run_id,
      tool_name: definition.name,
      arguments_hash,
    });
    if (!approved) {
      throw new ToolGovernanceError(
        "TOOL_APPROVAL_REQUIRED",
        `Tool ${definition.name} requires an approved manager approval.`,
      );
    }
  }

  /**
   * Derive the deterministic call idempotency key.
   *
   * @param definition - Resolved tool definition.
   * @param context - Trusted execution context.
   * @param arguments_hash - Canonical hash of validated arguments.
   * @returns SHA-256 hex key over run/step/tool@version/arguments.
   */
  private derive_idempotency_key(
    definition: AnyToolDefinition,
    context: ToolExecutionContext,
    arguments_hash: string,
  ): string {
    return sha256_hex(
      [
        context.run_id,
        context.step_id,
        `${definition.name}@${definition.version}`,
        arguments_hash,
      ].join("\n"),
    );
  }

  /**
   * Run the tool with per-attempt timeout and bounded read-only retry.
   *
   * Side-effecting tools (draft_write/commit) never retry: a failed write
   * must surface, not silently repeat.
   *
   * @param definition - Resolved tool definition.
   * @param validated_args - Arguments validated against the input schema.
   * @param context - Trusted execution context.
   * @param idempotency_key - Deterministic call key injected into the tool.
   * @returns Raw output plus the number of attempts performed.
   * @throws ToolGovernanceError TOOL_TIMEOUT or TOOL_EXECUTION_FAILED
   *         (or a governance error thrown by the adapter, e.g. NOT_WIRED).
   */
  private async run_with_timeout_and_retry(
    definition: AnyToolDefinition,
    validated_args: unknown,
    context: ToolExecutionContext,
    idempotency_key: string,
  ): Promise<{ output: unknown; attempts: number }> {
    const max_attempts =
      definition.side_effect === "read"
        ? Math.max(1, definition.retry.max_attempts)
        : 1;
    let last_error: ToolGovernanceError | null = null;
    for (let attempt = 1; attempt <= max_attempts; attempt += 1) {
      try {
        const output = await this.run_single_attempt(
          definition,
          validated_args,
          context,
          idempotency_key,
        );
        return { output, attempts: attempt };
      } catch (error) {
        const governance_error = as_tool_governance_error(error);
        if (governance_error && !governance_error.retryable) {
          throw governance_error;
        }
        last_error =
          governance_error ??
          new ToolGovernanceError(
            "TOOL_EXECUTION_FAILED",
            `Tool ${definition.name} failed to execute.`,
            true,
          );
        if (attempt < max_attempts && definition.retry.backoff_ms > 0) {
          await sleep(definition.retry.backoff_ms);
        }
      }
    }
    throw (
      last_error ??
      new ToolGovernanceError(
        "TOOL_EXECUTION_FAILED",
        `Tool ${definition.name} failed to execute.`,
      )
    );
  }

  /**
   * Run one attempt under an AbortController-backed timeout.
   *
   * @param definition - Resolved tool definition.
   * @param validated_args - Validated arguments.
   * @param context - Trusted execution context.
   * @param idempotency_key - Deterministic call key.
   * @returns Raw adapter output.
   * @throws ToolGovernanceError TOOL_TIMEOUT (retryable for reads) or
   *         TOOL_EXECUTION_FAILED (retryable) on adapter failure.
   */
  private async run_single_attempt(
    definition: AnyToolDefinition,
    validated_args: unknown,
    context: ToolExecutionContext,
    idempotency_key: string,
  ): Promise<unknown> {
    const abort_controller = new AbortController();
    const trusted_context: TrustedToolContext = {
      tenant_id: context.tenant_id,
      actor_profile_id: context.actor_profile_id,
      run_id: context.run_id,
      correlation_id: context.correlation_id,
      idempotency_key,
      signal: abort_controller.signal,
    };
    let timeout_handle: ReturnType<typeof setTimeout> | undefined;
    const timeout_promise = new Promise<never>((_, reject) => {
      timeout_handle = setTimeout(() => {
        abort_controller.abort();
        reject(
          new ToolGovernanceError(
            "TOOL_TIMEOUT",
            `Tool ${definition.name} exceeded ${definition.timeout_ms}ms.`,
            true,
          ),
        );
      }, definition.timeout_ms);
    });
    try {
      return await Promise.race([
        definition.execute(validated_args, trusted_context).catch((error: unknown) => {
          const governance_error = as_tool_governance_error(error);
          if (governance_error) throw governance_error;
          throw new ToolGovernanceError(
            "TOOL_EXECUTION_FAILED",
            `Tool ${definition.name} failed to execute.`,
            true,
          );
        }),
        timeout_promise,
      ]);
    } finally {
      if (timeout_handle) clearTimeout(timeout_handle);
    }
  }

  /**
   * Validate adapter output before releasing it to the orchestrator.
   *
   * @param definition - Resolved tool definition.
   * @param output - Raw adapter output.
   * @returns Output validated against the output schema.
   * @throws ToolGovernanceError TOOL_OUTPUT_INVALID.
   */
  private validate_output(
    definition: AnyToolDefinition,
    output: unknown,
  ): unknown {
    const parsed = definition.output_schema.safeParse(output);
    if (!parsed.success) {
      throw new ToolGovernanceError(
        "TOOL_OUTPUT_INVALID",
        `Output of ${definition.name} failed schema validation.`,
      );
    }
    return parsed.data;
  }

  /**
   * Write one append-only audit event; audit failures never mask results.
   *
   * @param context - Trusted execution context.
   * @param definition - Resolved definition, or null for unknown tools.
   * @param details - Attempt-specific fields.
   */
  private async audit(
    context: ToolExecutionContext,
    definition: AnyToolDefinition | null,
    details: {
      tool_name?: string;
      idempotency_key: string | null;
      arguments_hash: string | null;
      outcome: ToolAuditEvent["outcome"];
      error_code: string | null;
      duration_ms: number;
    },
  ): Promise<void> {
    try {
      await this.ports.audit_log.record_tool_audit_event({
        tenant_id: context.tenant_id,
        actor_profile_id: context.actor_profile_id,
        run_id: context.run_id,
        step_id: context.step_id,
        correlation_id: context.correlation_id,
        tool_name: definition?.name ?? details.tool_name ?? "unknown",
        side_effect: definition?.side_effect ?? null,
        idempotency_key: details.idempotency_key,
        arguments_hash: details.arguments_hash,
        outcome: details.outcome,
        error_code: details.error_code,
        duration_ms: details.duration_ms,
        occurred_at: new Date().toISOString(),
      });
    } catch (audit_error) {
      log_error(MODULE, "audit — failed to record event", {
        tool: definition?.name ?? details.tool_name ?? "unknown",
        run_id: context.run_id,
        error: audit_error instanceof Error ? audit_error.message : "unknown",
      });
    }
  }
}
