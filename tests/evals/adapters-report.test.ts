import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentRunEventV1, AgentRunOutputV1 } from "../../packages/shared-types/src/ai/contracts";
import { eval_case_v1_schema, type EvalCaseV1 } from "../../evals/schemas/eval-case";
import {
  type EvaluatorAuditFactsV1,
} from "../../evals/runner/adapter-types";
import { adapt_legacy_run } from "../../evals/runner/legacy-adapter";
import { adapt_agentic_run, adapt_ooda_run } from "../../evals/runner/ooda-adapter";
import {
  build_evaluation_report,
  render_report,
  wilson_interval,
  type ReportCaseInput,
} from "../../evals/report/render-report";
import {
  grade_case_with_model,
  type ModelGraderPort,
  type ModelGraderRequest,
} from "../../evals/scorers/model-grader";
import type { CaseScore } from "../../evals/runner/run-evaluation";

/**
 * Load one strict released corpus case for adapter/grader tests.
 *
 * @param file_name - JSONL basename below the v1 corpus directory.
 * @returns First case in the selected fixture.
 */
function load_case(file_name: string): EvalCaseV1 {
  const line = readFileSync(join(process.cwd(), "evals/fixtures/v1", file_name), "utf8")
    .split("\n")
    .find((value) => value.length > 0);
  return eval_case_v1_schema.parse(JSON.parse(line ?? "null") as unknown);
}

const raw_material_case = load_case("raw-materials.jsonl");

/**
 * Build deterministic evaluator-captured facts shared by native adapters.
 *
 * @param test_case - Corpus case whose expectations the recording satisfies.
 * @returns Complete strict evaluator audit facts.
 */
function audit_facts(test_case: EvalCaseV1): EvaluatorAuditFactsV1 {
  return {
    response_mode: test_case.expected_behavior.response_mode,
    exact_checks: Object.fromEntries(test_case.deterministic_checks.map((check) => [check, true])),
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
      manager_confirmation_recorded: false,
    },
    claims: [],
    citations: [],
    formula: null,
    ledger_usage: {
      model_calls: 1,
      tool_calls: 1,
      input_tokens: 20,
      output_tokens: 10,
      total_tokens: 30,
      cost_usd: "0.02",
    },
    approved_cost_usd: "0.10",
    performance: {
      accepted_latency_ms: 100,
      completion_latency_ms: 500,
      human_wait_ms: 0,
      maximum_accepted_latency_ms: 2_000,
      maximum_completion_latency_ms: 30_000,
      timed_out: false,
    },
    grader: null,
  };
}

/** Build a complete native agentic terminal output. */
function agentic_output(): AgentRunOutputV1 {
  return {
    schema_version: "1",
    run_id: "run_agentic_1",
    status: "completed",
    answer: "Synthetic, evidence-backed answer.",
    decision_summary: {
      facts_considered: [],
      evidence_references: [],
      action_rationales: [],
      validation_results: [],
      uncertainty: [],
    },
    citations: [],
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
    usage_summary: {
      model_calls: 1,
      tool_calls: 1,
      input_tokens: 20,
      output_tokens: 10,
      total_tokens: 30,
      cost_usd: "0.02",
    },
    started_at: "2026-07-16T00:00:00.000Z",
    completed_at: "2026-07-16T00:00:00.500Z",
  };
}

/** Build typed native agentic events with one tool completion and terminal output. */
function agentic_events(): AgentRunEventV1[] {
  return [
    {
      schema_version: "1",
      event_id: "event_0",
      run_id: "run_agentic_1",
      sequence: 0,
      occurred_at: "2026-07-16T00:00:00.000Z",
      type: "run.accepted",
      payload: {
        agent_key: "raw_material_research",
        context_pack_hash: "a".repeat(64),
        orchestrator_version: "agentic-1.0.0",
      },
    },
    {
      schema_version: "1",
      event_id: "event_1",
      run_id: "run_agentic_1",
      sequence: 1,
      occurred_at: "2026-07-16T00:00:00.100Z",
      type: "action.completed",
      payload: {
        action_id: "action_1",
        tool_name: "knowledge.search",
        status: "ok",
        latency_ms: 100,
        cost_usd: "0.001",
      },
    },
    {
      schema_version: "1",
      event_id: "event_2",
      run_id: "run_agentic_1",
      sequence: 2,
      occurred_at: "2026-07-16T00:00:00.500Z",
      type: "run.completed",
      payload: {
        status: "completed",
        output_schema_version: "1",
        output: agentic_output(),
      },
    },
  ];
}

/** Build a report-ready score with controlled pass and performance values. */
function case_score(passed: boolean, latency_ms: number, cost_usd: string): CaseScore {
  return {
    passed,
    failures: passed ? [] : ["DETERMINISTIC_CHECK_FAILED"],
    rubric_applied: passed,
    formula_valid: true,
    evidence_coverage: passed ? 1 : 0.5,
    supported_claims: passed ? 2 : 1,
    evaluated_claims: 2,
    accepted_latency_ms: 100,
    active_completion_latency_ms: latency_ms,
    cost_usd,
  };
}

