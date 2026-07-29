/**
 * Deterministic native recordings for the credential-free commercial campaign.
 *
 * This adapter exercises the immutable corpus, native legacy/agentic adapters,
 * scorers, report builder, and release-threshold plumbing without a provider or
 * production tenant. Its outputs are explicitly test evidence and can never be
 * accepted by the reviewed-release comparator mode.
 */

import { createHash } from "node:crypto";

import Decimal from "decimal.js";

import type {
  AgentRunEventV1,
  AgentRunOutputV1,
  UsageSummaryV1,
} from "../../packages/shared-types/src/ai/contracts";
import type { EvalCaseV1 } from "../schemas/eval-case";
import type { EvaluatorAuditFactsV1 } from "./adapter-types";
import type { NativeLegacyRecordingV1 } from "./legacy-adapter";

const context_pack_hash = createHash("sha256")
  .update("commercial-credential-free-context-pack-v1")
  .digest("hex");
const grader_prompt_hash = createHash("sha256")
  .update("commercial-credential-free-blinded-grader-v1")
  .digest("hex");

/** Complete native input consumed by the strict legacy adapter. */
export interface CredentialFreeLegacyInput {
  readonly native: NativeLegacyRecordingV1;
  readonly audit: EvaluatorAuditFactsV1;
}

/** Complete native input consumed by the strict agentic adapter. */
export interface CredentialFreeAgenticInput {
  readonly events: readonly AgentRunEventV1[];
  readonly audit: EvaluatorAuditFactsV1;
  readonly reported_usage?: UsageSummaryV1;
}

/** Return reconciled deterministic usage for one synthetic run. */
function usage(test_case: EvalCaseV1): UsageSummaryV1 {
  const tool_calls = test_case.expected_tools.length;
  const input_tokens = 100 + test_case.input.message.length;
  const output_tokens = test_case.expected_behavior.terminal_status === "failed" ? 10 : 50;
  return {
    model_calls: 1,
    tool_calls,
    input_tokens,
    output_tokens,
    total_tokens: input_tokens + output_tokens,
    cost_usd: "0.001",
  };
}

/** Build a valid formula satisfying the exact synthetic case constraints. */
function formula_for(test_case: EvalCaseV1): EvaluatorAuditFactsV1["formula"] {
  const constraints = test_case.expected_artifact.formula_constraints;
  if (constraints === null) return null;

  const ingredients = new Map<
    string,
    { material_id: string; percentage: Decimal; phase: "water" | "oil" | "cool_down" | "ph_adjustment" }
  >();
  for (const requirement of constraints.phase_requirements) {
    ingredients.set(requirement.material_id, {
      material_id: requirement.material_id,
      percentage: new Decimal(0),
      phase: requirement.phase,
    });
  }
  for (const limit of constraints.usage_limits) {
    const current = ingredients.get(limit.material_id);
    ingredients.set(limit.material_id, {
      material_id: limit.material_id,
      percentage: new Decimal(limit.minimum_percent),
      phase: current?.phase ?? "cool_down",
    });
  }

  const filler = constraints.phase_requirements.find(
    ({ material_id }) =>
      !constraints.usage_limits.some((limit) => limit.material_id === material_id),
  );
  if (!filler) throw new Error("credential-free formula fixture requires a filler material");
  const current_total = [...ingredients.values()].reduce(
    (total, ingredient) => total.plus(ingredient.percentage),
    new Decimal(0),
  );
  const filler_ingredient = ingredients.get(filler.material_id);
  if (!filler_ingredient || current_total.greaterThan(100)) {
    throw new Error("credential-free formula fixture is invalid");
  }
  filler_ingredient.percentage = filler_ingredient.percentage.plus(
    new Decimal(100).minus(current_total),
  );

  return {
    ingredients: [...ingredients.values()].map((ingredient) => ({
      material_id: ingredient.material_id,
      percentage: ingredient.percentage.toString(),
      phase: ingredient.phase,
    })),
    cost_thb_per_kg: new Decimal(constraints.maximum_cost_thb_per_kg)
      .dividedBy(2)
      .toString(),
    manager_confirmation_recorded:
      test_case.approval.expected_outcome === "approved",
  };
}

