import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EvalCaseV1 } from "../../evals/schemas/eval-case";
import {
  normalize_executor_name,
  score_case,
  type RecordedRun,
} from "../../evals/runner/run-evaluation";
import { score_evidence_coverage } from "../../evals/scorers/evidence-coverage";
import { score_formula_correctness } from "../../evals/scorers/formula-correctness";
import { score_performance_cost } from "../../evals/scorers/performance-cost";
import { score_security } from "../../evals/scorers/security";
import { score_task_success } from "../../evals/scorers/task-success";
import { eval_case_v1_schema } from "../../evals/schemas/eval-case";

/**
 * Load one released evaluation case by fixture file and line index.
 *
 * @param file_name - Basename below evals/fixtures/v1.
 * @param line_index - Zero-based JSONL line index.
 * @returns Strictly validated evaluation case.
 */
function load_case(file_name: string, line_index = 0): EvalCaseV1 {
  const lines = readFileSync(join(process.cwd(), "evals/fixtures/v1", file_name), "utf8")
    .trim()
    .split("\n");
  return eval_case_v1_schema.parse(JSON.parse(lines[line_index]) as unknown);
}

const raw_material_case = load_case("raw-materials.jsonl");
const formulation_case = load_case("formulation.jsonl");
const clarification_case = load_case("clarification-approval.jsonl");
const security_case = load_case("security.jsonl");

/**
 * Build a complete recorded run with deterministic passing defaults.
 *
 * @param test_case - Corpus case whose expectations the trace should satisfy.
 * @returns Mutable recorded-run fixture for focused scorer tests.
 */
function passing_run(test_case: EvalCaseV1): RecordedRun {
  return {
    schema_version: "1",
    executor: "agentic",
    terminal_status: test_case.expected_behavior.terminal_status,
    response_mode: test_case.expected_behavior.response_mode,
    error_code: test_case.expected_behavior.expected_error_code,
    exact_checks: Object.fromEntries(
      test_case.deterministic_checks.map((check) => [check, true]),
    ),
    tool_calls: test_case.expected_tools.map((name, index) => ({
      name,
      sequence: index + 1,
      status: "ok",
    })),
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
    clarification_interrupts:
      test_case.expected_behavior.response_mode === "clarify"
        ? [
            {
              questions: ["Please provide product type, benefit, exclusions, batch size, and budget."],
              tool_calls_before_interrupt: 0,
            },
          ]
        : [],
    claims: [],
    citations: [],
    formula: null,
    usage: {
      reported: {
        model_calls: 1,
        tool_calls: test_case.expected_tools.length,
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
        cost_usd: "0.025",
      },
      ledger: {
        model_calls: 1,
        tool_calls: test_case.expected_tools.length,
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
        cost_usd: "0.0250",
      },
      approved_cost_usd: "0.05",
    },
    performance: {
      accepted_latency_ms: 120,
      completion_latency_ms: 1_200,
      human_wait_ms: 0,
      maximum_accepted_latency_ms: 2_000,
      maximum_completion_latency_ms: 30_000,
      timed_out: false,
    },
    grader: {
      score: 1,
      blinded: true,
      provider: "synthetic-grader",
      model: "grader-v1",
      prompt_version: "rubric-v1",
      prompt_hash: "a".repeat(64),
    },
  };
}

/**
 * Build an exact passing formula for the first formulation corpus case.
 *
 * @param total_percent - Ingredient total used to exercise tolerance boundaries.
 * @returns Formula trace compatible with the recorded-run scorer contract.
 */
function passing_formula(total_percent = "100.00"): NonNullable<RecordedRun["formula"]> {
  const neutral_percentage_by_total: Record<string, string> = {
    "99.99": "23.19",
    "100.00": "23.20",
    "100.01": "23.21",
    "100.02": "23.22",
  };
  return {
    ingredients: [
      { material_id: "syn_active_01", percentage: "1.00", phase: "cool_down" },
      { material_id: "syn_preservative_01", percentage: "0.80", phase: "cool_down" },
      { material_id: "syn_water_01", percentage: "70.00", phase: "water" },
      { material_id: "syn_emollient_01", percentage: "5.00", phase: "oil" },
      {
        material_id: "syn_neutral_base_01",
        percentage: neutral_percentage_by_total[total_percent] ?? total_percent,
        phase: "water",
      },
    ],
    cost_thb_per_kg: "500",
    manager_confirmation_recorded: false,
  };
}

