/** Super-admin-only tenant lifecycle router assembled over injected operations. */
import { z } from "zod";
import { router, superAdminProcedure } from "../trpc";
import type { TenantExportJob } from "../services/data-governance/tenant-export";
import type { TenantSuspensionJob } from "../services/data-governance/tenant-suspension";
import type { TenantDeletionJob } from "../services/data-governance/tenant-deletion";
import type { RetentionJob } from "../services/data-governance/retention-job";

export interface PlatformDataGovernanceOperations {
  readonly export_tenant_data: (job: TenantExportJob) => Promise<unknown>;
  readonly suspend_tenant: (job: TenantSuspensionJob) => Promise<unknown>;
  readonly delete_tenant_data: (job: TenantDeletionJob) => Promise<unknown>;
  readonly apply_retention: (job: RetentionJob) => Promise<unknown>;
}

const job_identity_input = {
  job_id: z.string().min(1).max(128),
  tenant_id: z.string().min(1).max(128),
};

/**
 * Create the independently testable platform data-governance router.
 *
 * Every procedure requires a database-authoritative super-admin principal;
 * actor identity and request time come only from server context/dependencies.
 *
 * @param operations - Injected lifecycle services.
 * @param now_iso - Server clock used for job receipt timestamps.
 * @returns tRPC router ready for central registration.
 */
export function create_platform_data_governance_router(
  operations: PlatformDataGovernanceOperations,
  now_iso: () => string,
) {
  return router({
    exportTenant: superAdminProcedure
      .input(z.object({
        ...job_identity_input,
        expires_at_iso: z.string().datetime({ offset: true }),
      }).strict())
      .mutation(({ input, ctx }) => operations.export_tenant_data({
        ...input,
        requested_by_profile_id: ctx.principal.internal_user_id,
        requested_at_iso: now_iso(),
      })),
    suspendTenant: superAdminProcedure
      .input(z.object({
        ...job_identity_input,
        reason: z.string().trim().min(10).max(1_000),
      }).strict())
      .mutation(({ input, ctx }) => operations.suspend_tenant({
        ...input,
        requested_by_profile_id: ctx.principal.internal_user_id,
        requested_at_iso: now_iso(),
      })),
    deleteTenant: superAdminProcedure
      .input(z.object(job_identity_input).strict())
      .mutation(({ input, ctx }) => operations.delete_tenant_data({
        ...input,
        requested_by_profile_id: ctx.principal.internal_user_id,
        requested_at_iso: now_iso(),
      })),
    applyRetention: superAdminProcedure
      .input(z.object({
        ...job_identity_input,
        as_of_iso: z.string().datetime({ offset: true }),
        platform_retention_days: z.number().int().min(1).max(3_650),
        tenant_retention_days: z.number().int().min(1).max(3_650),
      }).strict())
      .mutation(({ input, ctx }) => operations.apply_retention({
        ...input,
        requested_by_profile_id: ctx.principal.internal_user_id,
        requested_at_iso: now_iso(),
      })),
  });
}
