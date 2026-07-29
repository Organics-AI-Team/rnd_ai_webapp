/**
 * Act: the deterministic execution node.
 *
 * Invokes ToolExecutor exactly once per action idempotency key
 * (run/iteration/tool/arguments-hash), retries only executor-reported
 * retryable failures within the tool definition's retry budget, validates
 * output against the tool's output schema, and appends a normalized,
 * trust-labeled ObservationV1. Deterministic evaluators (schema checks,
 * evidence bookkeeping, contradiction flags, freshness) run here on every
 * result — they never call models.
 *
 * Policy/authorization failures are NOT caught here as model-retryable
 * errors; unexpected executor exceptions propagate.
 */
import Decimal from "decimal.js";
import type { ActionResultV1, ProposedActionV1 } from "../contracts";
import { build_run_event } from "../events";
import { sha256_hex } from "../hash";
import type {
  AgentLoopRuntime,
  ToolExecutionResultV1,
  ToolRuntimeDefinitionV1,
} from "../ports";
import { log_loop_event } from "../ports";
import { build_run_error } from "../routing";
import { build_observation } from "../schemas/observation";
import type { ObservationV1 } from "../schemas/observation";
import type { AgentLoopStateType, AgentLoopStateUpdate } from "../state";

/**
 * Derive the deterministic idempotency key for one gated action.
 *
 * @param state - Current loop state (run and iteration scope).
 * @param action - Pending tool action with its canonical arguments hash.
 * @returns Stable key so replays and retries can never duplicate an effect.
 */
export function derive_idempotency_key(
  state: AgentLoopStateType,
  action: Extract<ProposedActionV1, { kind: "tool" }>,
): string {
  return `${state.run_id}:${state.iteration}:${action.tool_name}:${action.arguments_hash}`;
}

/**
 * Extract evidence source identifiers from a tool output deterministically.
 *
 * @param output - Validated tool output payload.
 * @returns String IDs found under source_ids/evidence_ids (bounded at 100).
 */
function extract_source_ids(output: unknown): string[] {
  if (output === null || typeof output !== "object") return [];
  const record = output as Record<string, unknown>;
  const collected: string[] = [];
  for (const field of ["source_ids", "evidence_ids"]) {
    const value = record[field];
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string" && entry.length > 0) {
          collected.push(entry);
          if (collected.length >= 100) return collected;
        }
      }
    }
  }
  return collected;
}

/**
 * Find a prior result for the same normalized action with different content.
 *
 * @param state - Current loop state.
 * @param action - Executed tool action.
 * @param content_hash - Content hash of the new result.
 * @returns The contradicting prior observation ID, or null.
 */
function find_contradiction(
  state: AgentLoopStateType,
  action: Extract<ProposedActionV1, { kind: "tool" }>,
  content_hash: string,
): string | null {
  for (const observation of state.observations) {
    if (
      observation.type === "tool_result" &&
      observation.source.tool_name === action.tool_name &&
      observation.metadata["arguments_hash"] === action.arguments_hash &&
      observation.content_hash !== content_hash
    ) {
      return observation.observation_id;
    }
  }
  return null;
}

/**
 * Compute result freshness in days when the output carries retrieved_at.
 *
 * @param output - Validated tool output payload.
 * @param now_ms - Deterministic current time in epoch milliseconds.
 * @returns Age in whole days, or null when no parseable timestamp exists.
 */
function compute_age_days(output: unknown, now_ms: number): number | null {
  if (output === null || typeof output !== "object") return null;
  const retrieved_at = (output as Record<string, unknown>)["retrieved_at"];
  if (typeof retrieved_at !== "string") return null;
  const timestamp = Date.parse(retrieved_at);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.floor((now_ms - timestamp) / 86_400_000));
}

/**
 * Execute with bounded retries for executor-reported retryable failures.
 *
 * @param state - Current loop state.
 * @param runtime - Node runtime.
 * @param action - Pending tool action.
 * @param definition - Runtime tool definition (retry budget).
 * @param idempotency_key - Stable action key passed on every attempt.
 * @returns Final result plus attempt count and summed cost/latency.
 */
