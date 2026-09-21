/** Fail-closed comparison CLI for named, credential-free release metric artifacts. */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  evaluate_release,
  type ReleaseMetrics,
} from "../config/release-thresholds";

const artifact_name_pattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const rate = z.number().finite().min(0).max(1);
const nonnegative = z.number().finite().nonnegative();

const baseline_artifact_schema = z.object({
  schema_version: z.literal("1"),
  artifact_name: z.string().regex(artifact_name_pattern),
  executor: z.literal("legacy"),
  evidence_class: z.enum(["reviewed_release", "credential_free_test"]),
  task_success_rate: rate,
  corpus_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  case_count: z.number().int().positive().optional(),
  generated_at: z.string().datetime({ offset: true }).optional(),
  report_integrity_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

const candidate_artifact_schema = z.object({
  schema_version: z.literal("1"),
  artifact_name: z.string().regex(artifact_name_pattern),
  executor: z.literal("agentic"),
  evidence_class: z.enum(["reviewed_release", "credential_free_test"]),
  corpus_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  case_count: z.number().int().positive().optional(),
  generated_at: z.string().datetime({ offset: true }).optional(),
  report_integrity_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  metrics: z.object({
    cross_tenant_disclosures: nonnegative,
    unauthorized_side_effects: nonnegative,
    approval_bypasses: nonnegative,
    hard_budget_bypasses: nonnegative,
    formula_validity_rate: rate,
    evidence_coverage_rate: rate,
    task_success_rate: rate,
    schema_valid_terminal_rate: rate,
    event_sequence_integrity_rate: rate,
    usage_reconciliation_rate: rate,
    accepted_event_p95_ms: nonnegative,
    simple_answer_completion_p95_ms: nonnegative,
    formula_workflow_p95_ms: nonnegative,
    cost_per_success_microusd: nonnegative,
    approved_cost_per_success_microusd: nonnegative,
    signed_cost_exception: z.boolean(),
  }).strict(),
}).strict();

/** Validated names accepted by the comparison CLI. */
export interface CompareEvaluationArgs {
  readonly baseline: string;
  readonly candidate: string;
}

/** Content-free summary printed by the comparison CLI. */
export interface CompareEvaluationSummary {
  readonly schema_version: "1";
  readonly baseline: string;
  readonly candidate: string;
  readonly passed: boolean;
  readonly check_count: number;
  readonly failed_checks: readonly string[];
}

/** Result returned to tests and the CLI process boundary. */
export interface CompareEvaluationResult {
  readonly passed: boolean;
  readonly summary: CompareEvaluationSummary;
}

/**
 * Parse the exact two named-artifact CLI options.
 *
 * @param args - Arguments after the script path.
 * @returns Validated baseline and candidate artifact names.
 * @throws Error when options are missing, duplicated, unknown, or unsafe.
 */
export function parse_compare_args(args: readonly string[]): CompareEvaluationArgs {
  if (args.length !== 2) {
    throw new Error("commercial evaluation arguments are invalid");
  }
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--(baseline|candidate)=(.+)$/.exec(argument);
    if (!match || values.has(match[1])) {
      throw new Error("commercial evaluation arguments are invalid");
    }
    values.set(match[1], match[2]);
  }
  const baseline = values.get("baseline");
  const candidate = values.get("candidate");
  if (
    !baseline ||
    !candidate ||
    !artifact_name_pattern.test(baseline) ||
    !artifact_name_pattern.test(candidate)
  ) {
    throw new Error("commercial evaluation arguments are invalid");
  }
  return { baseline, candidate };
}

/**
 * Read and decode one JSON artifact without leaking its content in errors.
 *
 * @param reports_directory - Trusted directory containing commercial artifacts.
 * @param artifact_name - Validated filename stem.
 * @returns Parsed JSON value.
 * @throws Error when the named file is missing, unreadable, or malformed.
 */
async function read_artifact(
  reports_directory: string,
  artifact_name: string,
): Promise<unknown> {
  try {
    const content = await readFile(
      path.join(reports_directory, `${artifact_name}.json`),
      "utf8",
    );
    return JSON.parse(content) as unknown;
  } catch {
    throw new Error(
      `commercial evaluation artifact is unavailable: ${artifact_name}`,
    );
  }
}

/**
 * Compare named baseline/candidate metric artifacts through the canonical gates.
 *
 * @param args - Validated named artifact selection.
 * @param reports_directory - Directory containing JSON artifacts.
 * @returns Safe aggregate summary and overall release decision.
 * @throws Error when either artifact is absent, invalid, or misnamed.
 */
export async function compare_evaluation_artifacts(
  args: CompareEvaluationArgs,
  reports_directory = path.resolve("evals/reports"),
  evidence_class: "reviewed_release" | "credential_free_test" = "reviewed_release",
): Promise<CompareEvaluationResult> {
  const [baseline_input, candidate_input] = await Promise.all([
    read_artifact(reports_directory, args.baseline),
    read_artifact(reports_directory, args.candidate),
  ]);
  const baseline = baseline_artifact_schema.safeParse(baseline_input);
  const candidate = candidate_artifact_schema.safeParse(candidate_input);
  if (!baseline.success || !candidate.success) {
    throw new Error("commercial evaluation artifact is invalid");
  }
  if (
    baseline.data.evidence_class !== evidence_class ||
    candidate.data.evidence_class !== evidence_class
  ) {
    throw new Error("commercial evaluation evidence class is invalid");
  }
  if (
    baseline.data.artifact_name !== args.baseline ||
    candidate.data.artifact_name !== args.candidate
  ) {
    throw new Error("commercial evaluation artifact name does not match selection");
  }

  const candidate_metrics = candidate.data.metrics;
  const metrics: ReleaseMetrics = {
    cross_tenant_disclosures: candidate_metrics.cross_tenant_disclosures,
    unauthorized_side_effects: candidate_metrics.unauthorized_side_effects,
    approval_bypasses: candidate_metrics.approval_bypasses,
    hard_budget_bypasses: candidate_metrics.hard_budget_bypasses,
    formula_validity_rate: candidate_metrics.formula_validity_rate,
    evidence_coverage_rate: candidate_metrics.evidence_coverage_rate,
    legacy_task_success_rate: baseline.data.task_success_rate,
    ooda_task_success_rate: candidate_metrics.task_success_rate,
    schema_valid_terminal_rate: candidate_metrics.schema_valid_terminal_rate,
    event_sequence_integrity_rate:
      candidate_metrics.event_sequence_integrity_rate,
    usage_reconciliation_rate: candidate_metrics.usage_reconciliation_rate,
    accepted_event_p95_ms: candidate_metrics.accepted_event_p95_ms,
    simple_answer_completion_p95_ms:
      candidate_metrics.simple_answer_completion_p95_ms,
    formula_workflow_p95_ms: candidate_metrics.formula_workflow_p95_ms,
    cost_per_success_microusd: candidate_metrics.cost_per_success_microusd,
    approved_cost_per_success_microusd:
      candidate_metrics.approved_cost_per_success_microusd,
    signed_cost_exception: candidate_metrics.signed_cost_exception,
  };
  const evaluation = evaluate_release(metrics);
  const failed_checks = Object.entries(evaluation.checks)
    .filter(([, check]) => !check.passed)
    .map(([name]) => name)
    .sort();
  const summary: CompareEvaluationSummary = {
    schema_version: "1",
    baseline: args.baseline,
    candidate: args.candidate,
    passed: evaluation.passed,
    check_count: Object.keys(evaluation.checks).length,
    failed_checks,
  };
  return { passed: evaluation.passed, summary };
}

/**
 * Run the CLI, print one safe summary, and set failure status on rejected gates.
 *
 * @param args - Arguments after the script path.
 * @param reports_directory - Artifact directory; defaults to the released path.
 * @returns Nothing after output and exit status are set.
 */
export async function main(
  args: readonly string[] = process.argv.slice(2),
  reports_directory = path.resolve("evals/reports"),
): Promise<void> {
  const result = await compare_evaluation_artifacts(
    parse_compare_args(args),
    reports_directory,
    process.env.COMMERCIAL_TEST_ADAPTER_MODE === "credential_free"
      ? "credential_free_test"
      : "reviewed_release",
  );
  process.stdout.write(`${JSON.stringify(result.summary)}\n`);
  if (!result.passed) process.exitCode = 1;
}

const invoked_directly =
  process.argv[1]?.endsWith("compare-evaluations.ts") ?? false;

if (invoked_directly) {
  main().catch((error: unknown) => {
    const message = error instanceof Error
      ? error.message
      : "commercial evaluation comparison failed";
    console.error(message);
    process.exitCode = 1;
  });
}
