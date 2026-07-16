/** Strict adapter for the frozen legacy executor's evaluation recording. */
import { z } from "zod";
import { usage_summary_v1_schema } from "../../packages/shared-types/src/ai/contracts";
import {
  assemble_recorded_run,
  evaluator_audit_facts_v1_schema,
} from "./adapter-types";
import { recorded_run_v1_schema, type RecordedRun } from "./recorded-run";

const native_legacy_recording_v1_schema = z
  .object({
    schema_version: z.literal("legacy-1"),
    terminal_status: recorded_run_v1_schema.shape.terminal_status,
    response_mode: recorded_run_v1_schema.shape.response_mode,
    error_code: z.string().min(1).max(120).nullable(),
    answer: z.string().max(64_000).nullable(),
    tool_calls: z
      .array(
        z
          .object({
            tool_name: z.string().min(1).max(200),
            sequence: z.number().int().min(0),
            status: z.enum(["ok", "error", "denied"]),
          })
          .strict(),
      )
      .max(200),
    clarification_interrupts: recorded_run_v1_schema.shape.clarification_interrupts,
    usage: usage_summary_v1_schema,
  })
  .strict();

const legacy_adapter_input_v1_schema = z
  .object({
    native: native_legacy_recording_v1_schema,
    audit: evaluator_audit_facts_v1_schema,
  })
  .strict();

export type NativeLegacyRecordingV1 = z.infer<typeof native_legacy_recording_v1_schema>;

/**
 * Normalize an explicit legacy recording without interpreting answer prose.
 *
 * @param input - Native legacy fields plus independently captured audit facts.
 * @returns Strict RecordedRunV1 with executor fixed to legacy.
 * @throws ZodError for malformed input; Error for conflicting behavior labels.
 */
export function adapt_legacy_run(input: unknown): RecordedRun {
  const parsed = legacy_adapter_input_v1_schema.parse(input);
  if (parsed.native.response_mode !== parsed.audit.response_mode) {
    throw new Error("legacy response mode conflicts with evaluator audit");
  }
  return assemble_recorded_run(
    {
      executor: "legacy",
      terminal_status: parsed.native.terminal_status,
      response_mode: parsed.native.response_mode,
      error_code: parsed.native.error_code,
      tool_calls: parsed.native.tool_calls.map(({ tool_name, sequence, status }) => ({
        name: tool_name,
        sequence,
        status,
      })),
      clarification_interrupts: parsed.native.clarification_interrupts,
      reported_usage: parsed.native.usage,
    },
    parsed.audit,
  );
}
