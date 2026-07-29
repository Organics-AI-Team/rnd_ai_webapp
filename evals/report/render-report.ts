/** Deterministic JSON/Markdown report builder for commercial evaluation results. */
import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import type { EvalCaseV1 } from "../schemas/eval-case";
import type { CaseScore } from "../runner/run-evaluation";

const WILSON_Z_95 = 1.959963984540054;
const hash_pattern = /^[a-f0-9]{64}$/;

export interface ReportCaseInput {
  readonly case_id: string;
  readonly category: EvalCaseV1["category"];
  readonly executor: "legacy" | "agentic";
  readonly score: CaseScore;
  readonly provider: string;
  readonly model: string;
  readonly usage: {
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly total_tokens: number;
    readonly cost_usd: string;
  };
}

export interface ReportHashes {
  readonly corpus_hash: string;
  readonly executor_hash: string;
  readonly policy_hash: string;
  readonly prompt_hash: string;
  readonly deployment_hash: string;
}

export interface RateSummary {
  readonly total: number;
  readonly passed: number;
  readonly rate: number;
  readonly confidence_95: { readonly lower: number; readonly upper: number };
}

export interface EvaluationReport {
  readonly schema_version: "1";
  readonly generated_at: string;
  readonly corpus_version: string;
  readonly hashes: ReportHashes;
  readonly case_results: ReadonlyArray<{
    readonly case_id: string;
    readonly category: EvalCaseV1["category"];
    readonly executor: "legacy" | "agentic";
    readonly passed: boolean;
    readonly failures: readonly string[];
    readonly formula_valid: boolean;
    readonly evidence_coverage: number;
    readonly supported_claims: number;
    readonly evaluated_claims: number;
    readonly accepted_latency_ms: number | null;
    readonly active_completion_latency_ms: number | null;
    readonly cost_usd: string | null;
  }>;
  readonly summary: RateSummary & { readonly total_cases: number; readonly passed_cases: number; readonly pass_rate: number };
  readonly category_rates: Partial<Record<EvalCaseV1["category"], RateSummary>>;
  readonly regressions: readonly string[];
  readonly improvements: readonly string[];
  readonly latency_ms: {
    readonly accepted: { readonly p50: number; readonly p95: number; readonly p99: number };
    readonly active_completion: {
      readonly p50: number;
      readonly p95: number;
      readonly p99: number;
    };
  };
  readonly usage: {
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly total_tokens: number;
    readonly total_cost_usd: string;
    readonly cost_per_success_usd: string | null;
  };
  readonly provider_usage: ReadonlyArray<{
    readonly provider: string;
    readonly model: string;
    readonly runs: number;
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly total_tokens: number;
    readonly cost_usd: string;
  }>;
  readonly integrity_sha256: string;
}

export interface EvaluationReportInput {
  readonly generated_at: string;
  readonly corpus_version: string;
  readonly hashes: ReportHashes;
  readonly candidate_results: readonly ReportCaseInput[];
  readonly baseline_results?: ReadonlyArray<{ readonly case_id: string; readonly passed: boolean }>;
}

/**
 * Compute a bounded two-sided 95 percent Wilson score interval.
 *
 * @param passed - Successful observations.
 * @param total - Total observations.
 * @returns Lower and upper probability bounds; empty sets map to zero bounds.
 */
export function wilson_interval(passed: number, total: number): { lower: number; upper: number } {
  if (total === 0) return { lower: 0, upper: 0 };
  const probability = passed / total;
  const squared = WILSON_Z_95 * WILSON_Z_95;
  const denominator = 1 + squared / total;
  const centre = probability + squared / (2 * total);
  const margin =
    WILSON_Z_95 *
    Math.sqrt((probability * (1 - probability) + squared / (4 * total)) / total);
  return {
    lower: Math.max(0, (centre - margin) / denominator),
    upper: Math.min(1, (centre + margin) / denominator),
  };
}

