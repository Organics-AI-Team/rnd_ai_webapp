/**
 * Shared in-memory MemberAdminPorts fake + principal fixtures for the Plan 3
 * member-admin service tests (Tasks 4-6). Created in Task 4; read-only for
 * later tasks.
 */
import type {
  InvitationView,
  MemberAdminPorts,
  MembershipView,
} from "../../../apps/ai/server/services/provisioning/member-admin-ports";
import type { ManagerInvitation } from "../../../apps/ai/server/services/provisioning/provisioning-types";
import { TENANT_ROLE_PERMISSIONS } from "../../../packages/shared-types/src/auth";
import type { RequestPrincipal } from "../../../packages/shared-types/src/auth";

export const TENANT = "507f1f77bcf86cd799439031";
export const OTHER_TENANT = "507f1f77bcf86cd799439099";

/** Tenant manager principal fixture for TENANT. */
export const manager_principal: RequestPrincipal = {
  auth_provider: "clerk",
  provider_user_id: "user_mgr",
  internal_user_id: "507f1f77bcf86cd799439001",
  active_tenant_id: TENANT,
  platform_role: null,
  tenant_role: "manager",
  permissions: TENANT_ROLE_PERMISSIONS.manager,
  membership_status: "active",
};

/** Tenant user (student) principal fixture for TENANT. */
export const student_principal: RequestPrincipal = {
  ...manager_principal,
  provider_user_id: "user_student",
  internal_user_id: "507f1f77bcf86cd799439002",
  tenant_role: "user",
  permissions: TENANT_ROLE_PERMISSIONS.user,
};

/** Platform admin principal fixture (no tenant context). */
export const platform_admin_principal: RequestPrincipal = {
  auth_provider: "clerk",
  provider_user_id: "user_platform",
  internal_user_id: "507f1f77bcf86cd799439003",
  active_tenant_id: null,
  platform_role: "admin",
  tenant_role: null,
  permissions: [],
  membership_status: null,
};

/** Mutable world exposed alongside the fake ports. */
export interface FakeMemberAdminWorld {
  ports: MemberAdminPorts;
  memberships: Map<string, { tenant_role: MembershipView["tenant_role"]; status: MembershipView["status"] }>;
  profiles: Map<string, string>;
  invitations: Map<string, InvitationView & { tenant_id: string }>;
  clerk_calls: Array<{ method: string; args: unknown[] }>;
  audit_events: Array<Record<string, unknown> & { action: string }>;
  upserted_invitations: Array<{
    tenant_id: string;
    invitation: ManagerInvitation;
    invited_by_profile_id: string;
  }>;
  fail_clerk: {
    remove_membership?: boolean;
    update_membership_role?: boolean;
    revoke_invitation?: boolean;
  };
}

/**
 * Membership map key mirroring the production (tenantId, userProfileId) keying.
 *
 * @param tenant_id - Internal tenant id.
 * @param user_profile_id - Internal profile id.
 * @returns Composite map key.
 */
export function membership_key(tenant_id: string, user_profile_id: string): string {
  return `${tenant_id}:${user_profile_id}`;
}

/**
 * Build the in-memory member-admin world.
 *
 * @returns Fake ports plus every observable side-effect store.
 */
export function fake_member_admin_world(): FakeMemberAdminWorld {
  const memberships: FakeMemberAdminWorld["memberships"] = new Map();
  const profiles = new Map<string, string>();
  const invitations: FakeMemberAdminWorld["invitations"] = new Map();
  const clerk_calls: FakeMemberAdminWorld["clerk_calls"] = [];
  const audit_events: FakeMemberAdminWorld["audit_events"] = [];
  const upserted_invitations: FakeMemberAdminWorld["upserted_invitations"] = [];
  const fail_clerk: FakeMemberAdminWorld["fail_clerk"] = {};
  let invitation_sequence = 0;

  const ports: MemberAdminPorts = {
    memberships: {
      async find_membership(tenant_id, user_profile_id) {
        return memberships.get(membership_key(tenant_id, user_profile_id)) ?? null;
      },
      async set_membership_status(tenant_id, user_profile_id, status) {
        const key = membership_key(tenant_id, user_profile_id);
        const existing = memberships.get(key);
        if (existing) memberships.set(key, { ...existing, status });
      },
      async set_membership_role(tenant_id, user_profile_id, role) {
        const key = membership_key(tenant_id, user_profile_id);
        const existing = memberships.get(key);
        if (existing) memberships.set(key, { ...existing, tenant_role: role });
      },
      async count_active_managers(tenant_id) {
        return [...memberships.entries()].filter(
          ([key, value]) =>
            key.startsWith(`${tenant_id}:`) &&
            value.tenant_role === "manager" &&
            value.status === "active",
        ).length;
      },
      async touch_tenant_for_invariant() {},
    },
    profiles: {
      async find_profile_status(user_profile_id) {
        return profiles.get(user_profile_id) ?? null;
      },
    },
    invitations: {
      async find_by_clerk_id(tenant_id, clerk_invitation_id) {
        const invitation = invitations.get(clerk_invitation_id);
        return invitation && invitation.tenant_id === tenant_id ? invitation : null;
      },
      async mark_status(tenant_id, clerk_invitation_id, status) {
        const invitation = invitations.get(clerk_invitation_id);
        if (invitation && invitation.tenant_id === tenant_id) {
          invitations.set(clerk_invitation_id, { ...invitation, status });
        }
      },
      async upsert(tenant_id, invitation, invited_by_profile_id) {
        upserted_invitations.push({ tenant_id, invitation, invited_by_profile_id });
      },
    },
    clerk: {
      async create_user_invitation(clerk_organization_id, email) {
        clerk_calls.push({
          method: "create_user_invitation",
          args: [clerk_organization_id, email],
        });
        invitation_sequence += 1;
        return { id: `inv_new_${invitation_sequence}`, email, role: "org:user" };
      },
      async revoke_invitation(tenant_id, clerk_invitation_id) {
        if (fail_clerk.revoke_invitation) throw new Error("clerk revoke failed");
        clerk_calls.push({
          method: "revoke_invitation",
          args: [tenant_id, clerk_invitation_id],
        });
      },
      async remove_membership(tenant_id, user_profile_id) {
        if (fail_clerk.remove_membership) throw new Error("clerk remove failed");
        clerk_calls.push({
          method: "remove_membership",
          args: [tenant_id, user_profile_id],
        });
      },
      async update_membership_role(tenant_id, user_profile_id, role) {
        if (fail_clerk.update_membership_role) {
          throw new Error("clerk role update failed");
        }
        clerk_calls.push({
          method: "update_membership_role",
          args: [tenant_id, user_profile_id, role],
        });
      },
    },
    tenants: {
      async clerk_organization_id_for(tenant_id) {
        return `org_for_${tenant_id}`;
      },
    },
    transactions: {
      async run(operation) {
        return operation(undefined);
      },
    },
    audit: {
      async record(event) {
        audit_events.push(event);
      },
    },
  };

  return {
    ports,
    memberships,
    profiles,
    invitations,
    clerk_calls,
    audit_events,
    upserted_invitations,
    fail_clerk,
  };
}
