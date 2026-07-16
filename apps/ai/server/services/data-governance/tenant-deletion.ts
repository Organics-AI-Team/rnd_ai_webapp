/** Explicit phased tenant deletion with legal-hold and tenant-filter gates. */
import { z } from "zod";
import {
  lifecycle_step_receipt_schema,
  run_lifecycle_step,
  sum_lifecycle_totals,
  type LifecycleReceiptStore,
  type LifecycleReport,
  type LifecycleStepReceipt,
  type LifecycleStepResult,
} from "./lifecycle-types";

export class LegalHoldError extends Error {
  readonly code = "LEGAL_HOLD_ACTIVE" as const;
  constructor(tenant_id: string) {
    super(`Tenant ${tenant_id} has an active legal hold.`);
    this.name = "LegalHoldError";
  }
}

export const tenant_deletion_job_schema = z
  .object({
    job_id: z.string().min(1).max(128), tenant_id: z.string().min(1).max(128),
    requested_by_profile_id: z.string().min(1).max(128),
    requested_at_iso: z.string().datetime({ offset: true }),
  })
  .strict();

export type TenantDeletionJob = z.infer<typeof tenant_deletion_job_schema>;

const tenant_deletion_report_schema = z
  .object({
    schema_version: z.literal("1"), operation: z.literal("delete"),
    tenant_id: z.string().min(1), job_id: z.string().min(1), verified: z.literal(true),
    completed_at_iso: z.string().datetime({ offset: true }),
    steps: z.array(lifecycle_step_receipt_schema).length(6),
    totals: z.object({ scanned: z.number().int().min(0), deleted: z.number().int().min(0),
      skipped: z.number().int().min(0), errors: z.literal(0) }).strict(),
  })
  .strict();

export type TenantDeletionReport = z.infer<typeof tenant_deletion_report_schema>;

type DeletionAction = (input: {
  tenant_id: string;
  job_id: string;
}) => Promise<LifecycleStepResult>;

export interface TenantDeletionPorts {
  readonly receipts: LifecycleReceiptStore;
  readonly legal_holds: { has_active_hold(tenant_id: string): Promise<boolean> };
  readonly tenant: { require_suspended(tenant_id: string): Promise<void> };
  readonly content: { delete_content_artifacts_checkpoints: DeletionAction };
  readonly qdrant: {
    delete_tenant_points(input: {
      tenant_id: string; job_id: string; tenant_filter: { tenant_id: string };
    }): Promise<LifecycleStepResult>;
  };
  readonly object_storage: {
    delete_tenant_prefix(input: {
      tenant_id: string; job_id: string; prefix: string;
    }): Promise<LifecycleStepResult>;
  };
  readonly clerk: { delete_memberships_and_organization: DeletionAction };
  readonly projections: { delete_internal_projections: DeletionAction };
  readonly tombstones: { create_once: DeletionAction };
  readonly now_iso: () => string;
}

/** Create a legal-hold-aware, resumable deletion state machine. */
export function create_tenant_deletion_service(ports: TenantDeletionPorts) {
  return {
    /** Delete one suspended tenant through explicit, receipted phases. */
    async delete_tenant_data(input: TenantDeletionJob): Promise<TenantDeletionReport> {
      const job = tenant_deletion_job_schema.parse(input);
      const existing = await ports.receipts.get_report("delete", job.tenant_id, job.job_id);
      if (existing !== null) return tenant_deletion_report_schema.parse(existing);
      if (await ports.legal_holds.has_active_hold(job.tenant_id)) {
        throw new LegalHoldError(job.tenant_id);
      }
      await ports.tenant.require_suspended(job.tenant_id);
      const action_input = { tenant_id: job.tenant_id, job_id: job.job_id };
      const base = { operation: "delete" as const, job, receipts: ports.receipts, now_iso: ports.now_iso };
      const steps: LifecycleStepReceipt[] = [];
      steps.push(await run_lifecycle_step({ ...base, step: "content_artifacts_checkpoints" }, () =>
        ports.content.delete_content_artifacts_checkpoints(action_input)));
      const qdrant = await run_lifecycle_step({ ...base, step: "qdrant" }, () =>
        ports.qdrant.delete_tenant_points({ ...action_input, tenant_filter: { tenant_id: job.tenant_id } }));
      steps.push(qdrant);
      if (qdrant.metadata.remaining !== 0) {
        throw new Error("Qdrant tenant deletion did not verify zero remaining points");
      }
      steps.push(await run_lifecycle_step({ ...base, step: "object_storage" }, () =>
        ports.object_storage.delete_tenant_prefix({
          ...action_input, prefix: `tenants/${job.tenant_id}/`,
        })));
      steps.push(await run_lifecycle_step({ ...base, step: "clerk" }, () =>
        ports.clerk.delete_memberships_and_organization(action_input)));
      steps.push(await run_lifecycle_step({ ...base, step: "internal_projections" }, () =>
        ports.projections.delete_internal_projections(action_input)));
      steps.push(await run_lifecycle_step({ ...base, step: "tombstone" }, () =>
        ports.tombstones.create_once(action_input)));
      const totals = sum_lifecycle_totals(steps);
      if (totals.errors !== 0) throw new Error("Tenant deletion completed with phase errors");
      const report = tenant_deletion_report_schema.parse({
        schema_version: "1", operation: "delete", tenant_id: job.tenant_id,
        job_id: job.job_id, verified: true, completed_at_iso: ports.now_iso(), steps, totals,
      });
      await ports.receipts.save_report(report as LifecycleReport);
      return report;
    },
  };
}
