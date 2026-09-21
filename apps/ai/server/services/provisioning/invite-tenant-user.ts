// apps/ai/server/services/provisioning/invite-tenant-user.ts
import { z } from "zod";
import type { RequestPrincipal } from "@rnd-ai/shared-types";

import { require_active_tenant, require_permission } from "../../auth/authorize";
import type { ManagerInvitation } from "./provisioning-types";

const invite_input_schema = z
  .object({ email: z.string().trim().toLowerCase().email() })
  .strict();

/** Ports for the tenant invite path; fakes in tests, MongoDB/Clerk in production. */
export interface TenantMemberPorts {
  readonly invitations: {
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
 * a platform operation. Multi-org membership is permitted (Plan 3): an email
 * holding memberships elsewhere is invited normally; Clerk's own
 * duplicate-pending rejection is translated by the production port.
 *
 * @param actor - Verified tenant principal (requires tenant:members:invite_user).
 * @param raw_input - Invitation input ({ email }).
 * @param ports - Member-management ports.
 * @returns Created invitation ID.
 * @throws AuthorizationError when the caller lacks the permission.
 * @throws DuplicatePendingInvitationError (from the port) when already pending.
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
  console.info({ boundary: "tenant-members", event: "invite.start", tenant_id });

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
  console.info({
    boundary: "tenant-members",
    event: "invite.done",
    tenant_id,
    invitation_id: invitation.id,
  });
  return { invitation_id: invitation.id };
}
