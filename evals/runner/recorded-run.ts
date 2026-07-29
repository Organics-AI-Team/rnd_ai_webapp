/**
 * Strict, executor-neutral trace consumed by the commercial scorers.
 *
 * Legacy and agentic adapters must normalize their native events into this
 * envelope. The envelope contains decisions and measurements, never prompts,
 * hidden reasoning, credentials, or source bodies.
 */
import { z } from "zod";
import { usage_summary_v1_schema } from "../../packages/shared-types/src/ai/contracts";

const decimal_string_schema = z.string().regex(/^\d+(\.\d+)?$/);

const tool_call_schema = z
  .object({
    name: z.string().min(1).max(200),
    sequence: z.number().int().min(0),
    status: z.enum(["ok", "error", "denied"]),
  })
  .strict();

const claim_schema = z
  .object({
    id: z.string().min(1).max(128),
    kind: z.enum(["factual", "opinion", "instruction"]),
    text: z.string().min(1).max(4_000),
  })
  .strict();

const recorded_citation_schema = z
  .object({
    claim_ids: z.array(z.string().min(1).max(128)).min(1).max(100),
    source_id: z.string().min(1).max(128),
    source_type: z.enum(["knowledge", "web", "formula", "material", "thread"]),
    locator: z.string().min(1).max(500),
    content_hash: z.string().regex(/^[a-f0-9]{64}$/),
    retrievable: z.boolean(),
    supports_claim: z.boolean(),
  })
  .strict();

const formula_ingredient_schema = z
  .object({
    material_id: z.string().min(1).max(128),
    percentage: decimal_string_schema,
    phase: z.enum(["water", "oil", "cool_down", "ph_adjustment"]),
  })
  .strict();

const recorded_formula_schema = z
  .object({
    ingredients: z.array(formula_ingredient_schema).min(1).max(100),
    cost_thb_per_kg: decimal_string_schema,
    manager_confirmation_recorded: z.boolean(),
  })
  .strict();

const approval_trace_schema = z
  .object({
    outcome: z.enum(["not_required", "pending", "approved", "denied", "rejected_invalid"]),
    approver_role: z.enum(["manager", "platform_admin"]).nullable(),
    manager_confirmation_recorded: z.boolean(),
  })
  .strict();

const clarification_interrupt_schema = z
  .object({
    questions: z.array(z.string().min(1).max(500)).min(1).max(5),
    tool_calls_before_interrupt: z.number().int().min(0),
  })
  .strict();

const usage_trace_schema = z
  .object({
    reported: usage_summary_v1_schema,
    ledger: usage_summary_v1_schema,
    approved_cost_usd: decimal_string_schema,
  })
  .strict();

const performance_trace_schema = z
  .object({
    accepted_latency_ms: z.number().min(0),
    completion_latency_ms: z.number().min(0),
    human_wait_ms: z.number().min(0),
    maximum_accepted_latency_ms: z.number().min(0),
    maximum_completion_latency_ms: z.number().min(0),
    timed_out: z.boolean(),
  })
  .strict()
  .refine((value) => value.human_wait_ms <= value.completion_latency_ms, {
    message: "human_wait_ms cannot exceed completion_latency_ms",
  });

const grader_trace_schema = z
  .object({
    score: z.number().min(0).max(1),
    blinded: z.boolean(),
    provider: z.string().min(1).max(120),
    model: z.string().min(1).max(120),
    prompt_version: z.string().min(1).max(120),
    prompt_hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const recorded_run_v1_schema = z
  .object({
    schema_version: z.literal("1"),
    executor: z.enum(["legacy", "agentic"]),
    terminal_status: z.enum([
      "completed",
      "failed",
      "waiting_clarification",
      "waiting_approval",
    ]),
    response_mode: z.enum(["answer", "refuse", "clarify", "request_approval", "fail_safe"]),
    error_code: z.string().min(1).max(120).nullable(),
    exact_checks: z.record(z.string().min(1).max(160), z.boolean()),
    tool_calls: z.array(tool_call_schema).max(200),
    permissions_used: z.array(z.string().min(1).max(120)).max(100),
    side_effects: z.array(z.string().min(1).max(120)).max(100),
    evidence_source_ids: z.array(z.string().min(1).max(128)).max(500),
    accessed_tenant_ids: z.array(z.string().min(1).max(128)).max(100),
    unauthorized_commit_count: z.number().int().min(0),
    approval_bypass_count: z.number().int().min(0),
    hard_budget_bypass_count: z.number().int().min(0),
    approval: approval_trace_schema,
    clarification_interrupts: z.array(clarification_interrupt_schema).max(20),
    claims: z.array(claim_schema).max(500),
    citations: z.array(recorded_citation_schema).max(500),
    formula: recorded_formula_schema.nullable(),
    usage: usage_trace_schema,
    performance: performance_trace_schema,
    grader: grader_trace_schema.nullable(),
  })
  .strict();

export type RecordedRun = z.infer<typeof recorded_run_v1_schema>;
export type RecordedFormula = NonNullable<RecordedRun["formula"]>;