async function execute_with_retries(
  state: AgentLoopStateType,
  runtime: AgentLoopRuntime,
  action: Extract<ProposedActionV1, { kind: "tool" }>,
  definition: ToolRuntimeDefinitionV1,
  idempotency_key: string,
): Promise<{
  result: ToolExecutionResultV1;
  attempts: number;
  total_cost: Decimal;
  total_latency_ms: number;
}> {
  const max_attempts = 1 + Math.max(0, definition.retry);
  let attempts = 0;
  let total_cost = new Decimal(0);
  let total_latency_ms = 0;
  let result: ToolExecutionResultV1;
  do {
    attempts += 1;
    result = await runtime.ports.tools.execute(
      {
        idempotency_key,
        tool_name: action.tool_name,
        arguments: action.arguments,
        run_id: state.run_id,
        iteration: state.iteration,
      },
      runtime.context,
    );
    total_cost = total_cost.plus(new Decimal(result.cost_usd));
    total_latency_ms += result.latency_ms;
  } while (
    result.status === "error" &&
    result.retryable &&
    attempts < max_attempts
  );
  return { result, attempts, total_cost, total_latency_ms };
}

/**
 * Execute the authorized pending action and append normalized observations.
 *
 * @param state - Current loop state with an allowed pending tool action.
 * @param runtime - Injected ports, trusted context, and config.
 * @returns State update (act returns to agent via the fixed edge): the
 *          observation(s), action result, usage, and typed events — or a
 *          typed error update on a governor invariant violation.
 */
