/** Execute and persist the full credential-free commercial evaluation corpus. */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import Decimal from "decimal.js";

import {
  build_evaluation_report,
  render_report,
  type EvaluationReport,
  type ReportCaseInput,
} from "../report/render-report";
import { eval_case_v1_schema, type EvalCaseV1 } from "../schemas/eval-case";
import { score_case } from "./run-evaluation";
import { adapt_legacy_run } from "./legacy-adapter";
import { adapt_agentic_run } from "./ooda-adapter";
import type { RecordedRun } from "./recorded-run";
import {
  credential_free_agentic_input,
  credential_free_legacy_input,
} from "./credential-free-adapter";

const artifact_name_pattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const corpus_directory = path.resolve("evals/fixtures/v1");
const default_reports_directory = path.resolve("evals/reports");

/** Shared metadata proving an artifact came from a local test adapter. */
interface CredentialFreeArtifactMetadata {
  readonly schema_version: "1";
  readonly evidence_class: "credential_free_test";
  readonly artifact_name: string;
  readonly corpus_hash: string;
  readonly case_count: number;
  readonly generated_at: string;
  readonly report_integrity_sha256: string;
}

/** Gate input generated for the deterministic legacy campaign. */
export interface CredentialFreeLegacyArtifact extends CredentialFreeArtifactMetadata {
  readonly executor: "legacy";
  readonly task_success_rate: number;
}

/** Gate input generated for the deterministic agentic campaign. */
export interface CredentialFreeAgenticArtifact extends CredentialFreeArtifactMetadata {
  readonly executor: "agentic";
  readonly metrics: {
    readonly cross_tenant_disclosures: number;
    readonly unauthorized_side_effects: number;
    readonly approval_bypasses: number;
    readonly hard_budget_bypasses: number;
    readonly formula_validity_rate: number;
    readonly evidence_coverage_rate: number;
    readonly task_success_rate: number;
    readonly schema_valid_terminal_rate: number;
    readonly event_sequence_integrity_rate: number;
    readonly usage_reconciliation_rate: number;
    readonly accepted_event_p95_ms: number;
    readonly simple_answer_completion_p95_ms: number;
    readonly formula_workflow_p95_ms: number;
    readonly cost_per_success_microusd: number;
    readonly approved_cost_per_success_microusd: number;
    readonly signed_cost_exception: false;
  };
}

/** Typed result of one complete legacy campaign. */
export interface LegacyCampaignResult {
  readonly artifact: CredentialFreeLegacyArtifact;
  readonly report: EvaluationReport;
}

/** Typed result of one complete agentic campaign. */
export interface AgenticCampaignResult {
  readonly artifact: CredentialFreeAgenticArtifact;
  readonly report: EvaluationReport;
}

/** Options accepted by the exported campaign functions and CLI. */
export interface CampaignOptions {
  readonly artifact_name: string;
  readonly generated_at?: string;
  readonly reports_directory?: string;
}

/** Canonically hash the immutable corpus using its documented byte algorithm. */
async function load_corpus(): Promise<{
  readonly cases: readonly EvalCaseV1[];
  readonly corpus_hash: string;
}> {
  const file_names = (await readdir(corpus_directory))
    .filter((file_name) => file_name.endsWith(".jsonl"))
    .sort();
  const hash = createHash("sha256");
  const cases: EvalCaseV1[] = [];
  for (const file_name of file_names) {
    const bytes = await readFile(path.join(corpus_directory, file_name));
    hash.update(`${file_name}\n`, "utf8");
    hash.update(bytes);
    for (const line of bytes.toString("utf8").split("\n")) {
      if (line.length > 0) cases.push(eval_case_v1_schema.parse(JSON.parse(line)));
    }
  }
  if (cases.length !== 150) throw new Error("commercial corpus case count is invalid");
  return { cases, corpus_hash: hash.digest("hex") };
}

/** Stable SHA-256 identity for deterministic campaign components. */
function component_hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Nearest-rank percentile with an empty-set zero fallback. */
function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

/** Test whether reported usage exactly matches the evaluator ledger. */
function usage_reconciles(run: RecordedRun): boolean {
  return (
    run.usage.reported.model_calls === run.usage.ledger.model_calls &&
    run.usage.reported.tool_calls === run.usage.ledger.tool_calls &&
    run.usage.reported.input_tokens === run.usage.ledger.input_tokens &&
    run.usage.reported.output_tokens === run.usage.ledger.output_tokens &&
    run.usage.reported.total_tokens === run.usage.ledger.total_tokens &&
    new Decimal(run.usage.reported.cost_usd).equals(run.usage.ledger.cost_usd)
  );
}

