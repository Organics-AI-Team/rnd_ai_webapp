// apps/ai/server/services/provisioning/production-member-ports.ts
import { ObjectId, type ClientSession, type Db } from "mongodb";
import { TRPCError } from "@trpc/server";
import { createClerkClient } from "@clerk/backend";

import { manager_clerk_role, user_clerk_role } from "./production-ports";
import type { TenantMemberPorts } from "./invite-tenant-user";
import type { AppointManagerPorts } from "./appoint-manager";
import type { ManagerInvitation } from "./provisioning-types";
import {
  DuplicatePendingInvitationError,
  MemberNotFoundError,
  type MemberAdminPorts,
  type MembershipView,
} from "./member-admin-ports";

/**
 * Narrow Clerk backend surface used by member administration. Injectable in
 * tests; the default adapter wraps the real client (explicit adaptation, one
 * boundary — same pattern as platform-tenants.ts request_clerk_client).
 */
export interface MemberAdminClerkLike {
  organizations: {
    createOrganizationInvitation(params: {
      organizationId: string;
      emailAddress: string;
      role: string;
      redirectUrl?: string;
    }): Promise<{ id: string; emailAddress: string; role: string }>;
    getOrganizationInvitationList(params: {
      organizationId: string;
      status?: string[];
    }): Promise<{
      data: Array<{ id: string; emailAddress: string; role: string; status: string }>;
    }>;
    revokeOrganizationInvitation(params: {
      organizationId: string;
      invitationId: string;
    }): Promise<unknown>;
    updateOrganizationMembership(params: {
      organizationId: string;
      userId: string;
      role: string;
    }): Promise<unknown>;
    deleteOrganizationMembership(params: {
      organizationId: string;
      userId: string;
    }): Promise<unknown>;
  };
}

/**
 * Build the default Clerk backend adapter from the private secret.
 *
 * @returns Narrow Clerk view over the real backend client.
 * @throws TRPCError PRECONDITION_FAILED when Clerk is not configured.
 */
function default_clerk_backend(): MemberAdminClerkLike {
  const secret = process.env.CLERK_SECRET_KEY?.trim();
  if (!secret) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Clerk is not configured on this deployment.",
    });
  }
  const clerk = createClerkClient({ secretKey: secret });
  return {
    organizations: {
      createOrganizationInvitation: (params) =>
        clerk.organizations.createOrganizationInvitation(params),
      getOrganizationInvitationList: async (params) => {
        const response = await clerk.organizations.getOrganizationInvitationList({
          organizationId: params.organizationId,
          status: params.status as never,
        });
        return {
          data: response.data.map((invitation) => ({
            id: invitation.id,
            emailAddress: invitation.emailAddress,
            role: String(invitation.role),
            status: String(invitation.status),
          })),
        };
      },
      revokeOrganizationInvitation: (params) =>
        clerk.organizations.revokeOrganizationInvitation(params),
      updateOrganizationMembership: (params) =>
        clerk.organizations.updateOrganizationMembership(params),
      deleteOrganizationMembership: (params) =>
        clerk.organizations.deleteOrganizationMembership(params),
    },
  };
}

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
 * Narrow a stored projection status onto the typed membership view.
 *
 * @param value - Raw status value from the projection document.
 * @returns Typed status (unknown labels degrade to "active" — the stored
 *          vocabulary is exactly these three).
 */
function membership_status_of(value: unknown): MembershipView["status"] {
  return value === "suspended" || value === "revoked" ? value : "active";
}

/**
 * Resolve the Clerk organization id for a tenant or fail loudly.
 *
 * @param db - Database handle.
 * @param tenant_id - Internal tenant id.
 * @returns Clerk organization id.
 * @throws Error when the tenant has no Clerk organization.
 */
async function required_clerk_org_id(db: Db, tenant_id: string): Promise<string> {
  if (!ObjectId.isValid(tenant_id)) {
    throw new Error("The tenant has no Clerk organization; provisioning is incomplete.");
  }
  const tenant = await db
    .collection("tenants")
    .findOne({ _id: new ObjectId(tenant_id) });
  if (!tenant?.clerkOrganizationId) {
    throw new Error("The tenant has no Clerk organization; provisioning is incomplete.");
  }
  return String(tenant.clerkOrganizationId);
}

/**
 * Resolve the Clerk user id for an internal profile.
 *
 * @param db - Database handle.
 * @param user_profile_id - Internal profile id.
 * @returns Clerk user id.
 * @throws MemberNotFoundError when the profile has no Clerk identity.
 */
