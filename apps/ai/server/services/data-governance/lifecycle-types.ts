/** Shared strict contracts and idempotent phase runner for tenant lifecycle jobs. */
import { z } from "zod";

const lifecycle_metadata_value_schema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const lifecycle_step_result_schema = z
  .object({
    scanned: z.number().int().min(0),
    deleted: z.number().int().min(0),
    skipped: z.number().int().min(0),
    errors: z.number().int().min(0),
    metadata: z.record(z.string(), lifecycle_metadata_value_schema),
  })
  .strict();

export type LifecycleStepResult = z.infer<typeof lifecycle_step_result_schema>;

export const lifecycle_step_receipt_schema = lifecycle_step_result_schema
  .extend({
    schema_version: z.literal("1"),
    operation: z.enum(["export", "suspend", "delete", "retention"]),
    tenant_id: z.string().min(1).max(128),
    job_id: z.string().min(1).max(128),
    step: z.string().min(1).max(128),
    completed_at_iso: z.string().datetime({ offset: true }),
  })
  .strict();

export type LifecycleStepReceipt = z.infer<typeof lifecycle_step_receipt_schema>;

export interface LifecycleTotals {
  readonly scanned: number;
  readonly deleted: number;
  readonly skipped: number;
  readonly errors: number;
}

export interface LifecycleReport {
  readonly schema_version: "1";
  readonly operation: "export" | "suspend" | "delete" | "retention";
  readonly tenant_id: string;
  readonly job_id: string;
  readonly verified: boolean;
  readonly completed_at_iso: string;
  readonly steps: readonly LifecycleStepReceipt[];
  readonly totals: LifecycleTotals;
}

export interface LifecycleReceiptStore {
  /** Load a completed operation report by compound tenant/job key. */
  get_report(operation: string, tenant_id: string, job_id: string): Promise<unknown | null>;
  /** Atomically persist a completed operation report if absent. */
  save_report(report: LifecycleReport): Promise<void>;
  /** Load one completed phase by compound tenant/job/step key. */
  get_step(
    operation: string,
    tenant_id: string,
    job_id: string,
    step: string,
  ): Promise<LifecycleStepReceipt | null>;
  /** Atomically persist one completed phase if absent. */
  save_step(receipt: LifecycleStepReceipt): Promise<void>;
}

export interface LifecycleJobIdentity {
  readonly job_id: string;
  readonly tenant_id: string;
  readonly requested_by_profile_id: string;
  readonly requested_at_iso: string;
}

export interface RunLifecycleStepArgs {
  readonly operation: LifecycleStepReceipt["operation"];
  readonly job: LifecycleJobIdentity;
  readonly step: string;
  readonly receipts: LifecycleReceiptStore;
  readonly now_iso: () => string;
}

/**
 * Run one phase once per tenant/job and persist its deterministic receipt.
 *
 * Destructive port implementations must also honor job_id idempotently so a
 * process crash between the external action and receipt write remains safe.
 *
 * @param args - Compound idempotency scope and receipt dependencies.
 * @param action - Tenant-scoped, independently idempotent phase action.
 * @returns Existing or newly persisted phase receipt.
 */
export async function run_lifecycle_step(
  args: RunLifecycleStepArgs,
  action: () => Promise<LifecycleStepResult>,
): Promise<LifecycleStepReceipt> {
  const existing = await args.receipts.get_step(
    args.operation,
    args.job.tenant_id,
    args.job.job_id,
    args.step,
  );
  if (existing !== null) return lifecycle_step_receipt_schema.parse(existing);
  const result = lifecycle_step_result_schema.parse(await action());
  const receipt = lifecycle_step_receipt_schema.parse({
    schema_version: "1",
    operation: args.operation,
    tenant_id: args.job.tenant_id,
    job_id: args.job.job_id,
    step: args.step,
    completed_at_iso: args.now_iso(),
    ...result,
  });
  await args.receipts.save_step(receipt);
  return receipt;
}

/**
 * Sum stable scanned/deleted/skipped/error counters across phase receipts.
 *
 * @param steps - Completed lifecycle phase receipts.
 * @returns Aggregate report counters.
 */
export function sum_lifecycle_totals(steps: readonly LifecycleStepReceipt[]): LifecycleTotals {
  return steps.reduce(
    (total, step) => ({
      scanned: total.scanned + step.scanned,
      deleted: total.deleted + step.deleted,
      skipped: total.skipped + step.skipped,
      errors: total.errors + step.errors,
    }),
    { scanned: 0, deleted: 0, skipped: 0, errors: 0 },
  );
}

/**
 * Canonically stringify JSON-like export data with stable object-key order.
 *
 * @param value - Snapshot value to serialize.
 * @returns Stable JSON representation.
 */
export function stable_lifecycle_json(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stable_lifecycle_json).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const with_to_json = value as { toJSON?: () => unknown };
    if (typeof with_to_json.toJSON === "function") {
      return stable_lifecycle_json(with_to_json.toJSON());
    }
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stable_lifecycle_json(nested)}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("tenant lifecycle snapshot is not JSON serializable");
  return serialized;
}