export async function act(
  state: AgentLoopStateType,
  runtime: AgentLoopRuntime,
): Promise<AgentLoopStateUpdate> {
  log_loop_event(runtime, "info", "act.start", {
    iteration: state.iteration,
  });

  const action = state.pending_action;
  if (!action || action.kind !== "tool") {
    log_loop_event(runtime, "error", "act.missing_pending_action");
    return {
      error: build_run_error(
        runtime,
        "ORCHESTRATOR_INVARIANT_VIOLATION",
        "The act node received no pending tool action.",
      ),
    };
  }

  const definition = runtime.ports.tools.describe(
    action.tool_name,
    runtime.context,
  );
  if (!definition) {
    log_loop_event(runtime, "error", "act.unregistered_tool", {
      tool_name: action.tool_name,
    });
    return {
      error: build_run_error(
        runtime,
        "ORCHESTRATOR_INVARIANT_VIOLATION",
        "An authorized action referenced an unregistered tool.",
      ),
    };
  }

  const { clock, ids } = runtime.ports;
  const sources = { clock, ids };
  const idempotency_key = derive_idempotency_key(state, action);
  const action_id = ids.next_id();
  const events = [
    build_run_event(state, sources, 0, "action.started", {
      action_id,
      tool_name: action.tool_name,
      iteration: state.iteration,
    }),
  ];

  const { result, attempts, total_cost, total_latency_ms } =
    await execute_with_retries(
      state,
      runtime,
      action,
      definition,
      idempotency_key,
    );

  const observations: ObservationV1[] = [];
  const warnings: string[] = [];
  let status: ActionResultV1["status"] = "error";

  if (result.status === "ok") {
    const schema_check = definition.output_schema.safeParse(result.output);
    if (!schema_check.success) {
      log_loop_event(runtime, "warn", "act.tool_output_invalid", {
        tool_name: action.tool_name,
      });
      observations.push(
        build_observation({
          observation_id: ids.next_id(),
          run_id: state.run_id,
          iteration: state.iteration,
          type: "tool_error",
          source: {
            kind: "tool",
            tool_name: action.tool_name,
            source_ids: [],
          },
          content: `Tool "${action.tool_name}" returned output that violates its contract. Re-plan or finalize with available evidence.`,
          trust: "trusted_system",
          cost_usd: total_cost.toString(),
          latency_ms: total_latency_ms,
          occurred_at: clock.now_iso(),
          metadata: { code: "TOOL_OUTPUT_INVALID", arguments_hash: action.arguments_hash },
        }),
      );
    } else {
      status = "ok";
      const content = JSON.stringify(result.output ?? null);
      const content_hash = sha256_hex(content);
      const contradicts = find_contradiction(state, action, content_hash);
      const age_days = compute_age_days(result.output, clock.now_ms());
      const source_ids = extract_source_ids(result.output);
      observations.push(
        build_observation({
          observation_id: ids.next_id(),
          run_id: state.run_id,
          iteration: state.iteration,
          type: "tool_result",
          source: {
            kind: "tool",
            tool_name: action.tool_name,
            source_ids,
          },
          content,
          trust: definition.result_trust,
          cost_usd: total_cost.toString(),
          latency_ms: total_latency_ms,
          occurred_at: clock.now_iso(),
          metadata: {
            arguments_hash: action.arguments_hash,
            schema_valid: true,
            evidence_ids: source_ids,
            ...(contradicts ? { contradicts_observation_id: contradicts } : {}),
            ...(age_days !== null ? { age_days } : {}),
          },
        }),
      );

      if (definition.produces_artifact) {
        const validation = await runtime.ports.artifacts.validate_draft(
          result.output,
          runtime.context,
        );
        const blocking = validation.findings.filter(
          (finding) => finding.severity === "blocking",
        );
        for (const finding of validation.findings) {
          if (finding.severity === "warning") {
            warnings.push(finding.safe_message);
          }
        }
        if (!validation.valid || blocking.length > 0) {
          log_loop_event(runtime, "warn", "act.artifact_validation_blocking", {
            tool_name: action.tool_name,
            blocking_count: blocking.length,
          });
          observations.push(
            build_observation({
              observation_id: ids.next_id(),
              run_id: state.run_id,
              iteration: state.iteration,
              type: "validation_finding",
              source: {
                kind: "system",
                tool_name: action.tool_name,
                source_ids: [],
              },
              content: JSON.stringify(
                blocking.map((finding) => ({
                  code: finding.code,
                  safe_message: finding.safe_message,
                })),
              ),
              trust: "trusted_system",
              cost_usd: "0",
              latency_ms: 0,
              occurred_at: clock.now_iso(),
              metadata: { blocking: true, finding_count: blocking.length },
            }),
          );
        }
      }
    }
  } else {
    log_loop_event(runtime, "warn", "act.tool_error", {
      tool_name: action.tool_name,
      error_code: result.error_code,
      attempts,
    });
    observations.push(
      build_observation({
        observation_id: ids.next_id(),
        run_id: state.run_id,
        iteration: state.iteration,
        type: "tool_error",
        source: { kind: "tool", tool_name: action.tool_name, source_ids: [] },
        content:
          result.safe_error_message ??
          `Tool "${action.tool_name}" failed without a safe message.`,
        trust: "trusted_system",
        cost_usd: total_cost.toString(),
        latency_ms: total_latency_ms,
        occurred_at: clock.now_iso(),
        metadata: {
          error_code: result.error_code ?? "TOOL_EXECUTION_FAILED",
          arguments_hash: action.arguments_hash,
          attempts,
        },
      }),
    );
  }

  const primary_observation = observations[0]!;
  for (const [index, observation] of observations.entries()) {
    events.push(
      build_run_event(state, sources, 1 + index, "observation.added", {
        observation_id: observation.observation_id,
        observation_type: observation.type,
        trust: observation.trust,
        source_kind: observation.source.kind,
        tool_name: observation.source.tool_name,
        content_hash: observation.content_hash,
      }),
    );
  }
  events.push(
    build_run_event(
      state,
      sources,
      1 + observations.length,
      "action.completed",
      {
        action_id,
        tool_name: action.tool_name,
        status,
        latency_ms: total_latency_ms,
        cost_usd: total_cost.toString(),
      },
    ),
  );

  const action_result: ActionResultV1 = {
    action_id,
    run_id: state.run_id,
    iteration: state.iteration,
    tool_name: action.tool_name,
    arguments_hash: action.arguments_hash,
    idempotency_key,
    status,
    attempts,
    cost_usd: total_cost.toString(),
    latency_ms: total_latency_ms,
    observation_id: primary_observation.observation_id,
    occurred_at: clock.now_iso(),
  };

  log_loop_event(runtime, "info", "act.finish", {
    tool_name: action.tool_name,
    status,
    attempts,
  });
  return {
    pending_action: null,
    observations,
    warnings,
    action_results: [action_result],
    events,
    usage: {
      ...state.usage,
      tool_calls: state.usage.tool_calls + 1,
      cost_usd_used: new Decimal(state.usage.cost_usd_used)
        .plus(total_cost)
        .toString(),
    },
  };
}
