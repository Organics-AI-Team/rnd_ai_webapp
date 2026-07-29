/**
 * Deterministic output scaffolding shared by fail (safe partial output) and
 * finalize (interim minimal output until plan Task 8 adds full validators).
 *
 * No model involvement: everything here is computed from normalized state.
 */
import {
  agent_run_output_v1_schema,
} from "./contracts";
import type {
  AgentRunOutputV1,
  ArtifactReferenceV1,
  CitationV1,
  QualityDimensionsV1,
  UsageSummaryV1,
  ValidationResultV1,
} from "./contracts";
import type { AgentLoopRuntime } from "./ports";
import type { AgentLoopStateType } from "./state";

/** Conservative quality-dimension floors used when nothing computed better. */
const DEFAULT_QUALITY_DIMENSIONS: QualityDimensionsV1 = Object.freeze({
  groundedness: 0,
  evidence_coverage: 0,
  source_quality: 0,
  source_freshness_days: null,
  contradiction_state: "none",
  validation_rate: 0,
  completeness: 0,
  risk_severity: "none",
});

/**
 * Map live loop usage counters to the public usage summary.
 *
 * @param state - Current loop state.
 * @returns UsageSummaryV1 with decimal cost preserved as a string.
 */
export function summarize_usage(state: AgentLoopStateType): UsageSummaryV1 {
  return {
    model_calls: state.usage.model_calls,
    tool_calls: state.usage.tool_calls,
    input_tokens: state.usage.input_tokens,
    output_tokens: state.usage.output_tokens,
    total_tokens: state.usage.tokens_used,
    cost_usd: state.usage.cost_usd_used,
  };
}

/**
 * Collect unique evidence source IDs from tool-result observations.
 *
 * @param state - Current loop state.
 * @returns Up to 100 unique source identifiers, in first-seen order.
 */
export function collect_evidence_references(
  state: AgentLoopStateType,
): string[] {
  const seen = new Set<string>();
  for (const observation of state.observations) {
    if (observation.type !== "tool_result") continue;
    for (const source_id of observation.source.source_ids) {
      seen.add(source_id);
      if (seen.size >= 100) return [...seen];
    }
  }
  return [...seen];
}

/** Arguments for building a deterministic output document. */
export interface BuildOutputArgs {
  readonly status: "completed" | "failed";
  readonly answer: string | null;
  readonly citations: readonly CitationV1[];
  readonly uncertainty: readonly string[];
  /** Computed quality dimensions; defaults to conservative floors when omitted. */
  readonly quality_dimensions?: QualityDimensionsV1;
  /** Draft/confirmed artifact references produced by the run (default none). */
  readonly artifacts?: readonly ArtifactReferenceV1[];
  /** Deterministic validation results for the decision summary (default none). */
  readonly validation_results?: readonly ValidationResultV1[];
  /** Extra warnings appended to the run's warnings (e.g. finalize findings). */
  readonly extra_warnings?: readonly string[];
}

/**
 * Build a schema-validated AgentRunOutputV1 from normalized state.
 *
 * Quality dimensions are conservative floors here; plan Task 8 replaces them
 * with computed groundedness/coverage/validation metrics in finalize.
 *
 * @param state - Current loop state.
 * @param runtime - Node runtime (clock for completed_at).
 * @param args - Status, answer, citations, and uncertainty statements.
 * @returns Validated output document.
 * @throws ZodError when assembly violates the public contract (fail closed).
 */
export function build_output_document(
  state: AgentLoopStateType,
  runtime: AgentLoopRuntime,
  args: BuildOutputArgs,
): AgentRunOutputV1 {
  return agent_run_output_v1_schema.parse({
    schema_version: "1",
    run_id: state.run_id,
    status: args.status,
    answer: args.answer,
    decision_summary: {
      facts_considered: [],
      evidence_references: collect_evidence_references(state),
      action_rationales: state.decision_log
        .map((decision) => decision.rationale_summary)
        .filter((rationale) => rationale.length > 0)
        .slice(0, 50),
      validation_results: [...(args.validation_results ?? [])].slice(0, 100),
      uncertainty: [...args.uncertainty].slice(0, 50),
    },
    citations: [...args.citations].slice(0, 200),
    artifacts: [...(args.artifacts ?? [])].slice(0, 20),
    quality_dimensions: args.quality_dimensions ?? DEFAULT_QUALITY_DIMENSIONS,
    warnings: [...state.warnings, ...(args.extra_warnings ?? [])].slice(0, 100),
    usage_summary: summarize_usage(state),
    started_at: state.started_at,
    completed_at: runtime.ports.clock.now_iso(),
  });
}
