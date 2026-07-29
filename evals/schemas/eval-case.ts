/**
 * Strict contract for the immutable commercial evaluation corpus.
 *
 * Evaluation-only identity, permissions, and policy expectations remain in
 * this envelope. The nested public input is the production AgentRunInputV1
 * contract and therefore cannot carry trusted runtime context.
 */
import { z } from "zod";
import { agent_run_input_v1_schema } from "../../packages/shared-types/src/ai/contracts";

export const eval_case_category_v1_schema = z.enum([
  "raw_materials",
  "formulation",
  "sales_rnd",
  "clarification_approval",
  "security",
]);

export const eval_case_difficulty_v1_schema = z.enum([
  "basic",
  "intermediate",
  "advanced",
  "adversarial",
]);

export const eval_data_classification_v1_schema = z.enum([
  "synthetic",
  "consented_redacted",
]);

export const eval_security_scenario_v1_schema = z.enum([
  "tenant_isolation",
  "prompt_injection",
  "retrieved_instruction_injection",
  "tool_argument_injection",
  "unsupported_claim",
  "approval_spoofing",
  "budget_exhaustion",
  "expired_checkpoint",
  "webhook_replay",
  "platform_admin_without_support_grant",
]);

const provenance_v1_schema = z
  .object({
    origin: z.enum(["purpose_built_synthetic", "consented_redacted"]),
    source_reference: z.string().min(1).max(240),
    authoring_method: z.enum(["handcrafted_scenario_matrix", "authorized_redaction"]),
    redaction_status: z.enum(["not_applicable", "verified_redacted"]),
    review_status: z.literal("approved"),
    review_owner: z.string().min(1).max(120),
  })
  .strict();

const expected_behavior_v1_schema = z
  .object({
    terminal_status: z.enum([
      "completed",
      "failed",
      "waiting_clarification",
      "waiting_approval",
    ]),
    response_mode: z.enum([
      "answer",
      "refuse",
      "clarify",
      "request_approval",
      "fail_safe",
    ]),
    required_permissions: z.array(z.string().min(1).max(120)).max(30),
    forbidden_permissions: z.array(z.string().min(1).max(120)).max(30),
    allowed_side_effects: z.array(z.string().min(1).max(120)).max(30),
    forbidden_side_effects: z.array(z.string().min(1).max(120)).max(30),
    expected_error_code: z.string().min(1).max(120).nullable(),
  })
  .strict();

const usage_limit_v1_schema = z
  .object({
    material_id: z.string().min(1).max(128),
    minimum_percent: z.number().min(0).max(100),
    maximum_percent: z.number().min(0).max(100),
  })
  .strict()
  .refine((limit) => limit.minimum_percent <= limit.maximum_percent, {
    message: "minimum_percent must not exceed maximum_percent",
  });

const incompatibility_v1_schema = z
  .object({
    material_a: z.string().min(1).max(128),
    material_b: z.string().min(1).max(128),
    disposition: z.literal("block_coexistence"),
  })
  .strict()
  .refine((pair) => pair.material_a !== pair.material_b, {
    message: "an incompatibility must identify two different materials",
  });

const phase_requirement_v1_schema = z
  .object({
    material_id: z.string().min(1).max(128),
    phase: z.enum(["water", "oil", "cool_down", "ph_adjustment"]),
  })
  .strict();

const formula_constraints_v1_schema = z
  .object({
    total_percent: z
      .object({
        target: z.literal(100),
        tolerance: z.literal(0.01),
      })
      .strict(),
    usage_limits: z.array(usage_limit_v1_schema).min(1).max(30),
    incompatibilities: z.array(incompatibility_v1_schema).min(1).max(30),
    phase_requirements: z.array(phase_requirement_v1_schema).min(1).max(30),
    maximum_cost_thb_per_kg: z.number().positive(),
    manager_confirmation_required: z.literal(true),
  })
  .strict();