/** Convert one normalized run and score into the detailed report input. */
function report_case(
  test_case: EvalCaseV1,
  run: RecordedRun,
): ReportCaseInput {
  return {
    case_id: test_case.id,
    category: test_case.category,
    executor: run.executor,
    score: score_case(test_case, run),
    provider: "credential-free",
    model: `${run.executor}-test-adapter-v1`,
    usage: {
      input_tokens: run.usage.reported.input_tokens,
      output_tokens: run.usage.reported.output_tokens,
      total_tokens: run.usage.reported.total_tokens,
      cost_usd: run.usage.reported.cost_usd,
    },
  };
}

/** Build the common integrity-linked metadata stored beside each report. */
function artifact_metadata(
  artifact_name: string,
  corpus_hash: string,
  generated_at: string,
  report: EvaluationReport,
): CredentialFreeArtifactMetadata {
  return {
    schema_version: "1",
    evidence_class: "credential_free_test",
    artifact_name,
    corpus_hash,
    case_count: report.summary.total_cases,
    generated_at,
    report_integrity_sha256: report.integrity_sha256,
  };
}

/** Aggregate candidate measurements from normalized case recordings. */
function agentic_metrics(
  cases: readonly EvalCaseV1[],
  runs: readonly RecordedRun[],
  report: EvaluationReport,
): CredentialFreeAgenticArtifact["metrics"] {
  const formula_results = report.case_results.filter(
    ({ category }) => category === "formulation",
  );
  const supported_claims = report.case_results.reduce(
    (total, result) => total + result.supported_claims,
    0,
  );
  const evaluated_claims = report.case_results.reduce(
    (total, result) => total + result.evaluated_claims,
    0,
  );
  const simple_latencies = report.case_results
    .filter(({ category }) => category !== "formulation")
    .flatMap(({ active_completion_latency_ms }) =>
      active_completion_latency_ms === null ? [] : [active_completion_latency_ms],
    );
  const formula_latencies = formula_results.flatMap(({ active_completion_latency_ms }) =>
    active_completion_latency_ms === null ? [] : [active_completion_latency_ms],
  );
  const total_cost_microusd = runs.reduce(
    (total, run) => total.plus(new Decimal(run.usage.reported.cost_usd).times(1_000_000)),
    new Decimal(0),
  );
  const passed_cases = report.summary.passed_cases;
  return {
    cross_tenant_disclosures: runs.reduce(
      (total, run, index) =>
        total + run.accessed_tenant_ids.filter((tenant) => tenant !== cases[index].tenant_fixture).length,
      0,
    ),
    unauthorized_side_effects: runs.reduce(
      (total, run, index) =>
        total + run.side_effects.filter(
          (effect) => !cases[index].expected_behavior.allowed_side_effects.includes(effect),
        ).length + run.unauthorized_commit_count,
      0,
    ),
    approval_bypasses: runs.reduce((total, run) => total + run.approval_bypass_count, 0),
    hard_budget_bypasses: runs.reduce((total, run) => total + run.hard_budget_bypass_count, 0),
    formula_validity_rate:
      formula_results.length === 0
        ? 0
        : formula_results.filter(({ formula_valid }) => formula_valid).length /
          formula_results.length,
    evidence_coverage_rate:
      evaluated_claims === 0 ? 0 : supported_claims / evaluated_claims,
    task_success_rate: report.summary.pass_rate,
    schema_valid_terminal_rate: runs.length / cases.length,
    event_sequence_integrity_rate: runs.length / cases.length,
    usage_reconciliation_rate:
      runs.filter(usage_reconciles).length / runs.length,
    accepted_event_p95_ms: report.latency_ms.accepted.p95,
    simple_answer_completion_p95_ms: percentile(simple_latencies, 0.95),
    formula_workflow_p95_ms: percentile(formula_latencies, 0.95),
    cost_per_success_microusd:
      passed_cases === 0
        ? Number.MAX_SAFE_INTEGER
        : total_cost_microusd.dividedBy(passed_cases).toNumber(),
    approved_cost_per_success_microusd: 25_000,
    signed_cost_exception: false,
  };
}

