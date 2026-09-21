/** Idempotent tenant retention job applying the stricter configured window. */
import { z } from "zod";
import {
  lifecycle_step_receipt_schema,
  run_lifecycle_step,
  sum_lifecycle_totals,
  type LifecycleReceiptStore,
  type LifecycleReport,
  type LifecycleStepResult,
} from "./lifecycle-types";

const DAY_MS = 86_400_000;

export const retention_job_schema = z
  .object({
    job_id: z.string().min(1).max(128), tenant_id: z.string().min(1).max(128),
    requested_by_profile_id: z.string().min(1).max(128),
    requested_at_iso: z.string().datetime({ offset: true }),
    as_of_iso: z.string().datetime({ offset: true }),
    platform_retention_days: z.number().int().min(1).max(3_650),
    tenant_retention_days: z.number().int().min(1).max(3_650),
  })
  .strict();

export type RetentionJob = z.infer<typeof retention_job_schema>;

const retention_report_schema = z
  .object({
    schema_version: z.literal("1"), operation: z.literal("retention"),
    tenant_id: z.string().min(1), job_id: z.string().min(1), verified: z.boolean(),
    completed_at_iso: z.string().datetime({ offset: true }),
    steps: z.array(lifecycle_step_receipt_schema).length(1),
    totals: z.object({ scanned: z.number().int().min(0), deleted: z.number().int().min(0),
      skipped: z.number().int().min(0), errors: z.number().int().min(0) }).strict(),
    effective_retention_days: z.number().int().min(1),
    delete_before_iso: z.string().datetime({ offset: true }),
  })
  .strict();

export type RetentionReport = z.infer<typeof retention_report_schema>;

export interface RetentionPorts {
  readonly receipts: LifecycleReceiptStore;
  readonly records: {
    apply_retention(input: {
      tenant_id: string; job_id: string; delete_before_iso: string;
      preserve_legal_holds: true;
    }): Promise<LifecycleStepResult>;
  };
  readonly now_iso: () => string;
}

/** Create a tenant-scoped retention service. */
export function create_retention_service(ports: RetentionPorts) {
  return {
    /** Apply the shorter policy window while preserving held records. */
    async apply_retention(input: RetentionJob): Promise<RetentionReport> {
      const job = retention_job_schema.parse(input);
      const existing = await ports.receipts.get_report("retention", job.tenant_id, job.job_id);
      if (existing !== null) return retention_report_schema.parse(existing);
      const effective_retention_days = Math.min(
        job.platform_retention_days,
        job.tenant_retention_days,
      );
      const delete_before_iso = new Date(
        Date.parse(job.as_of_iso) - effective_retention_days * DAY_MS,
      ).toISOString();
      const step = await run_lifecycle_step(
        { operation: "retention", job, step: "tenant_records", receipts: ports.receipts, now_iso: ports.now_iso },
        () => ports.records.apply_retention({
          tenant_id: job.tenant_id, job_id: job.job_id, delete_before_iso,
          preserve_legal_holds: true,
        }),
      );
      const steps = [step];
      const totals = sum_lifecycle_totals(steps);
      const report = retention_report_schema.parse({
        schema_version: "1", operation: "retention", tenant_id: job.tenant_id,
        job_id: job.job_id, verified: totals.errors === 0, completed_at_iso: ports.now_iso(),
        steps, totals, effective_retention_days, delete_before_iso,
      });
      await ports.receipts.save_report(report as LifecycleReport);
      return report;
    },
  };
}
