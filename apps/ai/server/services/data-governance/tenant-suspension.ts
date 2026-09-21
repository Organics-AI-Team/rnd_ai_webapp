/** Tenant-first suspension state machine preserving audit and usage evidence. */
import { z } from "zod";
import {
  lifecycle_step_receipt_schema,
  run_lifecycle_step,
  sum_lifecycle_totals,
  type LifecycleReceiptStore,
  type LifecycleReport,
  type LifecycleStepResult,
} from "./lifecycle-types";

export const tenant_suspension_job_schema = z
  .object({
    job_id: z.string().min(1).max(128),
    tenant_id: z.string().min(1).max(128),
    requested_by_profile_id: z.string().min(1).max(128),
    requested_at_iso: z.string().datetime({ offset: true }),
    reason: z.string().trim().min(10).max(1_000),
  })
  .strict();

export type TenantSuspensionJob = z.infer<typeof tenant_suspension_job_schema>;

/** Fail-closed suspension phase error with a stable operator-facing code. */
export class SuspensionFailedError extends Error {
  readonly code = "TENANT_SUSPENSION_INCOMPLETE" as const;
  readonly step: string;

  constructor(step: string) {
    super(`Tenant suspension phase '${step}' did not verify successfully.`);
    this.name = "SuspensionFailedError";
    this.step = step;
  }
}

const tenant_suspension_report_schema = z
  .object({
    schema_version: z.literal("1"),
    operation: z.literal("suspend"),
    tenant_id: z.string().min(1),
    job_id: z.string().min(1),
    verified: z.boolean(),
    completed_at_iso: z.string().datetime({ offset: true }),
    steps: z.array(lifecycle_step_receipt_schema),
    totals: z.object({
      scanned: z.number().int().min(0), deleted: z.number().int().min(0),
      skipped: z.number().int().min(0), errors: z.number().int().min(0),
    }).strict(),
  })
  .strict();

export type TenantSuspensionReport = z.infer<typeof tenant_suspension_report_schema>;

export interface TenantSuspensionPorts {
  readonly receipts: LifecycleReceiptStore;
  readonly tenant: {
    suspend_once(job: TenantSuspensionJob): Promise<LifecycleStepResult>;
  };
  readonly access: {
    block_new_sessions(job: TenantSuspensionJob): Promise<LifecycleStepResult>;
    block_new_ai_reservations_and_writes(job: TenantSuspensionJob): Promise<LifecycleStepResult>;
    suspend_memberships(job: TenantSuspensionJob): Promise<LifecycleStepResult>;
  };
  readonly now_iso: () => string;
}

/** Throw before the next phase when a suspension receipt reports errors. */
function require_suspension_step(
  receipt: z.infer<typeof lifecycle_step_receipt_schema>,
  required_status?: string,
): void {
  if (
    receipt.errors !== 0 ||
    (required_status !== undefined && receipt.metadata.status !== required_status)
  ) {
    throw new SuspensionFailedError(receipt.step);
  }
}

/** Create the tenant-first suspension state machine. */
export function create_tenant_suspension_service(ports: TenantSuspensionPorts) {
  return {
    /** Suspend a tenant and block new access without deleting evidence. */
    async suspend_tenant(input: TenantSuspensionJob): Promise<TenantSuspensionReport> {
      const job = tenant_suspension_job_schema.parse(input);
      const existing = await ports.receipts.get_report("suspend", job.tenant_id, job.job_id);
      if (existing !== null) return tenant_suspension_report_schema.parse(existing);
      const base = { operation: "suspend" as const, job, receipts: ports.receipts, now_iso: ports.now_iso };
      const tenant_status = await run_lifecycle_step(
        { ...base, step: "tenant_status" },
        () => ports.tenant.suspend_once(job),
      );
      require_suspension_step(tenant_status, "suspended");
      const sessions = await run_lifecycle_step(
        { ...base, step: "sessions" },
        () => ports.access.block_new_sessions(job),
      );
      require_suspension_step(sessions);
      const ai_access = await run_lifecycle_step(
        { ...base, step: "ai_reservations_and_writes" },
        () => ports.access.block_new_ai_reservations_and_writes(job),
      );
      require_suspension_step(ai_access);
      const memberships = await run_lifecycle_step(
        { ...base, step: "memberships" },
        () => ports.access.suspend_memberships(job),
      );
      require_suspension_step(memberships);
      const steps = [tenant_status, sessions, ai_access, memberships];
      const totals = sum_lifecycle_totals(steps);
      const report = tenant_suspension_report_schema.parse({
        schema_version: "1", operation: "suspend", tenant_id: job.tenant_id,
        job_id: job.job_id, verified: totals.errors === 0, completed_at_iso: ports.now_iso(),
        steps, totals,
      });
      await ports.receipts.save_report(report as LifecycleReport);
      return report;
    },
  };
}
