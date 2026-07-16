/** Shared evaluator-audit facts and assembly helpers for native executor adapters. */
import { z } from "zod";
import { usage_summary_v1_schema } from "../../packages/shared-types/src/ai/contracts";
import { recorded_run_v1_schema, type RecordedRun } from "./recorded-run";

export const evaluator_audit_facts_v1_schema = recorded_run_v1_schema
  .pick({
    exact_checks: true,
    permissions_used: true,
    side_effects: true,
    evidence_source_ids: true,
    accessed_tenant_ids: true,
    unauthorized_commit_count: true,
    approval_bypass_count: true,
    hard_budget_bypass_count: true,
    approval: true,
    claims: true,
    citations: true,
    formula: true,
    performance: true,
    grader: true,
  })
  .extend({
    response_mode: recorded_run_v1_schema.shape.response_mode,
    ledger_usage: usage_summary_v1_schema,
    approved_cost_usd: z.string().regex(/^\d+(\.\d+)?$/),
  })
  .strict();

export type EvaluatorAuditFactsV1 = z.infer<typeof evaluator_audit_facts_v1_schema>;

export interface AssembleRecordedRunArgs {
  readonly executor: "legacy" | "agentic";
  readonly terminal_status: RecordedRun["terminal_status"];
  readonly response_mode: RecordedRun["response_mode"];
  readonly error_code: string | null;
  readonly tool_calls: RecordedRun["tool_calls"];
  readonly clarification_interrupts: RecordedRun["clarification_interrupts"];
  readonly reported_usage: RecordedRun["usage"]["reported"];
}

/**
 * Assemble and validate a strict RecordedRunV1 from native and evaluator facts.
 *
 * @param args - Observable executor facts derived by a native adapter.
 * @param audit - Evaluator-captured safety, evidence, budget, and ledger facts.
 * @returns Strict executor-neutral run recording.
 * @throws ZodError when either source violates the recorded-run boundary.
 */
export function assemble_recorded_run(
  args: AssembleRecordedRunArgs,
  audit: EvaluatorAuditFactsV1,
): RecordedRun {
  return recorded_run_v1_schema.parse({
    schema_version: "1",
    executor: args.executor,
    terminal_status: args.terminal_status,
    response_mode: args.response_mode,
    error_code: args.error_code,
    exact_checks: audit.exact_checks,
    tool_calls: args.tool_calls,
    permissions_used: audit.permissions_used,
    side_effects: audit.side_effects,
    evidence_source_ids: audit.evidence_source_ids,
    accessed_tenant_ids: audit.accessed_tenant_ids,
    unauthorized_commit_count: audit.unauthorized_commit_count,
    approval_bypass_count: audit.approval_bypass_count,
    hard_budget_bypass_count: audit.hard_budget_bypass_count,
    approval: audit.approval,
    clarification_interrupts: args.clarification_interrupts,
    claims: audit.claims,
    citations: audit.citations,
    formula: audit.formula,
    usage: {
      reported: args.reported_usage,
      ledger: audit.ledger_usage,
      approved_cost_usd: audit.approved_cost_usd,
    },
    performance: audit.performance,
    grader: audit.grader,
  });
}
