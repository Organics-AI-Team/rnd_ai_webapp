/**
 * Native adapter for governed agentic v1 events.
 *
 * The filename retains the historical plan term `ooda`; persisted and reported
 * executor identity is always the canonical G4 value `agentic`.
 */
import { z } from "zod";
import {
  agent_run_event_v1_schema,
  usage_summary_v1_schema,
  type AgentRunEventV1,
  type UsageSummaryV1,
} from "../../packages/shared-types/src/ai/contracts";
import {
  assemble_recorded_run,
  evaluator_audit_facts_v1_schema,
  type EvaluatorAuditFactsV1,
} from "./adapter-types";
import type { RecordedRun } from "./recorded-run";

const agentic_adapter_input_v1_schema = z
  .object({
    events: z.array(agent_run_event_v1_schema).min(1),
    audit: evaluator_audit_facts_v1_schema,
    reported_usage: usage_summary_v1_schema.optional(),
  })
  .strict();

export interface AgenticAdapterInputV1 {
  readonly events: readonly AgentRunEventV1[];
  readonly audit: EvaluatorAuditFactsV1;
  readonly reported_usage?: UsageSummaryV1;
}

/**
 * Sort typed events and reject ambiguous sequence/run identity recordings.
 *
 * @param events - Strict native agentic events.
 * @returns Events sorted by their durable sequence number.
 * @throws Error when sequences duplicate or events span multiple runs.
 */
function normalize_events(events: readonly AgentRunEventV1[]): AgentRunEventV1[] {
  const sorted = [...events].sort((left, right) => left.sequence - right.sequence);
  const run_id = sorted[0]?.run_id;
  for (let index = 0; index < sorted.length; index += 1) {
    if (index > 0 && sorted[index - 1].sequence === sorted[index].sequence) {
      throw new Error("duplicate event sequence in agentic recording");
    }
    if (sorted[index].run_id !== run_id) {
      throw new Error("agentic recording contains multiple run IDs");
    }
  }
  return sorted;
}

/**
 * Derive the strict terminal and response modes from typed events.
 *
 * @param events - Sequence-normalized native events.
 * @param audit - Evaluator facts supplying semantic answer/refusal mode.
 * @returns Terminal status, response mode, and safe error code.
 */
function derive_terminal(
  events: readonly AgentRunEventV1[],
  audit: EvaluatorAuditFactsV1,
): Pick<RecordedRun, "terminal_status" | "response_mode" | "error_code"> {
  const terminal_events = events.filter(
    ({ type }) => type === "run.completed" || type === "run.failed",
  );
  if (terminal_events.length > 1) {
    throw new Error("agentic recording contains multiple terminal events");
  }
  const terminal = terminal_events[0];
  if (terminal?.type === "run.completed") {
    return { terminal_status: "completed", response_mode: audit.response_mode, error_code: null };
  }
  if (terminal?.type === "run.failed") {
    return {
      terminal_status: "failed",
      response_mode: "fail_safe",
      error_code: terminal.payload.code,
    };
  }
  if (events.some(({ type }) => type === "approval.required")) {
    return {
      terminal_status: "waiting_approval",
      response_mode: "request_approval",
      error_code: null,
    };
  }
  if (events.some(({ type }) => type === "clarification.required")) {
    return {
      terminal_status: "waiting_clarification",
      response_mode: "clarify",
      error_code: null,
    };
  }
  throw new Error("agentic recording has no terminal or interrupt event");
}

/**
 * Resolve reported usage from terminal output or explicit interrupt recording.
 *
 * @param events - Sequence-normalized native events.
 * @param fallback - Evaluator-recorded usage for non-terminal interrupts.
 * @returns Exact reported usage counters.
 * @throws Error when no complete usage record exists.
 */
function derive_reported_usage(
  events: readonly AgentRunEventV1[],
  fallback: UsageSummaryV1 | undefined,
): UsageSummaryV1 {
  const completed = events.find(({ type }) => type === "run.completed");
  if (completed?.type === "run.completed" && completed.payload.output !== undefined) {
    if (completed.payload.output.run_id !== completed.run_id) {
      throw new Error("terminal output run ID does not match events");
    }
    return completed.payload.output.usage_summary;
  }
  if (fallback !== undefined) return fallback;
  throw new Error("agentic recording requires complete reported usage");
}

/**
 * Normalize governed agentic events into the executor-neutral scorer boundary.
 *
 * @param input - Typed native events and independently captured audit facts.
 * @returns Strict RecordedRunV1 with canonical executor value agentic.
 */
export function adapt_agentic_run(input: unknown): RecordedRun {
  const parsed = agentic_adapter_input_v1_schema.parse(input);
  const events = normalize_events(parsed.events);
  const terminal = derive_terminal(events, parsed.audit);
  const tool_calls = events
    .filter((event): event is Extract<AgentRunEventV1, { type: "action.completed" }> =>
      event.type === "action.completed",
    )
    .map((event) => ({
      name: event.payload.tool_name,
      sequence: event.sequence,
      status: event.payload.status,
    }));
  const clarification_interrupts = events
    .filter((event): event is Extract<AgentRunEventV1, { type: "clarification.required" }> =>
      event.type === "clarification.required",
    )
    .map((event) => ({
      questions: event.payload.questions,
      tool_calls_before_interrupt: events.filter(
        (candidate) =>
          candidate.sequence < event.sequence && candidate.type === "action.started",
      ).length,
    }));

  return assemble_recorded_run(
    {
      executor: "agentic",
      ...terminal,
      tool_calls,
      clarification_interrupts,
      reported_usage: derive_reported_usage(events, parsed.reported_usage),
    },
    parsed.audit,
  );
}

/**
 * Backward-compatible import alias for the historical plan terminology.
 *
 * @param input - Same strict input accepted by adapt_agentic_run.
 * @returns Canonical agentic RecordedRunV1.
 */
export function adapt_ooda_run(input: unknown): RecordedRun {
  return adapt_agentic_run(input);
}