/** Build one pass-rate summary from boolean outcomes. */
function rate_summary(outcomes: readonly boolean[]): RateSummary {
  const passed = outcomes.filter(Boolean).length;
  return {
    total: outcomes.length,
    passed,
    rate: outcomes.length === 0 ? 0 : passed / outcomes.length,
    confidence_95: wilson_interval(passed, outcomes.length),
  };
}

/** Compute the nearest-rank percentile for a non-empty metric list. */
function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)];
}

/** Canonically stringify JSON-like data with recursively sorted object keys. */
function stable_json(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable_json).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stable_json(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Validate that all release identity values are SHA-256 hex digests. */
function assert_hashes(hashes: ReportHashes): void {
  for (const [name, value] of Object.entries(hashes)) {
    if (!hash_pattern.test(value)) throw new Error(`${name} must be a SHA-256 digest`);
  }
}

/** Aggregate provider/model usage in stable lexical order. */
function aggregate_provider_usage(cases: readonly ReportCaseInput[]): EvaluationReport["provider_usage"] {
  const entries = new Map<
    string,
    {
      provider: string;
      model: string;
      runs: number;
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      cost: Decimal;
    }
  >();
  for (const result of cases) {
    const key = `${result.provider}\u0000${result.model}`;
    const current = entries.get(key) ?? {
      provider: result.provider,
      model: result.model,
      runs: 0,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cost: new Decimal(0),
    };
    current.runs += 1;
    current.input_tokens += result.usage.input_tokens;
    current.output_tokens += result.usage.output_tokens;
    current.total_tokens += result.usage.total_tokens;
    current.cost = current.cost.plus(result.usage.cost_usd);
    entries.set(key, current);
  }
  return [...entries.values()]
    .sort((left, right) =>
      `${left.provider}\u0000${left.model}`.localeCompare(`${right.provider}\u0000${right.model}`),
    )
    .map(({ cost, ...entry }) => ({ ...entry, cost_usd: cost.toString() }));
}

/**
 * Build a deterministic report from candidate results and an optional baseline.
 *
 * @param input - Pinned metadata, case scores, usage, and baseline outcomes.
 * @returns Report with case/category rates, intervals, deltas, metrics, and digest.
 */
export function build_evaluation_report(input: EvaluationReportInput): EvaluationReport {
  if (Number.isNaN(Date.parse(input.generated_at))) throw new Error("generated_at must be ISO-8601");
  if (input.candidate_results.length === 0) throw new Error("report requires candidate results");
  assert_hashes(input.hashes);
  const baseline = new Map((input.baseline_results ?? []).map((result) => [result.case_id, result.passed]));
  const categories = [...new Set(input.candidate_results.map(({ category }) => category))].sort();
  const category_rates = Object.fromEntries(
    categories.map((category) => [
      category,
      rate_summary(
        input.candidate_results
          .filter((result) => result.category === category)
          .map(({ score }) => score.passed),
      ),
    ]),
  ) as EvaluationReport["category_rates"];
  const outcomes = input.candidate_results.map(({ score }) => score.passed);
  const rate = rate_summary(outcomes);
  const total_cost = input.candidate_results.reduce(
    (total, result) => total.plus(result.usage.cost_usd),
    new Decimal(0),
  );
  const passed_cases = outcomes.filter(Boolean).length;
  const measured_latencies = input.candidate_results.flatMap(({ score }) =>
    score.active_completion_latency_ms === null ? [] : [score.active_completion_latency_ms],
  );
  const accepted_latencies = input.candidate_results.flatMap(({ score }) =>
    score.accepted_latency_ms === null ? [] : [score.accepted_latency_ms],
  );
  const draft = {
    schema_version: "1" as const,
    generated_at: input.generated_at,
    corpus_version: input.corpus_version,
    hashes: input.hashes,
    case_results: input.candidate_results.map(({ case_id, category, executor, score }) => ({
      case_id,
      category,
      executor,
      passed: score.passed,
      failures: [...score.failures],
      formula_valid: score.formula_valid,
      evidence_coverage: score.evidence_coverage,
      supported_claims: score.supported_claims,
      evaluated_claims: score.evaluated_claims,
      accepted_latency_ms: score.accepted_latency_ms,
      active_completion_latency_ms: score.active_completion_latency_ms,
      cost_usd: score.cost_usd,
    })),
    summary: {
      ...rate,
      total_cases: rate.total,
      passed_cases: rate.passed,
      pass_rate: rate.rate,
    },
    category_rates,
    regressions: input.candidate_results
      .filter((result) => baseline.get(result.case_id) === true && !result.score.passed)
      .map(({ case_id }) => case_id),
    improvements: input.candidate_results
      .filter((result) => baseline.get(result.case_id) === false && result.score.passed)
      .map(({ case_id }) => case_id),
    latency_ms: {
      accepted: {
        p50: percentile(accepted_latencies, 0.5),
        p95: percentile(accepted_latencies, 0.95),
        p99: percentile(accepted_latencies, 0.99),
      },
      active_completion: {
        p50: percentile(measured_latencies, 0.5),
        p95: percentile(measured_latencies, 0.95),
        p99: percentile(measured_latencies, 0.99),
      },
    },
    usage: {
      input_tokens: input.candidate_results.reduce(
        (total, result) => total + result.usage.input_tokens,
        0,
      ),
      output_tokens: input.candidate_results.reduce(
        (total, result) => total + result.usage.output_tokens,
        0,
      ),
      total_tokens: input.candidate_results.reduce(
        (total, result) => total + result.usage.total_tokens,
        0,
      ),
      total_cost_usd: total_cost.toString(),
      cost_per_success_usd:
        passed_cases === 0 ? null : total_cost.dividedBy(passed_cases).toString(),
    },
    provider_usage: aggregate_provider_usage(input.candidate_results),
  };
  const integrity_sha256 = createHash("sha256").update(stable_json(draft)).digest("hex");
  return { ...draft, integrity_sha256 };
}

/**
 * Render one report as stable JSON and human-readable Markdown.
 *
 * @param report - Previously built deterministic evaluation report.
 * @returns JSON and Markdown representations carrying the same digest.
 */
export function render_report(report: EvaluationReport): { json: string; markdown: string } {
  const category_rows = Object.entries(report.category_rates)
    .map(
      ([category, rate]) =>
        `| ${category} | ${rate?.passed ?? 0}/${rate?.total ?? 0} | ${((rate?.rate ?? 0) * 100).toFixed(2)}% |`,
    )
    .join("\n");
  const regressions = report.regressions.length === 0
    ? "None"
    : report.regressions.map((case_id) => `- ${case_id}`).join("\n");
  const markdown = [
    "# Commercial evaluation report",
    "",
    `Generated: ${report.generated_at}`,
    `Corpus: v${report.corpus_version} (${report.hashes.corpus_hash})`,
    `Integrity SHA-256: ${report.integrity_sha256}`,
    "",
    "## Release hashes",
    "",
    `- Corpus: ${report.hashes.corpus_hash}`,
    `- Executor: ${report.hashes.executor_hash}`,
    `- Policy: ${report.hashes.policy_hash}`,
    `- Prompt: ${report.hashes.prompt_hash}`,
    `- Deployment: ${report.hashes.deployment_hash}`,
    "",
    "## Summary",
    "",
    `Pass rate: ${report.summary.passed_cases}/${report.summary.total_cases} (${(report.summary.pass_rate * 100).toFixed(2)}%)`,
    `Accepted latency p50/p95/p99: ${report.latency_ms.accepted.p50}/${report.latency_ms.accepted.p95}/${report.latency_ms.accepted.p99} ms`,
    `Active completion latency p50/p95/p99: ${report.latency_ms.active_completion.p50}/${report.latency_ms.active_completion.p95}/${report.latency_ms.active_completion.p99} ms`,
    `Total cost: USD ${report.usage.total_cost_usd}`,
    "",
    "## Category rates",
    "",
    "| Category | Passed | Rate |",
    "| --- | ---: | ---: |",
    category_rows,
    "",
    "## Regressions",
    "",
    regressions,
    "",
  ].join("\n");
  return { json: `${JSON.stringify(report, null, 2)}\n`, markdown };
}
