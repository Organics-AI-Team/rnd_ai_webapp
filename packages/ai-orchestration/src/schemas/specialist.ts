/**
 * Specialist delegation contracts (G4.6).
 *
 * A specialist runs the same governed loop recursively for a bounded sub-task.
 * The PUBLIC request the parent model emits carries no tenant, actor,
 * permission, provider, or credential field — identity is injected out-of-band
 * exactly like every other tool. The result returns normalized observations and
 * NON-COMMIT proposals to the parent loop; the parent agent node remains the
 * only component that selects the next action, and only ToolExecutor commits.
 */

import { z } from "zod";

/** The three specialist keys the platform recognises. */
export const specialist_key_schema = z.enum([
  "raw_material_research",
  "formulation",
  "sales_rnd",
]);
export type SpecialistKey = z.infer<typeof specialist_key_schema>;

/**
 * Public, model-visible delegation request. Deliberately free of identity,
 * policy, provider, and credential fields (program invariant: identity travels
 * beside model input, never inside it).
 */
export const specialist_request_v1_schema = z
  .object({
    objective: z.string().min(1).max(4_000),
    context_note: z.string().max(4_000).optional(),
    completion_criteria: z.array(z.string().min(1).max(500)).max(10).optional(),
  })
  .strict();
export type SpecialistRequestV1 = z.infer<typeof specialist_request_v1_schema>;

/**
 * One thing the specialist did or recommends. A specialist can never commit, so
 * side_effect is constrained to read or draft.
 */
export const specialist_proposal_v1_schema = z
  .object({
    tool_name: z.string().min(1).max(200),
    side_effect: z.enum(["read", "draft"]),
    summary: z.string().max(1_000),
  })
  .strict();
export type SpecialistProposalV1 = z.infer<typeof specialist_proposal_v1_schema>;

/**
 * The specialist's normalized result returned to the parent loop as evidence.
 * tenant_id/parent_run_id/depth are stamped from the trusted runtime, never
 * from the request.
 */
export const specialist_result_v1_schema = z
  .object({
    specialist_key: specialist_key_schema,
    tenant_id: z.string().min(1),
    parent_run_id: z.string().min(1),
    depth: z.number().int().min(1),
    status: z.enum(["complete", "incomplete"]),
    summary: z.string().max(64_000),
    evidence_ids: z.array(z.string().min(1)).max(200),
    proposals: z.array(specialist_proposal_v1_schema).max(50),
    uncertainty: z.array(z.string().max(1_000)).max(50),
  })
  .strict();
export type SpecialistResultV1 = z.infer<typeof specialist_result_v1_schema>;
