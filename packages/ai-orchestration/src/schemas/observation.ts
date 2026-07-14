/**
 * ObservationV1: the normalized, trust-labeled record of everything the loop
 * has seen — user messages, tool results, denials, validations.
 *
 * Observations are data, never instructions: the message builder renders
 * untrusted content fenced and labeled, and the gate never reads model claims
 * about them.
 */
import { z } from "zod";

/** Trust label controlling how observation content may be rendered. */
export const observation_trust_v1 = z.enum([
  "trusted_system",
  "trusted_user",
  "untrusted_content",
]);
export type ObservationTrustV1 = z.infer<typeof observation_trust_v1>;

/** Categories of observations the loop appends. */
export const observation_type_v1 = z.enum([
  "user_message",
  "thread_summary",
  "tool_result",
  "tool_error",
  "policy_denied",
  "clarification_answer",
  "validation_finding",
  "system_note",
]);
export type ObservationTypeV1 = z.infer<typeof observation_type_v1>;

/** Provenance of one observation. */
export const observation_source_v1_schema = z
  .object({
    kind: z.enum(["user", "tool", "system", "knowledge"]),
    tool_name: z.string().min(1).max(200).nullable(),
    source_ids: z.array(z.string().min(1).max(200)).max(100),
  })
  .strict();
export type ObservationSourceV1 = z.infer<typeof observation_source_v1_schema>;

/** One normalized loop observation. */
export const observation_v1_schema = z
  .object({
    observation_id: z.string().min(1).max(128),
    run_id: z.string().min(1).max(128),
    iteration: z.number().int().min(0),
    type: observation_type_v1,
    source: observation_source_v1_schema,
    content: z.string().max(200_000),
    content_hash: z.string().regex(/^[a-f0-9]{64}$/),
    trust: observation_trust_v1,
    cost_usd: z.string().regex(/^\d+(\.\d+)?$/),
    latency_ms: z.number().min(0),
    occurred_at: z.string().datetime({ offset: true }),
    /** Deterministic evaluator findings (evidence, contradictions, freshness). */
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();
export type ObservationV1 = z.infer<typeof observation_v1_schema>;
