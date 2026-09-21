// apps/ai/server/services/provisioning/member-admin-ports.ts
import type { ClientSession } from "mongodb";

import type { ManagerInvitation } from "./provisioning-types";

/**
 * Member-administration contracts (Plan 3).
 *
 * One port surface shared by the tenant member lifecycle
 * (suspend/reactivate/remove), invitation management (revoke/resend), and
 * the platform manager lifecycle (demote). Fakes implement it in tests;
 * create_production_member_admin_ports implements it over MongoDB + Clerk.
 */

/** Membership projection view consumed by member-admin services. */
export interface MembershipView {
  readonly tenant_role: "manager" | "user";
  readonly status: "active" | "suspended" | "revoked";
}

/** Invitation projection view consumed by invitation services. */
export interface InvitationView {
  readonly clerk_invitation_id: string;
  readonly email: string;
  readonly tenant_role: "manager" | "user";
  readonly status: string;
  readonly created_at: Date;
}

/** Raised when the target membership/profile does not exist in this tenant. */
export class MemberNotFoundError extends Error {
  readonly code = "MEMBER_NOT_FOUND";

  constructor(user_profile_id: string) {
    super(
      `MEMBER_NOT_FOUND: no membership for profile ${user_profile_id} in this university.`,
    );
    this.name = "MemberNotFoundError";
  }
}

/** Raised when a tenant manager targets a manager; manager lifecycle is platform-scope. */
export class ManagerActionForbiddenError extends Error {
  readonly code = "MANAGER_ACTION_FORBIDDEN";

  constructor() {
    super(
      "MANAGER_ACTION_FORBIDDEN: tenant managers act on users only; manager lifecycle is a platform operation.",
    );
    this.name = "ManagerActionForbiddenError";
  }
}

/** Raised when reactivation targets a membership whose user profile is not active. */
export class ProfileInactiveError extends Error {
  readonly code = "PROFILE_INACTIVE";

  constructor(user_profile_id: string, profile_status: string) {
    super(
      `PROFILE_INACTIVE: profile ${user_profile_id} is ${profile_status}; the profile must be active before its membership can be reactivated.`,
    );
    this.name = "ProfileInactiveError";
  }
}

/** Raised when a mutation would leave the tenant without an active manager. */
export class LastManagerError extends Error {
  readonly code = "LAST_MANAGER";

  constructor(tenant_id: string) {
    super(
      `LAST_MANAGER: tenant ${tenant_id} must retain at least one active manager.`,
    );
    this.name = "LastManagerError";
  }
}

/** Raised when the invitation does not exist in this tenant. */
export class InvitationNotFoundError extends Error {
  readonly code = "INVITATION_NOT_FOUND";

  constructor(clerk_invitation_id: string) {
    super(
      `INVITATION_NOT_FOUND: no invitation ${clerk_invitation_id} exists in this university.`,
    );
    this.name = "InvitationNotFoundError";
  }
}

/** Raised when revoke/resend targets an invitation that is not pending. */
export class InvitationNotPendingError extends Error {
  readonly code = "INVITATION_NOT_PENDING";

  constructor(clerk_invitation_id: string, status: string) {
    super(
      `INVITATION_NOT_PENDING: invitation ${clerk_invitation_id} is ${status}; only pending invitations can be revoked or resent.`,
    );
    this.name = "InvitationNotPendingError";
  }
}

/** Raised when Clerk rejects an invitation because one is already pending. */
export class DuplicatePendingInvitationError extends Error {
  readonly code = "DUPLICATE_PENDING_INVITATION";

  constructor(email: string) {
    super(
      `DUPLICATE_PENDING_INVITATION: ${email} already has a pending invitation for this university.`,
    );
    this.name = "DuplicatePendingInvitationError";
  }
}

/** Ports for member administration; fakes in tests, MongoDB/Clerk in production. */
export interface MemberAdminPorts {
  readonly memberships: {
    find_membership(
      tenant_id: string,
      user_profile_id: string,
      session?: ClientSession,
    ): Promise<MembershipView | null>;
    set_membership_status(
      tenant_id: string,
      user_profile_id: string,
      status: MembershipView["status"],
      session?: ClientSession,
    ): Promise<void>;
    set_membership_role(
      tenant_id: string,
      user_profile_id: string,
      role: MembershipView["tenant_role"],
      session?: ClientSession,
    ): Promise<void>;
    count_active_managers(tenant_id: string, session?: ClientSession): Promise<number>;
    /**
     * Write-conflict guard for the last-manager invariant: touch the tenant
     * document inside the transaction so two racing demotions conflict on
     * the same document instead of committing snapshot write-skew.
     */
    touch_tenant_for_invariant(tenant_id: string, session?: ClientSession): Promise<void>;
  };
  readonly profiles: {
    find_profile_status(user_profile_id: string): Promise<string | null>;
  };
  readonly invitations: {
    find_by_clerk_id(
      tenant_id: string,
      clerk_invitation_id: string,
    ): Promise<InvitationView | null>;
    mark_status(
      tenant_id: string,
      clerk_invitation_id: string,
      status: "invited" | "revoked",
    ): Promise<void>;
    upsert(
      tenant_id: string,
      invitation: ManagerInvitation,
      invited_by_profile_id: string,
    ): Promise<void>;
  };
  readonly clerk: {
    create_user_invitation(
      clerk_organization_id: string,
      email: string,
    ): Promise<ManagerInvitation>;
    revoke_invitation(tenant_id: string, clerk_invitation_id: string): Promise<void>;
    remove_membership(tenant_id: string, user_profile_id: string): Promise<void>;
    update_membership_role(
      tenant_id: string,
      user_profile_id: string,
      role: MembershipView["tenant_role"],
    ): Promise<void>;
  };
  readonly tenants: {
    clerk_organization_id_for(tenant_id: string): Promise<string | null>;
  };
  readonly transactions: {
    run<T>(operation: (session: ClientSession | undefined) => Promise<T>): Promise<T>;
  };
  readonly audit: {
    record(event: Record<string, unknown> & { action: string }): Promise<void>;
  };
}
