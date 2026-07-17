import { ObjectId, type Db } from "mongodb";
import { TRPCError } from "@trpc/server";
import { createClerkClient } from "@clerk/backend";

import { manager_clerk_role } from "./production-ports";
import type { TenantMemberPorts } from "./invite-tenant-user";
import type { AppointManagerPorts } from "./appoint-manager";
import type { ManagerInvitation } from "./provisioning-types";

/**
 * Invitation redirect target: invited users land on our onboarding page,
 * not Clerk's default hosted page. Undefined when the app origin is not
 * configured (Clerk then uses its instance default).
 *
 * @returns Absolute onboarding URL, or undefined without NEXT_PUBLIC_APP_URL.
 */
function invitation_redirect_url(): string | undefined {
  return process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/onboarding`
    : undefined;
}

/**
 * Map a Clerk invitation role onto the internal projection role. Manager
 * roles differ by CLERK_ORG_ROLE_MODE (org:manager custom, org:admin
 * built-in); everything else projects as a tenant user.
 *
 * @param clerk_role - Role string returned by Clerk for the invitation.
 * @returns Internal tenant role for the invitation projection.
 */
function projection_role(clerk_role: string): "manager" | "user" {
  return clerk_role === "org:manager" || clerk_role === "org:admin"
    ? "manager"
    : "user";
}

/**
 * Build production member-management ports over MongoDB and Clerk. Shared by
 * the tenant members router (invite/suspend) and the platform tenants router
 * (manager appointment) so both paths project invitations identically.
 *
 * @param db - Connected database handle.
 * @returns Ports satisfying both member management and manager appointment.
 * @throws TRPCError PRECONDITION_FAILED when Clerk is not configured.
 */
export function create_production_member_ports(
  db: Db,
): TenantMemberPorts & AppointManagerPorts {
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
              tenantRole: projection_role(invitation.role),
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
          redirectUrl: invitation_redirect_url(),
        });
        return {
          id: created.id,
          email: created.emailAddress.toLowerCase(),
          role: created.role,
        };
      },
      async create_manager_invitation(
        clerk_organization_id,
        email,
      ): Promise<ManagerInvitation> {
        // Idempotent over pending invitations: replaying an appointment
        // returns the existing pending invitation instead of minting another.
        const pending = await clerk.organizations.getOrganizationInvitationList(
          { organizationId: clerk_organization_id, status: ["pending"] } as never,
        );
        const existing = pending.data.find(
          (invitation) => invitation.emailAddress.toLowerCase() === email,
        );
        if (existing) {
          return {
            id: existing.id,
            email: existing.emailAddress.toLowerCase(),
            role: String(existing.role),
          };
        }
        const created = await clerk.organizations.createOrganizationInvitation({
          organizationId: clerk_organization_id,
          emailAddress: email,
          role: manager_clerk_role(),
          redirectUrl: invitation_redirect_url(),
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
        // TODO(G2.6): move into a tenant repository
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