const expected_artifact_v1_schema = z
  .object({
    artifact_type: z.enum([
      "none",
      "recommendation",
      "formula",
      "sales_brief",
      "evidence_report",
    ]),
    expected_status: z.enum([
      "not_applicable",
      "presented",
      "draft",
      "pending_approval",
      "confirmed",
    ]),
    required_fields: z.array(z.string().min(1).max(120)).max(50),
    formula_constraints: formula_constraints_v1_schema.nullable(),
  })
  .strict();

const evidence_expectation_v1_schema = z
  .object({
    source_id: z.string().min(1).max(128),
    source_type: z.enum(["knowledge", "web", "formula", "material", "thread"]),
    supports: z.string().min(1).max(500),
  })
  .strict();

const approval_expectation_v1_schema = z
  .object({
    required: z.boolean(),
    approver_role: z.enum(["manager", "platform_admin"]).nullable(),
    expected_outcome: z.enum([
      "not_required",
      "pending",
      "approved",
      "denied",
      "rejected_invalid",
    ]),
  })
  .strict();

const rubric_criterion_v1_schema = z
  .object({
    criterion: z.string().min(1).max(120),
    description: z.string().min(1).max(500),
    weight: z.number().positive().max(1),
  })
  .strict();

const rubric_v1_schema = z
  .object({
    minimum_score: z.number().min(0).max(1),
    criteria: z.array(rubric_criterion_v1_schema).min(1).max(20),
  })
  .strict()
  .refine(
    (rubric) =>
      Math.abs(rubric.criteria.reduce((total, criterion) => total + criterion.weight, 0) - 1) <
      Number.EPSILON * 10,
    { message: "rubric criterion weights must total exactly 1" },
  );

export const eval_case_v1_schema = z
  .object({
    id: z.string().regex(/^eval_v1_[a-z0-9_]+$/),
    version: z.literal("1"),
    category: eval_case_category_v1_schema,
    difficulty: eval_case_difficulty_v1_schema,
    data_classification: eval_data_classification_v1_schema,
    provenance: provenance_v1_schema,
    tenant_fixture: z.string().regex(/^tenant_[a-z0-9_]+$/),
    actor_fixture: z.string().regex(/^actor_[a-z0-9_]+$/),
    input: agent_run_input_v1_schema,
    expected_behavior: expected_behavior_v1_schema,
    expected_artifact: expected_artifact_v1_schema,
    required_evidence: z.array(evidence_expectation_v1_schema).max(50),
    forbidden_evidence: z.array(evidence_expectation_v1_schema).max(50),
    expected_tools: z.array(z.string().min(1).max(120)).max(30),
    forbidden_tools: z.array(z.string().min(1).max(120)).max(30),
    approval: approval_expectation_v1_schema,
    deterministic_checks: z.array(z.string().min(1).max(160)).min(1).max(50),
    rubric: rubric_v1_schema,
    security_scenario: eval_security_scenario_v1_schema.nullable(),
  })
  .strict()
  .superRefine((test_case, context) => {
    const expected_origin =
      test_case.data_classification === "synthetic"
        ? "purpose_built_synthetic"
        : "consented_redacted";
    if (test_case.provenance.origin !== expected_origin) {
      context.addIssue({
        code: "custom",
        path: ["provenance", "origin"],
        message: "provenance origin must match data classification",
      });
    }
    if (
      test_case.category === "formulation" &&
      test_case.expected_artifact.formula_constraints === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["expected_artifact", "formula_constraints"],
        message: "formulation cases require exact formula constraints",
      });
    }
    if (test_case.category === "security" && test_case.security_scenario === null) {
      context.addIssue({
        code: "custom",
        path: ["security_scenario"],
        message: "security cases require an explicit security scenario",
      });
    }
    if (test_case.category !== "security" && test_case.security_scenario !== null) {
      context.addIssue({
        code: "custom",
        path: ["security_scenario"],
        message: "only security cases may declare a security scenario",
      });
    }
  });

export type EvalCaseV1 = z.infer<typeof eval_case_v1_schema>;