async function required_clerk_user_id(db: Db, user_profile_id: string): Promise<string> {
  if (!ObjectId.isValid(user_profile_id)) {
    throw new MemberNotFoundError(user_profile_id);
  }
  const profile = await db
    .collection("user_profiles")
    .findOne({ _id: new ObjectId(user_profile_id) }, { projection: { clerkUserId: 1 } });
  if (!profile?.clerkUserId) {
    throw new MemberNotFoundError(user_profile_id);
  }
  return String(profile.clerkUserId);
}

/**
 * Translate Clerk's duplicate-pending-invitation rejection into the typed
 * domain error; any other failure is returned untouched for rethrow.
 *
 * @param error - Error thrown by createOrganizationInvitation.
 * @param email - Invited email, for the human-readable message.
 * @returns The typed duplicate error, or the original error.
 */
function translate_duplicate_invitation_error(error: unknown, email: string): unknown {
  const clerk_error = error as { errors?: Array<{ code?: string }> } | null;
  const duplicate = clerk_error?.errors?.some(
    (entry) => typeof entry?.code === "string" && entry.code.includes("duplicate"),
  );
  return duplicate ? new DuplicatePendingInvitationError(email) : error;
}

/**
 * Build production member-management ports over MongoDB and Clerk. Shared by
 * the tenant members router (invite/suspend) and the platform tenants router
 * (manager appointment) so both paths project invitations identically.
 *
 * @param db - Connected database handle.
 * @param clerk_like - Narrow Clerk view; injected in tests, real otherwise.
 * @returns Ports satisfying both member management and manager appointment.
 * @throws TRPCError PRECONDITION_FAILED when Clerk is not configured and no
 *         clerk_like override is provided.
 */
