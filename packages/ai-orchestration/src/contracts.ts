/**
 * Loop-internal contracts of the governed agentic orchestrator, plus
 * re-exports of the versioned public contracts from shared types.
 *
 * DecisionRecordV1 is a DERIVED audit record of the model's native tool call
 * — the model is never asked to emit any decision schema.
 */
import { z } from "zod";
import {
  citation_v1_schema,
  run_error_code_v1,
} from "@rnd-ai/shared-types/src/ai/contracts";

export {
  agent_key_v1,
  agent_run_event_v1_schema,
  agent_run_input_v1_schema,
  agent_run_output_v1_schema,
  artifact_reference_v1_schema,
  citation_v1_schema,
  decision_record_v1_schema,
  decision_summary_v1_schema,
  quality_dimensions_v1_schema,
  run_error_code_v1,
  run_error_v1_schema,
  run_stage_v1,
  usage_summary_v1_schema,
  validation_result_v1_schema,
} from "@rnd-ai/shared-types/src/ai/contracts";
export type {
  AgentKeyV1,
  AgentRunEventV1,
  AgentRunInputV1,
  AgentRunOutputV1,
  ArtifactReferenceV1,
  CitationV1,
  DecisionRecordV1,
  DecisionSummaryV1,
  QualityDimensionsV1,
  RunErrorCodeV1,
  RunErrorV1,
  RunStageV1,
  UsageSummaryV1,
  ValidationResultV1,
} from "@rnd-ai/shared-types/src/ai/contracts";

/** Reserved built-in declared tools handled by the loop itself. */
export const BUILTIN_TOOLS = Object.freeze({
  request_clarification: "request_clarification",
  finalize: "finalize",
});

/** Bounded clarification request derived from the model's clarify tool call. */
export const clarification_request_v1_schema = z
  .object({
    questions: z.array(z.string().min(1).max(500)).min(1).max(5),
  })
  .strict();
export type ClarificationRequestV1 = z.infer<
  typeof clarification_request_v1_schema
>;

/** Finalize request derived from the model's finalize tool call. */
export const finalize_request_v1_schema = z
  .object({
    answer: z.string().min(1).max(64_000),
    citations: z.array(citation_v1_schema).max(200).default([]),
    uncertainty: z.array(z.string().max(1_000)).max(50).default([]),
  })
  .strict();
export type FinalizeRequestV1 = z.infer<typeof finalize_request_v1_schema>;

/**
 * The single action a model turn proposes. Only deterministic code may turn
 * a proposal into a side effect (program invariant 7).
 */
export const proposed_action_v1_schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("tool"),
      call_id: z.string().min(1).max(128),
      tool_name: z.string().min(1).max(200),
      arguments: z.unknown(),
      arguments_hash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("clarification"),
      call_id: z.string().min(1).max(128),
      request: clarification_request_v1_schema,
      arguments_hash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("finalize"),
      call_id: z.string().min(1).max(128),
      request: finalize_request_v1_schema,
      arguments_hash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
]);
export type ProposedActionV1 = z.infer<typeof proposed_action_v1_schema>;

/** Result bookkeeping for one gated action. */
export const action_result_v1_schema = z
  .object({
    action_id: z.string().min(1).max(128),
    run_id: z.string().min(1).max(128),
    iteration: z.number().int().min(1),
    tool_name: z.string().min(1).max(200),
    arguments_hash: z.string().regex(/^[a-f0-9]{64}$/),
    idempotency_key: z.string().min(1).max(512),
    status: z.enum(["ok", "error", "denied"]),
    attempts: z.number().int().min(1),
    cost_usd: z.string().regex(/^\d+(\.\d+)?$/),
    latency_ms: z.number().min(0),
    observation_id: z.string().min(1).max(128),
    occurred_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type ActionResultV1 = z.infer<typeof action_result_v1_schema>;

/** Deterministic per-run budget; cost bounds are decimal strings. */
export const run_budget_v1_schema = z
  .object({
    max_iterations: z.number().int().min(1).max(200),
    max_total_tokens: z.number().int().min(1),
    max_cost_usd: z.string().regex(/^\d+(\.\d+)?$/),
  })
  .strict();
export type RunBudgetV1 = z.infer<typeof run_budget_v1_schema>;

/** Version pins recorded on the run at ingress; immutable within a run. */
export const run_pins_v1_schema = z
  .object({
    orchestrator_version: z.string().min(1).max(64),
    policy_version: z.string().min(1).max(64),
    deployment_version: z.string().min(1).max(64),
    prompt_version: z.string().min(1).max(64),
    context_pack_hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type RunPinsV1 = z.infer<typeof run_pins_v1_schema>;

/** Live usage counters accumulated across the loop. */
export const loop_usage_v1_schema = z
  .object({
    model_calls: z.number().int().min(0),
    tool_calls: z.number().int().min(0),
    input_tokens: z.number().int().min(0),
    output_tokens: z.number().int().min(0),
    tokens_used: z.number().int().min(0),
    cost_usd_used: z.string().regex(/^\d+(\.\d+)?$/),
  })
  .strict();
export type LoopUsageV1 = z.infer<typeof loop_usage_v1_schema>;

/** Approval interrupt payload surfaced to the human approver (G4.7). */
export const approval_request_v1_schema = z
  .object({
    schema_version: z.literal("1"),
    approval_id: z.string().min(1).max(128),
    run_id: z.string().min(1).max(128),
    summary: z.string().min(1).max(2_000),
  })
  .strict();
export type ApprovalRequestV1 = z.infer<typeof approval_request_v1_schema>;

/** Approval resume payload provided by the durable interrupt (G4.7). */
export const approval_resume_v1_schema = z
  .object({
    approval_id: z.string().min(1).max(128),
    decision: z.enum(["approve", "deny"]),
    decided_by_profile_id: z.string().min(1).max(128),
  })
  .strict();
export type ApprovalResumeV1 = z.infer<typeof approval_resume_v1_schema>;

/** Verified approval outcome recorded on the run (G4.7). */
export const approval_result_v1_schema = z
  .object({
    approval_id: z.string().min(1).max(128),
    status: z.enum(["approved", "denied"]),
    /** Hash of the action this decision authorizes; pins it to one action. */
    action_arguments_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  })
  .strict();
export type ApprovalResultV1 = z.infer<typeof approval_result_v1_schema>;

/** Clarification resume payload: the user's bounded answer (G4.7). */
export const clarification_resume_v1_schema = z
  .object({
    answer: z.string().min(1).max(4_000),
  })
  .strict();
export type ClarificationResumeV1 = z.infer<typeof clarification_resume_v1_schema>;

/** Zero-valued usage counters for run initialization. */
export const empty_loop_usage: LoopUsageV1 = Object.freeze({
  model_calls: 0,
  tool_calls: 0,
  input_tokens: 0,
  output_tokens: 0,
  tokens_used: 0,
  cost_usd_used: "0",
});
