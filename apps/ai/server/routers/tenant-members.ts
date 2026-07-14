import { z } from "zod";
import { ObjectId, type Db } from "mongodb";
import { TRPCError } from "@trpc/server";
import { createClerkClient } from "@clerk/backend";
import client_promise from "@rnd-ai/shared-database";

import { router, tenantProcedure } from "../trpc";
import {
  invite_tenant_user,
  suspend_tenant_user,
  MultipleMembershipsDisabledError,
  type TenantMemberPorts,
} from "../services/provisioning/invite-tenant-user";

/**
 * Build production member-management ports over MongoDB and Clerk.
 *
 * @param db - Connected database handle.
 * @returns Ports for invite/suspend services.
 * @throws TRPCError PRECONDITION_FAILED when Clerk is not configured.
 */
function production_member_ports(db: Db): TenantMemberPorts {
  const secret = process.env.CLERK_SECRET_KEY?.trim();
  if (!secret) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Clerk is not configured on this deployment.",
    });
  }
  const clerk = createClerkClient({ secretKey: secret });

  return {
    memberships: {
      async find_memberships_by_email(email) {
        const profile = await db
          .collection("user_profiles")
          .findOne({ primaryEmail: email });
        if (!profile) return [];
        const memberships = await db
          .collection("tenant_membership_projections")
          .find({ userProfileId: profile._id.toString() })
          .toArray();
        return memberships.map((m) => ({
          tenant_id: String(m.tenantId),
          status: String(m.status),
        }));
      },
      async suspend_membership(tenant_id, user_profile_id) {
        await db.collection("tenant_membership_projections").updateOne(
          { tenantId: tenant_id, userProfileId: user_profile_id },
          { $set: { status: "suspended", updatedAt: new Date() } },
        );
      },
    },
    invitations: {
      async find_invitations_by_email(email) {
        const invitations = await db
          .collection("tenant_invitation_projections")
          .find({ emailNormalized: email })
          .toArray();
        return invitations.map((invitation) => ({
          tenant_id: String(invitation.tenantId),
          status: String(invitation.status),
        }));
      },
      async upsert(tenant_id, invitation, invited_by_profile_id) {
        const now = new Date();
        await db.collection("tenant_invitation_projections").updateOne(
          { clerkInvitationId: invitation.id },
          {
            $setOnInsert: {
              clerkInvitationId: invitation.id,
              tenantId: tenant_id,
              emailNormalized: invitation.email,
              tenantRole: "user",
              status: "invited",
              invitedByProfileId: invited_by_profile_id,
              expiresAt: null,
              clerkSyncedAt: null,
              createdAt: now,
            },
            $set: { updatedAt: now },
          },
          { upsert: true },
        );
      },
    },
    clerk: {
      async create_user_invitation(clerk_organization_id, email) {
        const role =
          process.env.CLERK_ORG_ROLE_MODE === "built_in" ? "org:member" : "org:user";
        const created = await clerk.organizations.createOrganizationInvitation({
          organizationId: clerk_organization_id,
          emailAddress: email,
          role,
        });
        return {
          id: created.id,
          email: created.emailAddress.toLowerCase(),
          role: created.role,
        };
      },
    },
    tenants: {
      async clerk_organization_id_for(tenant_id) {
        if (!ObjectId.isValid(tenant_id)) return null;
        const tenant = await db
          .collection("tenants")
          .findOne({ _id: new ObjectId(tenant_id) });
        return tenant?.clerkOrganizationId ?? null;
      },
    },
    audit: {
      async record(event) {
        await db.collection("platform_audit_events").insertOne({ ...event });
      },
    },
  };
}

/**
 * University member administration. Managers list, invite students, and
 * suspend users; manager appointment is a platform operation and is rejected
 * here by construction (the invite path always passes the user role).
 */
export const tenantMembersRouter = router({
  /**
   * List membership projections for the caller's university.
   */
  list: tenantProcedure("tenant:members:read").query(async ({ ctx }) => {
    const client = await client_promise;
    const db = client.db();
    const memberships = await db
      .collection("tenant_membership_projections")
      .find({ tenantId: ctx.organizationId })
      .sort({ createdAt: -1 })
      .toArray();
    const profile_ids = memberships
      .map((m) => String(m.userProfileId))
      .filter((id) => ObjectId.isValid(id))
      .map((id) => new ObjectId(id));
    const profiles = await db
      .collection("user_profiles")
      .find({ _id: { $in: profile_ids } })
      .project({ primaryEmail: 1, displayName: 1, status: 1 })
      .toArray();
    const profile_map = new Map(profiles.map((p) => [p._id.toString(), p]));
    return memberships.map((membership) => ({
      _id: membership._id.toString(),
      userProfileId: String(membership.userProfileId),
      tenantRole: membership.tenantRole,
      status: membership.status,
      email: profile_map.get(String(membership.userProfileId))?.primaryEmail ?? "",
      displayName:
        profile_map.get(String(membership.userProfileId))?.displayName ?? "",
    }));
  }),

  /**
   * Invite a student into the caller's university (user role only).
   */
  inviteUser: tenantProcedure("tenant:members:invite_user")
    .input(z.object({ email: z.string().email() }).strict())
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      try {
        return await invite_tenant_user(
          ctx.principal,
          { email: input.email ?? "" },
          production_member_ports(client.db()),
        );
      } catch (error) {
        if (error instanceof MultipleMembershipsDisabledError) {
          throw new TRPCError({ code: "CONFLICT", message: error.message });
        }
        throw error;
      }
    }),

  /**
   * Suspend a user's membership in the caller's university.
   */
  suspendUser: tenantProcedure("tenant:members:suspend_user")
    .input(z.object({ user_profile_id: z.string().min(1) }).strict())
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      return suspend_tenant_user(
        ctx.principal,
        { user_profile_id: input.user_profile_id ?? "" },
        production_member_ports(client.db()),
      );
    }),
});
