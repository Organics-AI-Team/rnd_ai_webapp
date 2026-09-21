/**
 * Non-production, credential-free HTTP adapter for governed-run browser tests.
 *
 * The adapter emits the same strict public contracts as the production run API
 * and deliberately lives behind both an explicit adapter mode and a production
 * environment exclusion. It contains synthetic state only and is never release
 * evidence or an authentication replacement.
 */

import { createHash, randomUUID } from "node:crypto";

import {
  agent_run_input_v1_schema,
  resume_request_v1_schema,
  type AgentKeyV1,
  type AgentRunEventV1,
  type AgentRunInputV1,
  type AgentRunOutputV1,
} from "@rnd-ai/shared-types/src/ai/contracts";
import {
  format_sse_frame,
  parse_last_event_id,
} from "@/server/services/ai-gateway/sse";

type CommercialTestScenario =
  | "normal"
  | "clarification_approval"
  | "budget"
  | "emergency"
  | "reconnect";
type CommercialTestRole = "student" | "manager";

interface CommercialTestRun {
  readonly run_id: string;
  readonly tenant_id: string;
  readonly input: AgentRunInputV1;
  readonly scenario: CommercialTestScenario;
  readonly processed_resume_keys: Set<string>;
  events: AgentRunEventV1[];
  pending: "clarification" | "approval" | null;
  stream_count: number;
}

interface CommercialTestGlobalState {
  readonly runs: Map<string, CommercialTestRun>;
  readonly idempotency: Map<string, string>;
}

const global_test_state = globalThis as typeof globalThis & {
  __rnd_commercial_test_runs__?: CommercialTestGlobalState;
};
const state = global_test_state.__rnd_commercial_test_runs__ ?? {
  runs: new Map<string, CommercialTestRun>(),
  idempotency: new Map<string, string>(),
};
global_test_state.__rnd_commercial_test_runs__ = state;

const context_pack_hash = createHash("sha256")
  .update("commercial-browser-test-context-pack-v1")
  .digest("hex");

/** True only for the explicit local/CI adapter mode, never production. */
export function is_credential_free_commercial_test_runtime(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.COMMERCIAL_TEST_ADAPTER_MODE === "credential_free"
  );
}

/** Clear synthetic runs between integration/browser test cases. */
export function reset_commercial_test_runs(): void {
  state.runs.clear();
  state.idempotency.clear();
  console.info({ boundary: "commercial-test-run-adapter", action: "reset" });
}

/** Stable JSON error response for the test adapter boundary. */
function error_response(status: number, error: string, message: string): Response {
  return Response.json({ error, message }, { status });
}

/** Resolve the scripted scenario from an explicit synthetic message marker. */
function scenario_of(message: string): CommercialTestScenario {
  if (message.includes("scenario:clarification_approval")) return "clarification_approval";
  if (message.includes("scenario:budget")) return "budget";
  if (message.includes("scenario:emergency")) return "emergency";
  if (message.includes("scenario:reconnect")) return "reconnect";
  return "normal";
}

/** Select the real governed tool family associated with each public agent. */
function tool_for(agent_key: AgentKeyV1): "knowledge.search" | "formula.search" | "web.search" {
  if (agent_key === "formulation") return "formula.search";
  if (agent_key === "sales_rnd") return "web.search";
  return "knowledge.search";
}

/** Create monotonic safe event metadata for one synthetic run. */
function event_base(run: CommercialTestRun, sequence: number) {
  return {
    schema_version: "1" as const,
    event_id: `${run.run_id}_event_${sequence}`,
    run_id: run.run_id,
    sequence,
    occurred_at: new Date(
      Date.parse("2026-07-16T00:00:00.000Z") + sequence * 100,
    ).toISOString(),
  };
}

/** Public usage counters shared by synthetic terminal output/events. */
function usage_summary(tool_calls: number) {
  return {
    model_calls: 1,
    tool_calls,
    input_tokens: 120,
    output_tokens: 80,
    total_tokens: 200,
    cost_usd: "0.002",
  } as const;
}

/** Build a safe terminal output with retrievable synthetic evidence. */
function completed_output(
  run: CommercialTestRun,
  confirmed_formula = false,
): AgentRunOutputV1 {
  const source_id = `source_${run.input.agent_key}_${run.run_id}`;
  const artifact = run.input.agent_key === "formulation"
    ? [{
        artifact_id: `formula_${run.run_id}`,
        artifact_type: "formula" as const,
        version: confirmed_formula ? 2 : 1,
        status: confirmed_formula ? "confirmed" as const : "draft" as const,
      }]
    : [];
  return {
    schema_version: "1",
    run_id: run.run_id,
    status: "completed",
    answer: confirmed_formula
      ? "The manager-approved synthetic formula is confirmed."
      : `Synthetic evidence-backed ${run.input.agent_key} answer.`,
    decision_summary: {
      facts_considered: ["A tenant-owned synthetic source was retrieved."],
      evidence_references: [source_id],
      action_rationales: ["Used the permitted governed tool for this agent."],
      validation_results: [{ code: "synthetic_contract_valid", passed: true }],
      uncertainty: [],
    },
    citations: [{
      source_id,
      source_type: run.input.agent_key === "sales_rnd" ? "web" : "knowledge",
      reference: `synthetic://${run.tenant_id}/${source_id}`,
      retrieved_at: "2026-07-16T00:00:00.000Z",
    }],
    artifacts: artifact,
    quality_dimensions: {
      groundedness: 1,
      evidence_coverage: 1,
      source_quality: 1,
      source_freshness_days: 0,
      contradiction_state: "none",
      validation_rate: 1,
      completeness: 1,
      risk_severity: "none",
    },
    warnings: [],
    usage_summary: usage_summary(confirmed_formula ? 3 : 1),
    started_at: "2026-07-16T00:00:00.000Z",
    completed_at: confirmed_formula
      ? "2026-07-16T00:00:01.200Z"
      : "2026-07-16T00:00:00.500Z",
  };
}

