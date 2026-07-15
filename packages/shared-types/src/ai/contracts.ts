/**
 * Versioned public AI contracts shared by the web app, the AI gateway, and
 * the orchestration package.
 *
 * Rules enforced here (program invariants 1, 5, 9):
 * - Public run input carries no tenant, user, role, policy, model, tool, or
 *   provider fields; identity is resolved server-side from a verified session.
 * - Events and outputs expose safe payloads only — no hidden reasoning,
 *   prompts, provider errors, or secrets.
 * - Quality is a set of named dimensions, never a lone scalar confidence.
 */
import { z } from "zod";

/** Agent personas selectable by a public run request. */
export const agent_key_v1 = z.enum([
  "raw_material_research",
  "formulation",
  "sales_rnd",
]);
export type AgentKeyV1 = z.infer<typeof agent_key_v1>;

/** Derived UI stage bookkeeping (not graph phase state). */
export const run_stage_v1 = z.enum([
  "thinking",
  "acting",
  "waiting_user",
  "finalizing",
]);
export type RunStageV1 = z.infer<typeof run_stage_v1>;

/** Stable, safe error codes a run can terminate or warn with. */
export const run_error_code_v1 = z.enum([
  "LIMIT_MAX_ITERATIONS",
  "LIMIT_DEADLINE",
  "LIMIT_TOKENS",
  "LIMIT_COST",
  "LOOP_DETECTED",
  "MODEL_OUTPUT_INVALID",
  "TOOL_OUTPUT_INVALID",
  "POLICY_EMERGENCY_DISABLED",
  "POLICY_DEPLOYMENT_REVOKED",
  "POLICY_TOOL_NOT_ALLOWED",
  "POLICY_PERMISSION_MISSING",
  "BUDGET_RESERVATION_FAILED",
  "CONTEXT_PACK_INVALID",
  "INPUT_INVALID",
  "ORCHESTRATOR_VERSION_UNSUPPORTED",
  "ORCHESTRATOR_INVARIANT_VIOLATION",
  "PROVIDER_UNAVAILABLE",
]);
export type RunErrorCodeV1 = z.infer<typeof run_error_code_v1>;

/**
 * Strict public run input. Contains no identity or security fields — the
 * gateway resolves tenant, actor, policy, deployment, and tools server-side.
 */
export const agent_run_input_v1_schema = z
  .object({
    schema_version: z.literal("1"),
    thread_id: z.string().min(1).max(128),
    agent_key: agent_key_v1,
    message: z.string().min(1).max(32_000),
    attachment_source_ids: z.array(z.string().min(1).max(128)).max(20),
    response_preferences: z
      .object({
        language: z.enum(["en", "th"]),
        detail: z.enum(["concise", "standard", "detailed"]),
      })
      .strict(),
    idempotency_key: z.string().min(8).max(128),
  })
  .strict();
export type AgentRunInputV1 = z.infer<typeof agent_run_input_v1_schema>;

/**
 * A user's answer to a clarification interrupt, submitted to resume a run. The
 * resume route accepts ONLY this or an approval decision — never arbitrary graph
 * state.
 */
export const clarification_response_v1_schema = z
  .object({
    kind: z.literal("clarification"),
    answer: z.string().min(1).max(32_000),
  })
  .strict();
export type ClarificationResponseV1 = z.infer<typeof clarification_response_v1_schema>;

/**
 * A manager's decision on an approval interrupt, submitted to resume a run.
 */
export const approval_decision_v1_schema = z
  .object({
    kind: z.literal("approval"),
    approval_id: z.string().min(1).max(128),
    decision: z.enum(["approve", "deny"]),
    decided_by_profile_id: z.string().min(1).max(128),
  })
  .strict();
export type ApprovalDecisionV1 = z.infer<typeof approval_decision_v1_schema>;

/**
 * The strict resume payload the resume route accepts: exactly one interrupt
 * response, discriminated by `kind`. Anything else is rejected before a resume
 * job is enqueued.
 */
export const resume_request_v1_schema = z.discriminatedUnion("kind", [
  clarification_response_v1_schema,
  approval_decision_v1_schema,
]);
export type ResumeRequestV1 = z.infer<typeof resume_request_v1_schema>;