export function create_production_member_ports(
  db: Db,
  clerk_like?: MemberAdminClerkLike,
): TenantMemberPorts & AppointManagerPorts {
  const clerk = clerk_like ?? default_clerk_backend();

  return {
    invitations: {
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
        try {
          const created = await clerk.organizations.createOrganizationInvitation({
            organizationId: clerk_organization_id,
            emailAddress: email,
            role: user_clerk_role(),
            redirectUrl: invitation_redirect_url(),
          });
          return {
            id: created.id,
            email: created.emailAddress.toLowerCase(),
            role: created.role,
          };
        } catch (error) {
          throw translate_duplicate_invitation_error(error, email);
        }
      },
      async create_manager_invitation(
        clerk_organization_id,
        email,
      ): Promise<ManagerInvitation> {
        // Idempotent over pending invitations: replaying an appointment
        // returns the existing pending invitation instead of minting another.
        const pending = await clerk.organizations.getOrganizationInvitationList({
          organizationId: clerk_organization_id,
          status: ["pending"],
        });
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

/**
 * Build production member-administration ports (Plan 3) over MongoDB + Clerk.
 * Reuses the base member ports for the shared invitation/tenant/audit
 * surfaces; adds membership lifecycle writes, invitation lookups, Clerk
 * membership administration, and a Mongo-transaction runner (pattern:
 * ai-rollout-repository in_transaction).
 *
 * @param db - Connected database handle.
 * @param clerk_like - Narrow Clerk view; injected in tests, real otherwise.
 * @returns Ports satisfying MemberAdminPorts.
 * @throws TRPCError PRECONDITION_FAILED when Clerk is not configured and no
 *         clerk_like override is provided.
 */
export function create_production_member_admin_ports(
  db: Db,
  clerk_like?: MemberAdminClerkLike,
): MemberAdminPorts {
  const clerk = clerk_like ?? default_clerk_backend();
  const base = create_production_member_ports(db, clerk);
  const memberships = db.collection("tenant_membership_projections");

  return {
    memberships: {
      async find_membership(tenant_id, user_profile_id, session) {
        const membership = await memberships.findOne(
          { tenantId: tenant_id, userProfileId: user_profile_id },
          { session },
        );
        if (!membership) return null;
        return {
          tenant_role: membership.tenantRole === "manager" ? "manager" : "user",
          status: membership_status_of(membership.status),
        };
      },
      async set_membership_status(tenant_id, user_profile_id, status, session) {
        console.info({
          boundary: "member-admin-ports",
          event: "membership.status.set",
          tenant_id,
          user_profile_id,
          status,
        });
        await memberships.updateOne(
          { tenantId: tenant_id, userProfileId: user_profile_id },
          { $set: { status, updatedAt: new Date() } },
          { session },
        );
      },
      async set_membership_role(tenant_id, user_profile_id, role, session) {
        console.info({
          boundary: "member-admin-ports",
          event: "membership.role.set",
          tenant_id,
          user_profile_id,
          role,
        });
        await memberships.updateOne(
          { tenantId: tenant_id, userProfileId: user_profile_id },
          { $set: { tenantRole: role, updatedAt: new Date() } },
          { session },
        );
      },
      async count_active_managers(tenant_id, session) {
        return memberships.countDocuments(
          { tenantId: tenant_id, tenantRole: "manager", status: "active" },
          { session },
        );
      },
      async touch_tenant_for_invariant(tenant_id, session) {
        if (!ObjectId.isValid(tenant_id)) return;
        // Both of two racing last-manager transactions write this same
        // tenant document, forcing a Mongo write conflict so one aborts and
        // retries instead of both committing snapshot write-skew.
        await db.collection("tenants").updateOne(
          { _id: new ObjectId(tenant_id) },
          { $set: { managerInvariantCheckedAt: new Date() } },
          { session },
        );
      },
    },
    profiles: {
      async find_profile_status(user_profile_id) {
        if (!ObjectId.isValid(user_profile_id)) return null;
        const profile = await db
          .collection("user_profiles")
          .findOne(
            { _id: new ObjectId(user_profile_id) },
            { projection: { status: 1 } },
          );
        return profile ? String(profile.status) : null;
      },
    },
    invitations: {
      async find_by_clerk_id(tenant_id, clerk_invitation_id) {
        const invitation = await db
          .collection("tenant_invitation_projections")
          .findOne({ tenantId: tenant_id, clerkInvitationId: clerk_invitation_id });
        if (!invitation) return null;
        return {
          clerk_invitation_id: String(invitation.clerkInvitationId),
          email: String(invitation.emailNormalized),
          tenant_role: invitation.tenantRole === "manager" ? "manager" : "user",
          status: String(invitation.status),
          created_at:
            invitation.createdAt instanceof Date ? invitation.createdAt : new Date(0),
        };
      },
      async mark_status(tenant_id, clerk_invitation_id, status) {
        await db.collection("tenant_invitation_projections").updateOne(
          { tenantId: tenant_id, clerkInvitationId: clerk_invitation_id },
          { $set: { status, updatedAt: new Date() } },
        );
      },
      upsert: base.invitations.upsert,
    },
    clerk: {
      create_user_invitation: base.clerk.create_user_invitation,
      async revoke_invitation(tenant_id, clerk_invitation_id) {
        const organization_id = await required_clerk_org_id(db, tenant_id);
        try {
          await clerk.organizations.revokeOrganizationInvitation({
            organizationId: organization_id,
            invitationId: clerk_invitation_id,
          });
        } catch (error) {
          const status = (error as { status?: number } | null)?.status;
          if (typeof status === "number" && status >= 400 && status < 500) {
            // Already revoked/expired on Clerk's side; projection revocation
            // is the goal, so a 4xx is tolerated as success.
            console.warn({
              boundary: "member-admin-ports",
              event: "invitation.revoke.tolerated",
              clerk_invitation_id,
              status,
            });
            return;
          }
          throw error;
        }
      },
      async remove_membership(tenant_id, user_profile_id) {
        const organization_id = await required_clerk_org_id(db, tenant_id);
        const user_id = await required_clerk_user_id(db, user_profile_id);
        console.info({
          boundary: "member-admin-ports",
          event: "membership.remove.clerk",
          tenant_id,
          user_profile_id,
        });
        await clerk.organizations.deleteOrganizationMembership({
          organizationId: organization_id,
          userId: user_id,
        });
      },
      async update_membership_role(tenant_id, user_profile_id, role) {
        const organization_id = await required_clerk_org_id(db, tenant_id);
        const user_id = await required_clerk_user_id(db, user_profile_id);
        console.info({
          boundary: "member-admin-ports",
          event: "membership.role.clerk",
          tenant_id,
          user_profile_id,
          role,
        });
        await clerk.organizations.updateOrganizationMembership({
          organizationId: organization_id,
          userId: user_id,
          role: role === "manager" ? manager_clerk_role() : user_clerk_role(),
        });
      },
    },
    tenants: base.tenants,
    transactions: {
      async run<T>(
        operation: (session: ClientSession | undefined) => Promise<T>,
      ): Promise<T> {
        // Mirrors ai-rollout-repository's in_transaction: one session per
        // call, always ended; withTransaction retries transient aborts.
        const session = db.client.startSession();
        try {
          let value: T | undefined;
          await session.withTransaction(async () => {
            value = await operation(session);
          });
          return value as T;
        } finally {
          await session.endSession();
        }
      },
    },
    audit: base.audit,
  };
}