describe("native executor evaluation adapters", () => {
  it("normalizes typed agentic events and output without preserving the historical OODA label", () => {
    const recording = {
      events: agentic_events(),
      audit: audit_facts(raw_material_case),
    };

    const run = adapt_agentic_run(recording);
    expect(run.executor).toBe("agentic");
    expect(run.terminal_status).toBe("completed");
    expect(run.tool_calls).toEqual([
      { name: "knowledge.search", sequence: 1, status: "ok" },
    ]);
    expect(run.usage.reported).toEqual(agentic_output().usage_summary);
    expect(adapt_ooda_run(recording)).toEqual(run);
  });

  it("derives a clarification interrupt and rejects duplicate native event sequences", () => {
    const events: AgentRunEventV1[] = [
      agentic_events()[0],
      {
        schema_version: "1",
        event_id: "clarify_1",
        run_id: "run_agentic_1",
        sequence: 1,
        occurred_at: "2026-07-16T00:00:00.100Z",
        type: "clarification.required",
        payload: { questions: ["Which target benefit?"] },
      },
    ];
    const audit = { ...audit_facts(raw_material_case), response_mode: "clarify" as const };
    const run = adapt_agentic_run({ events, audit, reported_usage: agentic_output().usage_summary });
    expect(run.terminal_status).toBe("waiting_clarification");
    expect(run.clarification_interrupts).toEqual([
      { questions: ["Which target benefit?"], tool_calls_before_interrupt: 0 },
    ]);

    expect(() => adapt_agentic_run({ events: [...events, events[1]], audit })).toThrow(
      "duplicate event sequence",
    );
  });

  it("rejects a terminal output pinned to a different run", () => {
    const events = agentic_events();
    const terminal = events[2];
    if (terminal.type !== "run.completed" || terminal.payload.output === undefined) {
      throw new Error("test fixture requires a completed output");
    }
    terminal.payload.output = { ...terminal.payload.output, run_id: "run_other" };
    expect(() =>
      adapt_agentic_run({ events, audit: audit_facts(raw_material_case) }),
    ).toThrow("terminal output run ID does not match events");
  });

  it("normalizes a strict native legacy recording without inferring behavior from prose", () => {
    const run = adapt_legacy_run({
      native: {
        schema_version: "legacy-1",
        terminal_status: "completed",
        response_mode: "answer",
        error_code: null,
        answer: "Legacy synthetic answer.",
        tool_calls: [{ tool_name: "knowledge.search", sequence: 1, status: "ok" }],
        clarification_interrupts: [],
        usage: agentic_output().usage_summary,
      },
      audit: audit_facts(raw_material_case),
    });

    expect(run.executor).toBe("legacy");
    expect(run.response_mode).toBe("answer");
    expect(run.tool_calls[0].name).toBe("knowledge.search");
    expect(run.usage.reported.total_tokens).toBe(30);
  });
});

describe("pinned model grader port", () => {
  it("computes the weighted rubric score from a deterministic fake and returns pinned metadata", async () => {
    let observed_request: ModelGraderRequest | null = null;
    const grader: ModelGraderPort = {
      async grade(request) {
        observed_request = request;
        return {
          criterion_scores: Object.fromEntries(
            request.criteria.map(({ criterion }, index) => [criterion, index === 0 ? 1 : 0.5]),
          ),
        };
      },
    };
    const config = {
      provider: "synthetic-provider",
      model: "grader-v1",
      prompt_version: "commercial-rubric-v1",
      prompt_hash: "b".repeat(64),
    };

    const result = await grade_case_with_model(
      raw_material_case,
      "Candidate answer with synthetic evidence.",
      config,
      grader,
    );

    const expected_score = raw_material_case.rubric.criteria.reduce(
      (total, criterion, index) => total + criterion.weight * (index === 0 ? 1 : 0.5),
      0,
    );
    expect(result.score).toBeCloseTo(expected_score, 10);
    expect(result).toMatchObject({
      blinded: true,
      provider: config.provider,
      model: config.model,
      prompt_version: config.prompt_version,
      prompt_hash: config.prompt_hash,
    });
    expect(observed_request).not.toHaveProperty("executor");
    expect(observed_request).not.toHaveProperty("expected_behavior");
  });

  it("fails closed when a grader omits a rubric criterion", async () => {
    const grader: ModelGraderPort = {
      async grade() {
        return { criterion_scores: {} };
      },
    };
    await expect(
      grade_case_with_model(
        raw_material_case,
        "Candidate answer.",
        {
          provider: "synthetic-provider",
          model: "grader-v1",
          prompt_version: "commercial-rubric-v1",
          prompt_hash: "c".repeat(64),
        },
        grader,
      ),
    ).rejects.toThrow("grader criterion set does not match rubric");
  });
});

