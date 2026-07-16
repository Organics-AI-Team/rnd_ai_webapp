import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createClerkClient } from "@clerk/backend";
import client_promise from "@rnd-ai/shared-database";

import { router, platformAdminProcedure, superAdminProcedure } from "../trpc";
import {
  provision_university,
  DuplicateSlugError,
} from "../services/provisioning/provision-university";
import {
  create_production_provisioning_ports,
  type ClerkBackendLike,
} from "../services/provisioning/production-ports";
import { create_university_input_schema } from "../services/provisioning/provisioning-types";
import { create_platform_audit_service } from "../services/audit/platform-audit-service";
import {
  appoint_manager,
  AlreadyTenantMemberError,
} from "../services/provisioning/appoint-manager";
import { MultipleMembershipsDisabledError } from "../services/provisioning/invite-tenant-user";
import { create_production_member_ports } from "../services/provisioning/production-member-ports";

/**
 * Build the Clerk backend client at request time from the private secret.
 *
 * @returns Clerk backend client.
 * @throws TRPCError PRECONDITION_FAILED when the secret is not configured.
 */
function request_clerk_client(): ClerkBackendLike {
  const secret = process.env.CLERK_SECRET_KEY?.trim();
  if (!secret) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Clerk is not configured on this deployment.",
    });
  }
  const clerk = createClerkClient({ secretKey: secret });
  // Explicit adaptation onto the narrow provisioning view so SDK type-surface
  // changes surface here, at one boundary, instead of inside the ports.
  return {
    organizations: {
      createOrganization: (params) =>
        clerk.organizations.createOrganization(params),
      getOrganization: (params) => clerk.organizations.getOrganization(params),
      createOrganizationInvitation: (params) =>
        clerk.organizations.createOrganizationInvitation(params),
      getOrganizationInvitationList: async (params) => {
        const response = await clerk.organizations.getOrganizationInvitationList(
          params as never,
        );
        return {
          data: response.data.map((invitation) => ({
            id: invitation.id,
            emailAddress: invitation.emailAddress,
            role: invitation.role,
            status: String(invitation.status),
          })),
        };
      },
    },
  };
}

/**
 * Platform tenant administration. Every procedure requires a platform role;
 * only super administrators grant platform roles. Responses carry tenant
 * metadata only — never tenant business data.
 */
export const platformTenantsRouter = router({
  /**
   * List tenants with lifecycle metadata for the platform console.
   */
  list: platformAdminProcedure.query(async () => {
    const client = await client_promise;
    const tenants = await client
      .db()
      .collection("tenants")
      .find(
        {},
        {
          projection: {
            slug: 1,
            name: 1,
            status: 1,
            planKey: 1,
            dataResidencyRegion: 1,
            clerkOrganizationId: 1,
            createdAt: 1,
            activatedAt: 1,
          },
        },
      )
      .sort({ createdAt: -1 })
      .toArray();
    return tenants.map((tenant) => ({ ...tenant, _id: tenant._id.toString() }));
  }),

  /**
   * Provision a university idempotently (one Clerk organization, one tenant,
   * one manager invitation per idempotency key).
   */
  create: platformAdminProcedure
    .input(create_university_input_schema)
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      const ports = create_production_provisioning_ports(
        client.db(),
        request_clerk_client(),
      );
      try {
        return await provision_university(ctx.principal, input, ports);
      } catch (error) {
        if (error instanceof DuplicateSlugError) {
          throw new TRPCError({ code: "CONFLICT", message: error.message });
        }
        throw error;
      }
    }),

  /**
   * Appoint a university manager. Platform-only by plan (G1.5): tenant
   * managers can never mint managers — their invite path always passes the
   * user role. Idempotent over pending invitations; single-membership rule
   * enforced before Clerk is called; every appointment is audited.
   */
  appointManager: platformAdminProcedure
    .input(
      z
        .object({
          tenant_id: z.string().min(1),
          email: z.string().email(),
        })
        .strict(),
    )
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      try {
        return await appoint_manager(
          ctx.principal,
          { tenant_id: input.tenant_id ?? "", email: input.email ?? "" },
          create_production_member_ports(client.db()),
        );
      } catch (error) {
        if (
          error instanceof MultipleMembershipsDisabledError ||
          error instanceof AlreadyTenantMemberError
        ) {
          throw new TRPCError({ code: "CONFLICT", message: error.message });
        }
        throw error;
      }
    }),

  /**
   * Grant or clear a platform role. Super administrators only; the change is
   * audited and applies to the database-authoritative UserProfile.
   */
  grantPlatformRole: superAdminProcedure
    .input(
      z
        .object({
          clerk_user_id: z.string().min(1),
          platform_role: z.enum(["super_admin", "admin"]).nullable(),
        })
        .strict(),
    )
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      const db = client.db();
      const result = await db.collection("user_profiles").updateOne(
        { clerkUserId: input.clerk_user_id, status: "active" },
        { $set: { platformRole: input.platform_role, updatedAt: new Date() } },
      );
      if (result.matchedCount === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No active user profile exists for this Clerk user.",
        });
      }
      await create_platform_audit_service(db).record({
        action: "grant_platform_role",
        clerkUserId: input.clerk_user_id,
        platformRole: input.platform_role,
        actorProfileId: ctx.principal.internal_user_id,
        occurred_at: new Date(),
      });
      return { success: true };
    }),
});