/** One evidence citation surfaced with an answer or artifact. */
export const citation_v1_schema = z
  .object({
    source_id: z.string().min(1),
    source_type: z.enum(["knowledge", "web", "formula", "material", "thread"]),
    reference: z.string().min(1).max(500),
    retrieved_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type CitationV1 = z.infer<typeof citation_v1_schema>;

/** Reference to a produced tenant artifact (payloads travel separately). */
export const artifact_reference_v1_schema = z
  .object({
    artifact_id: z.string().min(1),
    artifact_type: z.enum(["formula"]),
    version: z.number().int().min(1),
    status: z.enum(["draft", "pending_approval", "confirmed"]),
  })
  .strict();
export type ArtifactReferenceV1 = z.infer<typeof artifact_reference_v1_schema>;

/**
 * Named quality dimensions. Strict so an arbitrary single "confidence"
 * scalar can never be attached (program invariant 9).
 */
export const quality_dimensions_v1_schema = z
  .object({
    groundedness: z.number().min(0).max(1),
    evidence_coverage: z.number().min(0).max(1),
    source_quality: z.number().min(0).max(1),
    source_freshness_days: z.number().min(0).nullable(),
    contradiction_state: z.enum(["none", "flagged"]),
    validation_rate: z.number().min(0).max(1),
    completeness: z.number().min(0).max(1),
    risk_severity: z.enum(["none", "low", "medium", "high"]),
  })
  .strict();
export type QualityDimensionsV1 = z.infer<typeof quality_dimensions_v1_schema>;

/** Deterministic validation outcome surfaced in decision summaries. */
export const validation_result_v1_schema = z
  .object({
    code: z.string().min(1).max(120),
    passed: z.boolean(),
    detail: z.string().max(500).optional(),
  })
  .strict();
export type ValidationResultV1 = z.infer<typeof validation_result_v1_schema>;

/**
 * Facts, evidence, rationales, validations, and uncertainty — never hidden
 * reasoning tokens (program invariant 9).
 */
export const decision_summary_v1_schema = z
  .object({
    facts_considered: z.array(z.string().max(1_000)).max(50),
    evidence_references: z.array(z.string().max(200)).max(100),
    action_rationales: z.array(z.string().max(1_000)).max(50),
    validation_results: z.array(validation_result_v1_schema).max(100),
    uncertainty: z.array(z.string().max(1_000)).max(50),
  })
  .strict();
export type DecisionSummaryV1 = z.infer<typeof decision_summary_v1_schema>;

/** Final token/cost accounting for a run; cost is a decimal string. */
export const usage_summary_v1_schema = z
  .object({
    model_calls: z.number().int().min(0),
    tool_calls: z.number().int().min(0),
    input_tokens: z.number().int().min(0),
    output_tokens: z.number().int().min(0),
    total_tokens: z.number().int().min(0),
    cost_usd: z.string().regex(/^\d+(\.\d+)?$/),
  })
  .strict();
export type UsageSummaryV1 = z.infer<typeof usage_summary_v1_schema>;

/** Versioned public run output. */
export const agent_run_output_v1_schema = z
  .object({
    schema_version: z.literal("1"),
    run_id: z.string().min(1),
    status: z.enum(["completed", "failed"]),
    answer: z.string().max(64_000).nullable(),
    decision_summary: decision_summary_v1_schema,
    citations: z.array(citation_v1_schema).max(200),
    artifacts: z.array(artifact_reference_v1_schema).max(20),
    quality_dimensions: quality_dimensions_v1_schema,
    warnings: z.array(z.string().max(1_000)).max(100),
    usage_summary: usage_summary_v1_schema,
    started_at: z.string().datetime({ offset: true }),
    completed_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type AgentRunOutputV1 = z.infer<typeof agent_run_output_v1_schema>;

/**
 * Derived audit record of one agent turn, computed from the model's native
 * tool call — the model is never asked to emit this schema.
 */
export const decision_record_v1_schema = z
  .object({
    iteration: z.number().int().min(1),
    kind: z.enum(["tool", "clarify", "finalize"]),
    tool_name: z.string().min(1).max(200).nullable(),
    arguments_hash: z.string().regex(/^[a-f0-9]{64}$/),
    rationale_summary: z.string().max(600),
    occurred_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type DecisionRecordV1 = z.infer<typeof decision_record_v1_schema>;

/**
 * Safe terminal error. Provider bodies, stack traces, prompts, and evidence
 * content stay in redacted internal diagnostics — never here.
 */
export const run_error_v1_schema = z
  .object({
    code: run_error_code_v1,
    safe_message: z.string().min(1).max(1_000),
    retryable: z.boolean(),
    correlation_id: z.string().min(1).max(128),
    partial_output: agent_run_output_v1_schema.nullable(),
  })
  .strict();
export type RunErrorV1 = z.infer<typeof run_error_v1_schema>;

const event_base = {
  schema_version: z.literal("1"),
  event_id: z.string().min(1).max(128),
  run_id: z.string().min(1).max(128),
  sequence: z.number().int().min(0),
  occurred_at: z.string().datetime({ offset: true }),
};

/**
 * Discriminated union of every typed run event. stage.changed is derived UI
 * bookkeeping, not graph phase state; payloads are safe by construction.
 */
export const agent_run_event_v1_schema = z.discriminatedUnion("type", [
  z
    .object({
      ...event_base,
      type: z.literal("run.accepted"),
      payload: z
        .object({
          agent_key: agent_key_v1,
          context_pack_hash: z.string().regex(/^[a-f0-9]{64}$/),
          orchestrator_version: z.string().min(1).max(64),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...event_base,
      type: z.literal("stage.changed"),
      payload: z.object({ stage: run_stage_v1 }).strict(),
    })
    .strict(),
  z
    .object({
      ...event_base,
      type: z.literal("observation.added"),
      payload: z
        .object({
          observation_id: z.string().min(1),
          observation_type: z.string().min(1).max(64),
          trust: z.enum(["trusted_system", "trusted_user", "untrusted_content"]),
          source_kind: z.enum(["user", "tool", "system", "knowledge"]),
          tool_name: z.string().min(1).max(200).nullable(),
          content_hash: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...event_base,
      type: z.literal("decision.recorded"),
      payload: z
        .object({
          iteration: z.number().int().min(1),
          kind: z.enum(["tool", "clarify", "finalize"]),
          tool_name: z.string().min(1).max(200).nullable(),
          arguments_hash: z.string().regex(/^[a-f0-9]{64}$/),
          rationale_summary: z.string().max(600),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...event_base,
      type: z.literal("action.started"),
      payload: z
        .object({
          action_id: z.string().min(1),
          tool_name: z.string().min(1).max(200),
          iteration: z.number().int().min(1),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...event_base,
      type: z.literal("action.completed"),
      payload: z
        .object({
          action_id: z.string().min(1),
          tool_name: z.string().min(1).max(200),
          status: z.enum(["ok", "error", "denied"]),
          latency_ms: z.number().min(0),
          cost_usd: z.string().regex(/^\d+(\.\d+)?$/),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...event_base,
      type: z.literal("clarification.required"),
      payload: z
        .object({ questions: z.array(z.string().min(1).max(500)).min(1).max(5) })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...event_base,
      type: z.literal("approval.required"),
      payload: z
        .object({
          approval_id: z.string().min(1),
          summary: z.string().min(1).max(1_000),
          tool_name: z.string().min(1).max(200),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...event_base,
      type: z.literal("artifact.updated"),
      payload: z
        .object({
          artifact_id: z.string().min(1),
          artifact_type: z.enum(["formula"]),
          version: z.number().int().min(1),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...event_base,
      type: z.literal("usage.updated"),
      payload: z
        .object({
          model_calls: z.number().int().min(0),
          tool_calls: z.number().int().min(0),
          tokens_used: z.number().int().min(0),
          cost_usd_used: z.string().regex(/^\d+(\.\d+)?$/),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...event_base,
      type: z.literal("run.completed"),
      payload: z
        .object({
          status: z.literal("completed"),
          output_schema_version: z.literal("1"),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...event_base,
      type: z.literal("run.failed"),
      payload: z
        .object({
          code: run_error_code_v1,
          safe_message: z.string().min(1).max(1_000),
          retryable: z.boolean(),
        })
        .strict(),
    })
    .strict(),
]);
export type AgentRunEventV1 = z.infer<typeof agent_run_event_v1_schema>;

// ============================================
// AI RUN SCHEMA-VERSION PINS (G3.1)
// ============================================
// The payload shapes above are owned by the G4 OODA agent orchestration plan
// (docs/superpowers/plans/2026-07-15-ooda-agent-orchestration.md). G3 only
// pins the literal versions persisted on AIRun.inputSchemaVersion and
// AIRun.outputSchemaVersion.

/**
 * Literal schema-version values a run contract may declare. New revisions
 * widen this union alongside a new payload schema; existing literals are
 * never mutated so stored pins stay resolvable.
 */
export type AgentRunSchemaVersion = "1";

/** Version pinned on AIRun.inputSchemaVersion for newly created runs. */
export const AGENT_RUN_INPUT_SCHEMA_VERSION: AgentRunSchemaVersion = "1";

/** Version pinned on AIRun.outputSchemaVersion for newly created runs. */
export const AGENT_RUN_OUTPUT_SCHEMA_VERSION: AgentRunSchemaVersion = "1";