/** Create independently captured evaluator facts for a synthetic native run. */
function audit_facts(
  test_case: EvalCaseV1,
  executor: "legacy" | "agentic",
): EvaluatorAuditFactsV1 {
  const legacy_gap =
    executor === "legacy" &&
    ["clarification_approval", "security"].includes(test_case.category);
  const exact_checks = Object.fromEntries(
    test_case.deterministic_checks.map((check, index) => [
      check,
      !(legacy_gap && index === 0),
    ]),
  );
  const claims = test_case.required_evidence.map((evidence, index) => ({
    id: `claim_${index + 1}`,
    kind: "factual" as const,
    text: evidence.supports,
  }));
  const citations = test_case.required_evidence.map((evidence, index) => ({
    claim_ids: [`claim_${index + 1}`],
    source_id: evidence.source_id,
    source_type: evidence.source_type,
    locator: `synthetic://${test_case.tenant_fixture}/${evidence.source_id}`,
    content_hash: createHash("sha256")
      .update(`${test_case.id}:${evidence.source_id}`)
      .digest("hex"),
    retrievable: true,
    supports_claim: true,
  }));
  const run_usage = usage(test_case);
  const human_wait_ms = ["waiting_clarification", "waiting_approval"].includes(
    test_case.expected_behavior.terminal_status,
  )
    ? 1_000
    : 0;

  return {
    response_mode: test_case.expected_behavior.response_mode,
    exact_checks,
    permissions_used: [...test_case.expected_behavior.required_permissions],
    side_effects: [...test_case.expected_behavior.allowed_side_effects],
    evidence_source_ids: test_case.required_evidence.map(({ source_id }) => source_id),
    accessed_tenant_ids: [test_case.tenant_fixture],
    unauthorized_commit_count: 0,
    approval_bypass_count: 0,
    hard_budget_bypass_count: 0,
    approval: {
      outcome: test_case.approval.expected_outcome,
      approver_role: test_case.approval.approver_role,
      manager_confirmation_recorded:
        test_case.approval.expected_outcome === "approved",
    },
    claims,
    citations,
    formula: formula_for(test_case),
    ledger_usage: run_usage,
    approved_cost_usd: "0.025",
    performance: {
      accepted_latency_ms: 100,
      completion_latency_ms: 500 + human_wait_ms,
      human_wait_ms,
      maximum_accepted_latency_ms: 2_000,
      maximum_completion_latency_ms:
        test_case.category === "formulation" ? 90_000 : 30_000,
      timed_out: false,
    },
    grader: {
      score: 1,
      blinded: true,
      provider: "credential-free",
      model: "deterministic-rubric-v1",
      prompt_version: "commercial-rubric-v1",
      prompt_hash: grader_prompt_hash,
    },
  };
}

/** Build one terminal output for a completed credential-free agentic run. */
function completed_output(
  test_case: EvalCaseV1,
  run_id: string,
  run_usage: UsageSummaryV1,
): AgentRunOutputV1 {
  return {
    schema_version: "1",
    run_id,
    status: "completed",
    answer: `Credential-free ${test_case.expected_behavior.response_mode} response.`,
    decision_summary: {
      facts_considered: test_case.required_evidence.map(({ supports }) => supports),
      evidence_references: test_case.required_evidence.map(({ source_id }) => source_id),
      action_rationales: ["Executed the deterministic credential-free test adapter."],
      validation_results: test_case.deterministic_checks.map((code) => ({
        code,
        passed: true,
      })),
      uncertainty: [],
    },
    citations: test_case.required_evidence.map((evidence) => ({
      source_id: evidence.source_id,
      source_type: evidence.source_type,
      reference: `synthetic://${test_case.tenant_fixture}/${evidence.source_id}`,
      retrieved_at: "2026-07-16T00:00:00.000Z",
    })),
    artifacts: [],
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
    usage_summary: run_usage,
    started_at: "2026-07-16T00:00:00.000Z",
    completed_at: "2026-07-16T00:00:00.500Z",
  };
}

