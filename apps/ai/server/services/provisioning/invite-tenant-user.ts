import { z } from "zod";
import type { RequestPrincipal } from "@rnd-ai/shared-types";

import { require_active_tenant, require_permission } from "../../auth/authorize";
import type { ManagerInvitation } from "./provisioning-types";

/**
 * Raised when an email already holds an active or pending membership at
 * another university. The first commercial release permits exactly one.
 */
export class MultipleMembershipsDisabledError extends Error {
  readonly code = "MULTIPLE_MEMBERSHIPS_DISABLED";

  constructor(email: string) {
    super(
      `MULTIPLE_MEMBERSHIPS_DISABLED: ${email} already belongs to another university.`,
    );
    this.name = "MultipleMembershipsDisabledError";
  }
}

const invite_input_schema = z
  .object({ email: z.string().trim().toLowerCase().email() })
  .strict();

const suspend_input_schema = z
  .object({ user_profile_id: z.string().min(1) })
  .strict();

/** Ports for tenant member management; fakes in tests, MongoDB/Clerk in production. */
export interface TenantMemberPorts {
  readonly memberships: {
    find_memberships_by_email(
      email: string,
    ): Promise<Array<{ tenant_id: string; status: string }>>;
    suspend_membership(tenant_id: string, user_profile_id: string): Promise<void>;
  };
  readonly invitations: {
    find_invitations_by_email(
      email: string,
    ): Promise<Array<{ tenant_id: string; status: string }>>;
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
  };
  readonly tenants: {
    clerk_organization_id_for(tenant_id: string): Promise<string | null>;
  };
  readonly audit: {
    record(event: Record<string, unknown> & { action: string }): Promise<void>;
  };
}

/**
 * Invite a student (tenant user) into the manager's university. Managers can
 * only ever grant the user role through this path — manager appointments are
 * a platform operation. The single-membership rule is enforced before Clerk
 * is called.
 *
 * @param actor - Verified tenant principal (requires tenant:members:invite_user).
 * @param raw_input - Invitation input ({ email }).
 * @param ports - Member-management ports.
 * @returns Created invitation ID.
 * @throws AuthorizationError or MultipleMembershipsDisabledError.
 */
export async function invite_tenant_user(
  actor: RequestPrincipal,
  raw_input: { email: string },
  ports: TenantMemberPorts,
): Promise<{ invitation_id: string }> {
  require_active_tenant(actor);
  require_permission(actor, "tenant:members:invite_user");
  const input = invite_input_schema.parse(raw_input);
  const tenant_id = actor.active_tenant_id as string;

  const [memberships, invitations] = await Promise.all([
    ports.memberships.find_memberships_by_email(input.email),
    ports.invitations.find_invitations_by_email(input.email),
  ]);
  const blocking = [...memberships, ...invitations].some(
    (record) =>
      record.tenant_id !== tenant_id &&
      (record.status === "active" || record.status === "invited"),
  );
  if (blocking) {
    throw new MultipleMembershipsDisabledError(input.email);
  }

  const clerk_organization_id =
    await ports.tenants.clerk_organization_id_for(tenant_id);
  if (!clerk_organization_id) {
    throw new Error("The tenant has no Clerk organization; provisioning is incomplete.");
  }

  // The user role is always passed to Clerk; this path can never mint a manager.
  const invitation = await ports.clerk.create_user_invitation(
    clerk_organization_id,
    input.email,
  );
  await ports.invitations.upsert(tenant_id, invitation, actor.internal_user_id);
  await ports.audit.record({
    action: "invite_tenant_user",
    tenantId: tenant_id,
    emailNormalized: input.email,
    actorProfileId: actor.internal_user_id,
    occurred_at: new Date(),
  });
  return { invitation_id: invitation.id };
}

/**
 * Suspend a tenant user's membership in the manager's university. The
 * projection is suspended immediately; Clerk-side revocation is reconciled
 * by webhooks/reconcile-clerk.
 *
 * @param actor - Verified tenant principal (requires tenant:members:suspend_user).
 * @param raw_input - Suspension input ({ user_profile_id }).
 * @param ports - Member-management ports.
 */
export async function suspend_tenant_user(
  actor: RequestPrincipal,
  raw_input: { user_profile_id: string },
  ports: TenantMemberPorts,
): Promise<{ success: true }> {
  require_active_tenant(actor);
  require_permission(actor, "tenant:members:suspend_user");
  const input = suspend_input_schema.parse(raw_input);
  const tenant_id = actor.active_tenant_id as string;

  await ports.memberships.suspend_membership(tenant_id, input.user_profile_id);
  await ports.audit.record({
    action: "suspend_tenant_user",
    tenantId: tenant_id,
    userProfileId: input.user_profile_id,
    actorProfileId: actor.internal_user_id,
    occurred_at: new Date(),
  });
  return { success: true };
}