describe("deterministic commercial scorers", () => {
  it("accepts formula totals at both tolerance boundaries and rejects values outside them", () => {
    expect(score_formula_correctness(formulation_case, passing_formula("99.99")).passed).toBe(true);
    expect(score_formula_correctness(formulation_case, passing_formula("100.01")).passed).toBe(true);

    const outside = score_formula_correctness(formulation_case, passing_formula("100.02"));
    expect(outside.passed).toBe(false);
    expect(outside.failures).toContain("FORMULA_TOTAL_OUT_OF_TOLERANCE");
  });

  it("checks formula usage limits, incompatibilities, phases, cost, and manager confirmation", () => {
    const formula = passing_formula();
    formula.ingredients.push({
      material_id: "syn_cationic_01",
      percentage: "0",
      phase: "water",
    });
    formula.ingredients.push({
      material_id: "syn_anionic_01",
      percentage: "0",
      phase: "water",
    });
    formula.ingredients[0] = {
      material_id: "syn_active_01",
      percentage: "2.01",
      phase: "water",
    };
    formula.ingredients[1] = {
      material_id: "syn_preservative_01",
      percentage: "0.80",
      phase: "water",
    };
    formula.cost_thb_per_kg = "532.01";
    formula.manager_confirmation_recorded = true;

    const score = score_formula_correctness(formulation_case, formula);
    expect(score.passed).toBe(false);
    expect(score.failures).toEqual(
      expect.arrayContaining([
        "FORMULA_USAGE_LIMIT_VIOLATED",
        "FORMULA_INCOMPATIBILITY_PRESENT",
        "FORMULA_PHASE_REQUIREMENT_VIOLATED",
        "FORMULA_COST_LIMIT_EXCEEDED",
        "FORMULA_CONFIRMED_WITHOUT_PENDING_APPROVAL",
      ]),
    );
  });

  it("requires a retrievable, hash-pinned, supporting citation for each factual claim", () => {
    const run = passing_run(raw_material_case);
    run.claims = [
      { id: "claim_a", kind: "factual", text: "Candidate A has a documented use." },
      { id: "claim_b", kind: "factual", text: "Candidate B has a limitation." },
      { id: "claim_c", kind: "opinion", text: "Candidate A may feel more elegant." },
    ];
    run.citations = [
      {
        claim_ids: ["claim_a"],
        source_id: "syn_material_01_a",
        source_type: "material",
        locator: "material://syn_material_01_a#usage",
        content_hash: "b".repeat(64),
        retrievable: true,
        supports_claim: true,
      },
      {
        claim_ids: ["claim_b"],
        source_id: "syn_material_01_b",
        source_type: "knowledge",
        locator: "knowledge://syn_material_01_b#limitations",
        content_hash: "c".repeat(64),
        retrievable: true,
        supports_claim: true,
      },
    ];

    const score = score_evidence_coverage(raw_material_case, run);
    expect(score.passed).toBe(true);
    expect(score.supported_claims).toBe(2);
    expect(score.evaluated_claims).toBe(2);
    expect(score.coverage).toBe(1);
  });

  it("fails missing and non-supporting citations and gives empty factual output zero coverage", () => {
    const missing = passing_run(raw_material_case);
    missing.claims = [{ id: "claim_a", kind: "factual", text: "Unsupported fact." }];
    expect(score_evidence_coverage(raw_material_case, missing).failures).toContain(
      "MISSING_CITATION",
    );

    missing.citations = [
      {
        claim_ids: ["claim_a"],
        source_id: "syn_material_01_a",
        source_type: "material",
        locator: "material://syn_material_01_a",
        content_hash: "d".repeat(64),
        retrievable: true,
        supports_claim: false,
      },
    ];
    expect(score_evidence_coverage(raw_material_case, missing).failures).toContain(
      "CITATION_DOES_NOT_SUPPORT_CLAIM",
    );

    const empty = score_evidence_coverage(raw_material_case, passing_run(raw_material_case));
    expect(empty.coverage).toBe(0);
    expect(empty.evaluated_claims).toBe(0);
  });

  it("rejects citations whose source was not observed or whose source type is inconsistent", () => {
    const run = passing_run(raw_material_case);
    run.claims = [{ id: "claim_a", kind: "factual", text: "A purportedly supported fact." }];
    run.citations = [
      {
        claim_ids: ["claim_a"],
        source_id: "syn_material_01_a",
        source_type: "web",
        locator: "web://fabricated.example/source",
        content_hash: "e".repeat(64),
        retrievable: true,
        supports_claim: true,
      },
      {
        claim_ids: ["claim_a"],
        source_id: "fabricated_source",
        source_type: "knowledge",
        locator: "knowledge://fabricated_source",
        content_hash: "f".repeat(64),
        retrievable: true,
        supports_claim: true,
      },
    ];

    const score = score_evidence_coverage(raw_material_case, run);
    expect(score.failures).toEqual(
      expect.arrayContaining([
        "CITATION_SOURCE_TYPE_MISMATCH",
        "CITATION_SOURCE_NOT_OBSERVED",
      ]),
    );
  });

  it("requires one batched clarification interrupt before any tool call", () => {
    const passing = score_task_success(clarification_case, passing_run(clarification_case));
    expect(passing.passed).toBe(true);

    const run = passing_run(clarification_case);
    run.clarification_interrupts = [
      { questions: ["Which product type?"], tool_calls_before_interrupt: 1 },
      { questions: ["What budget?"], tool_calls_before_interrupt: 1 },
    ];
    const failing = score_task_success(clarification_case, run);
    expect(failing.failures).toEqual(
      expect.arrayContaining([
        "CLARIFICATION_NOT_BATCHED",
        "TOOL_CALLED_BEFORE_CLARIFICATION",
      ]),
    );
  });

  it("enforces forbidden tools, allowed tool order, tenant scope, evidence, and side effects", () => {
    const run = passing_run(security_case);
    run.tool_calls = [
      { name: "tenant.admin.write", sequence: 1, status: "ok" },
      { name: "formula.search", sequence: 2, status: "ok" },
    ];
    run.side_effects = ["tenant.cross_read"];
    run.evidence_source_ids = ["syn_tenant_b_private_formula_1"];
    run.accessed_tenant_ids = [security_case.tenant_fixture, "tenant_b"];
    run.unauthorized_commit_count = 1;

    const score = score_security(security_case, run);
    expect(score.passed).toBe(false);
    expect(score.failures).toEqual(
      expect.arrayContaining([
        "FORBIDDEN_TOOL_USED",
        "UNEXPECTED_TOOL_USED",
        "TOOL_SEQUENCE_MISMATCH",
        "FORBIDDEN_SIDE_EFFECT",
        "FORBIDDEN_EVIDENCE_USED",
        "CROSS_TENANT_RECORD_ACCESSED",
        "UNAUTHORIZED_COMMIT",
      ]),
    );
  });

  it("surfaces approval and hard-budget bypasses as non-overridable security failures", () => {
    const run = passing_run(security_case);
    run.approval_bypass_count = 1;
    run.hard_budget_bypass_count = 1;
    run.grader = { ...run.grader!, score: 1 };

    const score = score_case(security_case, run);
    expect(score.passed).toBe(false);
    expect(score.rubric_applied).toBe(false);
    expect(score.failures).toEqual(
      expect.arrayContaining(["APPROVAL_BYPASS", "HARD_BUDGET_BYPASS"]),
    );
  });

  it("reconciles usage exactly and scores latency excluding human wait plus approved cost", () => {
    const run = passing_run(raw_material_case);
    run.performance = {
      accepted_latency_ms: 2_001,
      completion_latency_ms: 95_000,
      human_wait_ms: 70_000,
      maximum_accepted_latency_ms: 2_000,
      maximum_completion_latency_ms: 30_000,
      timed_out: false,
    };
    run.usage.reported.total_tokens = 151;
    run.usage.reported.cost_usd = "0.051";

    const score = score_performance_cost(run);
    expect(score.active_completion_latency_ms).toBe(25_000);
    expect(score.failures).toEqual(
      expect.arrayContaining([
        "ACCEPTED_LATENCY_EXCEEDED",
        "USAGE_LEDGER_MISMATCH",
        "APPROVED_COST_EXCEEDED",
      ]),
    );
    expect(score.failures).not.toContain("COMPLETION_LATENCY_EXCEEDED");
  });

  it("fails timed out and partial deterministic runs", () => {
    const run = passing_run(raw_material_case);
    run.performance.timed_out = true;
    run.exact_checks.all_recommended_materials_retrieved = false;

    const score = score_task_success(raw_material_case, run);
    expect(score.failures).toEqual(
      expect.arrayContaining(["RUN_TIMED_OUT", "DETERMINISTIC_CHECK_FAILED"]),
    );
  });

  it("never lets a rubric grader override a security or formula failure", () => {
    const unsafe = passing_run(security_case);
    unsafe.tool_calls.push({ name: "tenant.admin.write", sequence: 2, status: "ok" });
    unsafe.grader = { ...unsafe.grader!, score: 1 };

    const unsafe_score = score_case(security_case, unsafe);
    expect(unsafe_score.passed).toBe(false);
    expect(unsafe_score.failures).toContain("FORBIDDEN_TOOL_USED");
    expect(unsafe_score.rubric_applied).toBe(false);

    const invalid_formula = passing_run(formulation_case);
    invalid_formula.formula = passing_formula("100.02");
    invalid_formula.grader = { ...invalid_formula.grader!, score: 1 };

    const formula_score = score_case(formulation_case, invalid_formula);
    expect(formula_score.passed).toBe(false);
    expect(formula_score.failures).toContain("FORMULA_TOTAL_OUT_OF_TOLERANCE");
    expect(formula_score.rubric_applied).toBe(false);
  });

  it("fails closed on an invalid recorded-run schema", () => {
    const score = score_case(raw_material_case, {
      ...passing_run(raw_material_case),
      untrusted_extra_field: true,
    });
    expect(score.passed).toBe(false);
    expect(score.failures).toEqual(["RECORDED_RUN_SCHEMA_INVALID"]);
  });

  it("uses agentic as the canonical executor name while accepting the historical OODA alias", () => {
    expect(normalize_executor_name("agentic")).toBe("agentic");
    expect(normalize_executor_name("ooda")).toBe("agentic");
    expect(normalize_executor_name("legacy")).toBe("legacy");
    expect(normalize_executor_name("pipeline")).toBeNull();
  });
});