/** Append one typed event after the current durable sequence. */
function append_event(
  run: CommercialTestRun,
  event: Omit<AgentRunEventV1, keyof ReturnType<typeof event_base>>,
): void {
  const sequence = run.events.length;
  run.events.push({ ...event_base(run, sequence), ...event } as AgentRunEventV1);
}

/** Append a complete read action plus evidence and usage terminal state. */
function append_normal_flow(run: CommercialTestRun): void {
  const tool_name = tool_for(run.input.agent_key);
  append_event(run, {
    type: "action.started",
    payload: { action_id: `action_${run.run_id}`, tool_name, iteration: 1 },
  });
  append_event(run, {
    type: "action.completed",
    payload: {
      action_id: `action_${run.run_id}`,
      tool_name,
      status: "ok",
      latency_ms: 25,
      cost_usd: "0",
    },
  });
  append_event(run, {
    type: "observation.added",
    payload: {
      observation_id: `observation_${run.run_id}`,
      observation_type: "synthetic_evidence",
      trust: "trusted_system",
      source_kind: "knowledge",
      tool_name,
      content_hash: createHash("sha256").update(run.run_id).digest("hex"),
    },
  });
  append_event(run, {
    type: "usage.updated",
    payload: {
      model_calls: 1,
      tool_calls: 1,
      tokens_used: 200,
      cost_usd_used: "0.002",
    },
  });
  append_event(run, {
    type: "run.completed",
    payload: {
      status: "completed",
      output_schema_version: "1",
      output: completed_output(run),
    },
  });
}

/** Append a typed safe terminal failure for limit/emergency scenarios. */
function append_failure(
  run: CommercialTestRun,
  code: "LIMIT_COST" | "POLICY_EMERGENCY_DISABLED" | "POLICY_PERMISSION_MISSING",
  message: string,
): void {
  append_event(run, {
    type: "run.failed",
    payload: { code, safe_message: message, retryable: false },
  });
}

/** Initialize the event log for one accepted synthetic run. */
function initialize_events(run: CommercialTestRun): void {
  append_event(run, {
    type: "run.accepted",
    payload: {
      agent_key: run.input.agent_key,
      context_pack_hash,
      orchestrator_version: "agentic-commercial-test-v1",
    },
  });
  if (run.scenario === "clarification_approval") {
    append_event(run, {
      type: "clarification.required",
      payload: { questions: ["What active percentage should the formula target?"] },
    });
    run.pending = "clarification";
    return;
  }
  if (run.scenario === "budget") {
    append_failure(run, "LIMIT_COST", "The run stopped at its hard cost limit.");
    return;
  }
  if (run.scenario === "emergency") {
    append_failure(
      run,
      "POLICY_EMERGENCY_DISABLED",
      "AI execution is disabled by the emergency policy.",
    );
    return;
  }
  append_normal_flow(run);
}

/** Accept one strict public run input into the synthetic durable store. */
export async function create_commercial_test_run(
  body: unknown,
  tenant_id: string,
): Promise<Response> {
  const parsed = agent_run_input_v1_schema.safeParse(body);
  if (!parsed.success || tenant_id.length === 0) {
    return error_response(400, "AI_RUN_INPUT_INVALID", "The run input is invalid.");
  }
  const idempotency_key = `${tenant_id}:${parsed.data.idempotency_key}`;
  const existing_id = state.idempotency.get(idempotency_key);
  if (existing_id) {
    return Response.json({
      run_id: existing_id,
      status: "accepted",
      executor: "agentic",
      events_url: `/api/ai/runs/${existing_id}/events`,
      already_accepted: true,
    }, { status: 202 });
  }
  const run_id = `test_run_${randomUUID()}`;
  const run: CommercialTestRun = {
    run_id,
    tenant_id,
    input: parsed.data,
    scenario: scenario_of(parsed.data.message),
    events: [],
    pending: null,
    processed_resume_keys: new Set(),
    stream_count: 0,
  };
  initialize_events(run);
  state.runs.set(run_id, run);
  state.idempotency.set(idempotency_key, run_id);
  console.info({
    boundary: "commercial-test-run-adapter",
    action: "create",
    run_id,
    agent_key: run.input.agent_key,
    scenario: run.scenario,
  });
  return Response.json({
    run_id,
    status: "accepted",
    executor: "agentic",
    events_url: `/api/ai/runs/${run_id}/events`,
    already_accepted: false,
  }, { status: 202 });
}