describe("commercial evaluation report", () => {
  it("computes Wilson intervals, category rates, regressions, percentiles, usage, cost, and hashes", () => {
    const cases: ReportCaseInput[] = [
      {
        case_id: "case_raw_pass",
        category: "raw_materials",
        executor: "agentic",
        score: case_score(true, 100, "0.01"),
        provider: "gemini",
        model: "model-a",
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, cost_usd: "0.01" },
      },
      {
        case_id: "case_raw_regression",
        category: "raw_materials",
        executor: "agentic",
        score: case_score(false, 200, "0.02"),
        provider: "gemini",
        model: "model-a",
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30, cost_usd: "0.02" },
      },
      {
        case_id: "case_formula_pass",
        category: "formulation",
        executor: "agentic",
        score: case_score(true, 300, "0.03"),
        provider: "vertex",
        model: "model-b",
        usage: { input_tokens: 30, output_tokens: 15, total_tokens: 45, cost_usd: "0.03" },
      },
      {
        case_id: "case_security_fail",
        category: "security",
        executor: "agentic",
        score: case_score(false, 400, "0.04"),
        provider: "vertex",
        model: "model-b",
        usage: { input_tokens: 40, output_tokens: 20, total_tokens: 60, cost_usd: "0.04" },
      },
    ];
    const hashes = {
      corpus_hash: "1".repeat(64),
      executor_hash: "2".repeat(64),
      policy_hash: "3".repeat(64),
      prompt_hash: "4".repeat(64),
      deployment_hash: "5".repeat(64),
    };

    const report = build_evaluation_report({
      generated_at: "2026-07-16T00:00:00.000Z",
      corpus_version: "1",
      hashes,
      candidate_results: cases,
      baseline_results: [
        { case_id: "case_raw_pass", passed: true },
        { case_id: "case_raw_regression", passed: true },
        { case_id: "case_formula_pass", passed: false },
        { case_id: "case_security_fail", passed: false },
      ],
    });

    expect(report.summary).toMatchObject({ total_cases: 4, passed_cases: 2, pass_rate: 0.5 });
    expect(report.category_rates.raw_materials).toMatchObject({ total: 2, passed: 1, rate: 0.5 });
    expect(report.regressions).toEqual(["case_raw_regression"]);
    expect(report.improvements).toEqual(["case_formula_pass"]);
    expect(report.latency_ms).toEqual({
      accepted: { p50: 100, p95: 100, p99: 100 },
      active_completion: { p50: 200, p95: 400, p99: 400 },
    });
    expect(report.case_results[0]).toMatchObject({
      formula_valid: true,
      evidence_coverage: 1,
      accepted_latency_ms: 100,
      active_completion_latency_ms: 100,
      cost_usd: "0.01",
    });
    expect(report.usage).toMatchObject({
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      total_cost_usd: "0.1",
      cost_per_success_usd: "0.05",
    });
    expect(report.provider_usage).toHaveLength(2);
    expect(report.hashes).toEqual(hashes);
    expect(report.integrity_sha256).toMatch(/^[a-f0-9]{64}$/);

    const rendered = render_report(report);
    expect(JSON.parse(rendered.json)).toMatchObject({ integrity_sha256: report.integrity_sha256 });
    expect(rendered.markdown).toContain("case_raw_regression");
    expect(rendered.markdown).toContain("raw_materials");
    expect(rendered.markdown).toContain(hashes.policy_hash);
    expect(rendered.markdown).toContain(hashes.prompt_hash);
    expect(rendered.markdown).toContain(hashes.deployment_hash);
  });

  it("excludes missing latency measurements from percentiles", () => {
    const measured = case_score(true, 100, "0.01");
    const missing = { ...case_score(false, 0, "0.02"), active_completion_latency_ms: null };
    const report = build_evaluation_report({
      generated_at: "2026-07-16T00:00:00.000Z",
      corpus_version: "1",
      hashes: {
        corpus_hash: "1".repeat(64),
        executor_hash: "2".repeat(64),
        policy_hash: "3".repeat(64),
        prompt_hash: "4".repeat(64),
        deployment_hash: "5".repeat(64),
      },
      candidate_results: [measured, missing].map((score, index) => ({
        case_id: `latency_case_${index}`,
        category: "raw_materials" as const,
        executor: "agentic" as const,
        score,
        provider: "gemini",
        model: "model-a",
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, cost_usd: "0.01" },
      })),
    });
    expect(report.latency_ms).toEqual({
      accepted: { p50: 100, p95: 100, p99: 100 },
      active_completion: { p50: 100, p95: 100, p99: 100 },
    });
  });

  it("returns a bounded 95 percent Wilson interval", () => {
    const interval = wilson_interval(8, 10);
    expect(interval.lower).toBeCloseTo(0.4902, 3);
    expect(interval.upper).toBeCloseTo(0.9433, 3);
    expect(wilson_interval(0, 0)).toEqual({ lower: 0, upper: 0 });
  });
});