export function run_credential_free_campaign(
  executor: "legacy",
  options: CampaignOptions,
): Promise<LegacyCampaignResult>;
export function run_credential_free_campaign(
  executor: "agentic",
  options: CampaignOptions,
): Promise<AgenticCampaignResult>;
/** Execute all 150 immutable cases through one native adapter and scorer path. */
export async function run_credential_free_campaign(
  executor: "legacy" | "agentic",
  options: CampaignOptions,
): Promise<LegacyCampaignResult | AgenticCampaignResult> {
  if (!artifact_name_pattern.test(options.artifact_name)) {
    throw new Error("commercial campaign artifact name is invalid");
  }
  const generated_at = options.generated_at ?? new Date().toISOString();
  const { cases, corpus_hash } = await load_corpus();
  const runs = cases.map((test_case) =>
    executor === "legacy"
      ? adapt_legacy_run(credential_free_legacy_input(test_case))
      : adapt_agentic_run(credential_free_agentic_input(test_case)),
  );
  const candidate_results = cases.map((test_case, index) =>
    report_case(test_case, runs[index]),
  );
  const report = build_evaluation_report({
    generated_at,
    corpus_version: "1",
    hashes: {
      corpus_hash,
      executor_hash: component_hash(`${executor}-credential-free-adapter-v1`),
      policy_hash: component_hash("commercial-credential-free-policy-v1"),
      prompt_hash: component_hash("commercial-credential-free-prompt-v1"),
      deployment_hash: component_hash("commercial-credential-free-deployment-v1"),
    },
    candidate_results,
  });
  const metadata = artifact_metadata(
    options.artifact_name,
    corpus_hash,
    generated_at,
    report,
  );
  if (executor === "legacy") {
    return {
      artifact: {
        ...metadata,
        executor: "legacy",
        task_success_rate: report.summary.pass_rate,
      },
      report,
    };
  }
  return {
    artifact: {
      ...metadata,
      executor: "agentic",
      metrics: agentic_metrics(cases, runs, report),
    },
    report,
  };
}

export function write_credential_free_campaign(
  executor: "legacy",
  options: CampaignOptions,
): Promise<LegacyCampaignResult>;
export function write_credential_free_campaign(
  executor: "agentic",
  options: CampaignOptions,
): Promise<AgenticCampaignResult>;
/** Execute a campaign and atomically materialize its gate/report representations. */
export async function write_credential_free_campaign(
  executor: "legacy" | "agentic",
  options: CampaignOptions,
): Promise<LegacyCampaignResult | AgenticCampaignResult> {
  const result = executor === "legacy"
    ? await run_credential_free_campaign("legacy", options)
    : await run_credential_free_campaign("agentic", options);
  const directory = options.reports_directory ?? default_reports_directory;
  const rendered = render_report(result.report);
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(directory, `${options.artifact_name}.json`),
      `${JSON.stringify(result.artifact, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(directory, `${options.artifact_name}-report.json`),
      rendered.json,
      "utf8",
    ),
    writeFile(
      path.join(directory, `${options.artifact_name}-report.md`),
      rendered.markdown,
      "utf8",
    ),
  ]);
  return result;
}

/** Parse the executor pin and artifact name accepted by the campaign CLI. */
function parse_args(args: readonly string[]): {
  readonly executor: "legacy" | "agentic";
  readonly artifact_name: string;
} {
  if (args.length !== 2) throw new Error("commercial campaign arguments are invalid");
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--(executor|artifact)=(.+)$/.exec(argument);
    if (!match || values.has(match[1])) {
      throw new Error("commercial campaign arguments are invalid");
    }
    values.set(match[1], match[2]);
  }
  const executor = values.get("executor");
  const artifact_name = values.get("artifact");
  if (
    (executor !== "legacy" && executor !== "agentic") ||
    !artifact_name ||
    !artifact_name_pattern.test(artifact_name)
  ) {
    throw new Error("commercial campaign arguments are invalid");
  }
  return { executor, artifact_name };
}

/** Run the credential-free-only CLI and print a content-free artifact summary. */
export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  if (process.env.COMMERCIAL_TEST_ADAPTER_MODE !== "credential_free") {
    throw new Error("commercial campaign requires credential_free adapter mode");
  }
  const { executor, artifact_name } = parse_args(args);
  const result = executor === "legacy"
    ? await write_credential_free_campaign("legacy", { artifact_name })
    : await write_credential_free_campaign("agentic", { artifact_name });
  process.stdout.write(`${JSON.stringify({
    schema_version: "1",
    artifact_name,
    executor,
    evidence_class: result.artifact.evidence_class,
    case_count: result.report.summary.total_cases,
    pass_rate: result.report.summary.pass_rate,
    report_integrity_sha256: result.report.integrity_sha256,
  })}\n`);
}

if (process.argv[1]?.endsWith("run-campaign.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "commercial campaign failed");
    process.exitCode = 1;
  });
}
