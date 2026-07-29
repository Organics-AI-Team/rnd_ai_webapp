import { z } from "zod";
import { TRPCError } from "@trpc/server";
import client_promise from "@rnd-ai/shared-database";
import type { Permission } from "@rnd-ai/shared-types";

import { router, platformAdminProcedure, superAdminProcedure } from "../trpc";
import { validate_support_request } from "../auth/support-access";
import { create_support_access_repository } from "../repositories/support-access-repository";
import { create_platform_audit_service } from "../services/audit/platform-audit-service";

/**
 * Support-access lifecycle: platform admins request time-boxed diagnostic
 * access; a DIFFERENT super administrator approves; every transition is
 * audited. Grants carry named diagnostic permissions only.
 */
export const platformSupportAccessRouter = router({
  request: platformAdminProcedure
    .input(
      z
        .object({
          tenant_id: z.string().min(1),
          reason: z.string().trim().min(10).max(1000),
          permissions: z.array(z.string()).min(1).max(5),
        })
        .strict(),
    )
    .mutation(async ({ input, ctx }) => {
      const permissions = (input.permissions ?? []) as Permission[];
      try {
        validate_support_request(permissions, 1);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "invalid request",
        });
      }
      const client = await client_promise;
      const db = client.db();
      const grant = await create_support_access_repository(db).create_request({
        tenant_id: input.tenant_id ?? "",
        platform_profile_id: ctx.principal.internal_user_id,
        reason: input.reason ?? "",
        permissions,
      });
      await create_platform_audit_service(db).record({
        action: "support_access_requested",
        grantId: grant._id.toString(),
        tenantId: input.tenant_id,
        actorProfileId: ctx.principal.internal_user_id,
        occurred_at: new Date(),
      });
      return { grant_id: grant._id.toString() };
    }),

  approve: superAdminProcedure
    .input(
      z
        .object({
          grant_id: z.string().min(1),
          duration_hours: z.number().int().positive(),
        })
        .strict(),
    )
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      const db = client.db();
      const repository = create_support_access_repository(db);
      const duration_hours = input.duration_hours ?? 0;
      try {
        validate_support_request(["tenant:ai:read"], duration_hours);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "invalid duration",
        });
      }
      const existing = await db
        .collection("support_access_grants")
        .findOne({ _id: new (await import("mongodb")).ObjectId(input.grant_id ?? "") })
        .catch(() => null);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Grant not found." });
      }
      if (String(existing.platformProfileId) === ctx.principal.internal_user_id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Self-approval of support access is not permitted.",
        });
      }
      const approved = await repository.approve(
        input.grant_id ?? "",
        ctx.principal.internal_user_id,
        duration_hours,
      );
      await create_platform_audit_service(db).record({
        action: "support_access_approved",
        grantId: input.grant_id,
        approverProfileId: ctx.principal.internal_user_id,
        durationHours: duration_hours,
        occurred_at: new Date(),
      });
      return { approved: Boolean(approved?.approvedAt) };
    }),

  revoke: superAdminProcedure
    .input(z.object({ grant_id: z.string().min(1) }).strict())
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      const db = client.db();
      const revoked = await create_support_access_repository(db).revoke(
        input.grant_id ?? "",
      );
      await create_platform_audit_service(db).record({
        action: "support_access_revoked",
        grantId: input.grant_id,
        actorProfileId: ctx.principal.internal_user_id,
        occurred_at: new Date(),
      });
      return { revoked };
    }),
});
