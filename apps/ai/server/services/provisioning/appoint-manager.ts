// apps/ai/server/services/provisioning/appoint-manager.ts
import { z } from "zod";
import type { RequestPrincipal } from "@rnd-ai/shared-types";

import { require_platform_admin } from "../../auth/authorize";
import type { ManagerInvitation } from "./provisioning-types";

/**
 * Raised when the appointee already holds an active membership in the target
 * university. Appointment is an invitation flow; role changes for existing
 * members go through platformTenants.demoteManager / reconciliation, not a
 * silent re-invite.
 */
export class AlreadyTenantMemberError extends Error {
  readonly code = "ALREADY_TENANT_MEMBER";

  constructor(email: string) {
    super(
      `ALREADY_TENANT_MEMBER: ${email} already holds an active membership in this university.`,
    );
    this.name = "AlreadyTenantMemberError";
  }
}

const appoint_input_schema = z
  .object({
    tenant_id: z.string().min(1),
    email: z.string().trim().toLowerCase().email(),
  })
  .strict();

/** Ports for platform manager appointment; fakes in tests, MongoDB/Clerk in production. */
export interface AppointManagerPorts {
  readonly memberships: {
    find_memberships_by_email(
      email: string,
    ): Promise<Array<{ tenant_id: string; status: string }>>;
  };
  readonly invitations: {
    upsert(
      tenant_id: string,
      invitation: ManagerInvitation,
      invited_by_profile_id: string,
    ): Promise<void>;
  };
  readonly clerk: {
    create_manager_invitation(
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
 * Appoint a university manager. Platform-only by plan: tenant managers can
 * never mint managers (their invite path always passes the user role), so
 * this operation asserts a platform role even though the router also gates
 * it. Multi-org membership is permitted (Plan 3): memberships at OTHER
 * universities no longer block appointment — only an existing active
 * membership in THIS university does. The Clerk port stays idempotent over
 * pending invitations.
 *
 * @param actor - Verified principal; must hold a platform role.
 * @param raw_input - Appointment input ({ tenant_id, email }).
 * @param ports - Appointment ports (memberships, invitations, Clerk, tenants, audit).
 * @returns Created or reused invitation ID and its Clerk manager role.
 * @throws AuthorizationError when the actor holds no platform role.
 * @throws AlreadyTenantMemberError when the email is already an active member here.
 * @throws Error when the tenant has no Clerk organization.
 */
export async function appoint_manager(
  actor: RequestPrincipal,
  raw_input: { tenant_id: string; email: string },
  ports: AppointManagerPorts,
): Promise<{ invitation_id: string; role: string }> {
  require_platform_admin(actor);
  const input = appoint_input_schema.parse(raw_input);

  const memberships = await ports.memberships.find_memberships_by_email(input.email);
  const already_member = memberships.some(
    (record) =>
      record.tenant_id === input.tenant_id && record.status === "active",
  );
  if (already_member) {
    throw new AlreadyTenantMemberError(input.email);
  }

  const clerk_organization_id =
    await ports.tenants.clerk_organization_id_for(input.tenant_id);
  if (!clerk_organization_id) {
    throw new Error(
      "The tenant has no Clerk organization; provisioning is incomplete.",
    );
  }

  const invitation = await ports.clerk.create_manager_invitation(
    clerk_organization_id,
    input.email,
  );
  await ports.invitations.upsert(
    input.tenant_id,
    invitation,
    actor.internal_user_id,
  );
  await ports.audit.record({
    action: "appoint_manager",
    tenantId: input.tenant_id,
    emailNormalized: input.email,
    actorProfileId: actor.internal_user_id,
    occurred_at: new Date(),
  });
  console.info({
    boundary: "platform-tenants",
    event: "manager.appointed",
    tenant_id: input.tenant_id,
    invitation_id: invitation.id,
  });
  return { invitation_id: invitation.id, role: invitation.role };
}