/** Replay typed SSE strictly after Last-Event-ID, tenant scoped. */
export async function stream_commercial_test_run(
  run_id: string,
  tenant_id: string,
  last_event_id: string | null,
): Promise<Response> {
  const run = state.runs.get(run_id);
  if (!run || run.tenant_id !== tenant_id) {
    return error_response(404, "RUN_NOT_FOUND", "The run was not found.");
  }
  const lower_bound = parse_last_event_id(last_event_id);
  let replay = run.events.filter(({ sequence }) => sequence > lower_bound);
  if (run.scenario === "reconnect" && run.stream_count === 0 && lower_bound < 0) {
    replay = replay.slice(0, 3);
  }
  run.stream_count += 1;
  const payload = `retry: 50\n\n${replay.map(format_sse_frame).join("")}`;
  console.info({
    boundary: "commercial-test-run-adapter",
    action: "stream",
    run_id,
    after_sequence: lower_bound,
    event_count: replay.length,
  });
  return new Response(payload, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

/** Append the post-clarification draft and durable manager checkpoint. */
function resume_clarification(run: CommercialTestRun): void {
  for (const [index, tool_name] of ["formula.search", "formula.draft"].entries()) {
    const action_id = `${tool_name}_${run.run_id}`;
    append_event(run, {
      type: "action.started",
      payload: { action_id, tool_name, iteration: index + 1 },
    });
    append_event(run, {
      type: "action.completed",
      payload: { action_id, tool_name, status: "ok", latency_ms: 25, cost_usd: "0" },
    });
  }
  append_event(run, {
    type: "artifact.updated",
    payload: { artifact_id: `formula_${run.run_id}`, artifact_type: "formula", version: 1 },
  });
  append_event(run, {
    type: "approval.required",
    payload: {
      approval_id: `approval_${run.run_id}`,
      summary: "Confirm the validated synthetic formula as official.",
      tool_name: "formula.confirm",
    },
  });
  run.pending = "approval";
}

/** Append the manager decision and terminal confirmed/denied state. */
function resume_approval(
  run: CommercialTestRun,
  decision: "approve" | "deny",
): void {
  if (decision === "deny") {
    append_failure(run, "POLICY_PERMISSION_MISSING", "The manager denied the requested action.");
    run.pending = null;
    return;
  }
  const action_id = `formula.confirm_${run.run_id}`;
  append_event(run, {
    type: "action.started",
    payload: { action_id, tool_name: "formula.confirm", iteration: 3 },
  });
  append_event(run, {
    type: "action.completed",
    payload: { action_id, tool_name: "formula.confirm", status: "ok", latency_ms: 25, cost_usd: "0" },
  });
  append_event(run, {
    type: "artifact.updated",
    payload: { artifact_id: `formula_${run.run_id}`, artifact_type: "formula", version: 2 },
  });
  append_event(run, {
    type: "usage.updated",
    payload: { model_calls: 1, tool_calls: 3, tokens_used: 200, cost_usd_used: "0.002" },
  });
  append_event(run, {
    type: "run.completed",
    payload: {
      status: "completed",
      output_schema_version: "1",
      output: completed_output(run, true),
    },
  });
  run.pending = null;
}

/** Accept one strict clarification/approval resume, tenant and role scoped. */
export async function resume_commercial_test_run(
  run_id: string,
  tenant_id: string,
  role: CommercialTestRole,
  body: unknown,
): Promise<Response> {
  const run = state.runs.get(run_id);
  if (!run || run.tenant_id !== tenant_id) {
    return error_response(404, "RUN_NOT_FOUND", "The run was not found.");
  }
  const parsed = resume_request_v1_schema.safeParse(body);
  if (!parsed.success) {
    return error_response(400, "RESUME_REQUEST_INVALID", "The resume input is invalid.");
  }
  if (run.processed_resume_keys.has(parsed.data.idempotency_key)) {
    return Response.json({ run_id, status: "accepted", already_accepted: true }, { status: 202 });
  }
  if (parsed.data.kind === "clarification") {
    if (run.pending !== "clarification") {
      return error_response(409, "RUN_NOT_WAITING", "The run is not waiting for clarification.");
    }
    resume_clarification(run);
  } else {
    if (role !== "manager") {
      return error_response(403, "FORBIDDEN", "Manager approval is required.");
    }
    if (
      run.pending !== "approval" ||
      parsed.data.approval_id !== `approval_${run.run_id}`
    ) {
      return error_response(409, "APPROVAL_NOT_PENDING", "The approval is not pending.");
    }
    resume_approval(run, parsed.data.decision);
  }
  run.processed_resume_keys.add(parsed.data.idempotency_key);
  console.info({
    boundary: "commercial-test-run-adapter",
    action: "resume",
    run_id,
    kind: parsed.data.kind,
  });
  return Response.json({ run_id, status: "accepted", already_accepted: false }, { status: 202 });
}