/** Create a typed event with stable identity and monotonic sequence. */
function event_base(run_id: string, sequence: number) {
  return {
    schema_version: "1" as const,
    event_id: `${run_id}_event_${sequence}`,
    run_id,
    sequence,
    occurred_at: new Date(
      Date.parse("2026-07-16T00:00:00.000Z") + sequence * 10,
    ).toISOString(),
  };
}

/** Build strict native agentic events for one immutable corpus case. */
function agentic_events(test_case: EvalCaseV1): AgentRunEventV1[] {
  const run_id = `run_${test_case.id}`;
  const run_usage = usage(test_case);
  const events: AgentRunEventV1[] = [
    {
      ...event_base(run_id, 0),
      type: "run.accepted",
      payload: {
        agent_key: test_case.input.agent_key,
        context_pack_hash,
        orchestrator_version: "agentic-credential-free-v1",
      },
    },
  ];
  for (const [index, tool_name] of test_case.expected_tools.entries()) {
    const started_sequence = events.length;
    events.push({
      ...event_base(run_id, started_sequence),
      type: "action.started",
      payload: {
        action_id: `${run_id}_action_${index + 1}`,
        tool_name,
        iteration: index + 1,
      },
    });
    const completed_sequence = events.length;
    events.push({
      ...event_base(run_id, completed_sequence),
      type: "action.completed",
      payload: {
        action_id: `${run_id}_action_${index + 1}`,
        tool_name,
        status: "ok",
        latency_ms: 25,
        cost_usd: "0",
      },
    });
  }

  const sequence = events.length;
  switch (test_case.expected_behavior.terminal_status) {
    case "completed":
      events.push({
        ...event_base(run_id, sequence),
        type: "run.completed",
        payload: {
          status: "completed",
          output_schema_version: "1",
          output: completed_output(test_case, run_id, run_usage),
        },
      });
      break;
    case "failed":
      events.push({
        ...event_base(run_id, sequence),
        type: "run.failed",
        payload: {
          code: test_case.expected_behavior.expected_error_code ?? "ORCHESTRATOR_INVARIANT_VIOLATION",
          safe_message: "The credential-free run failed safely.",
          retryable: false,
        },
      });
      break;
    case "waiting_clarification":
      events.push({
        ...event_base(run_id, sequence),
        type: "clarification.required",
        payload: { questions: ["Please provide the missing synthetic requirement."] },
      });
      break;
    case "waiting_approval":
      events.push({
        ...event_base(run_id, sequence),
        type: "approval.required",
        payload: {
          approval_id: `${run_id}_approval`,
          summary: "Manager approval is required for the synthetic action.",
          tool_name: test_case.expected_tools.at(-1) ?? "formula.confirm",
        },
      });
      break;
  }
  return events;
}

/** Create one native legacy recording and independent evaluator audit. */
export function credential_free_legacy_input(
  test_case: EvalCaseV1,
): CredentialFreeLegacyInput {
  const run_usage = usage(test_case);
  return {
    native: {
      schema_version: "legacy-1",
      terminal_status: test_case.expected_behavior.terminal_status,
      response_mode: test_case.expected_behavior.response_mode,
      error_code: test_case.expected_behavior.expected_error_code,
      answer: `Credential-free legacy ${test_case.expected_behavior.response_mode} response.`,
      tool_calls: test_case.expected_tools.map((tool_name, sequence) => ({
        tool_name,
        sequence,
        status: "ok" as const,
      })),
      clarification_interrupts:
        test_case.expected_behavior.response_mode === "clarify"
          ? [{ questions: ["Please provide the missing synthetic requirement."], tool_calls_before_interrupt: 0 }]
          : [],
      usage: run_usage,
    },
    audit: audit_facts(test_case, "legacy"),
  };
}

/** Create typed native agentic events and independent evaluator audit. */
export function credential_free_agentic_input(
  test_case: EvalCaseV1,
): CredentialFreeAgenticInput {
  return {
    events: agentic_events(test_case),
    audit: audit_facts(test_case, "agentic"),
    ...(test_case.expected_behavior.terminal_status === "completed"
      ? {}
      : { reported_usage: usage(test_case) }),
  };
}
