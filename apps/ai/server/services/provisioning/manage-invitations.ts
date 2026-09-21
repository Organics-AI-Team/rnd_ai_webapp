// apps/ai/server/services/provisioning/manage-invitations.ts
import { z } from "zod";
import type { RequestPrincipal } from "@rnd-ai/shared-types";

import { require_active_tenant, require_permission } from "../../auth/authorize";
import {
  InvitationNotFoundError,
  InvitationNotPendingError,
  ManagerActionForbiddenError,
  type InvitationView,
  type MemberAdminPorts,
} from "./member-admin-ports";

const invitation_input_schema = z
  .object({ clerk_invitation_id: z.string().min(1) })
  .strict();

const DEFAULT_INVITATION_TTL_DAYS = 30;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Clerk invitation TTL in days used ONLY for the expired display state
 * (Clerk defaults to 30 days; expiresAt is not stored on the projection).
 *
 * @returns CLERK_INVITATION_TTL_DAYS when a positive number, else 30.
 */
export function invitation_ttl_days(): number {
  const raw = Number(process.env.CLERK_INVITATION_TTL_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INVITATION_TTL_DAYS;
}

/**
 * Derive the display-only expiry state of an invitation projection.
 *
 * @param invitation - Invitation projection view.
 * @param now - Reference time (injected for determinism).
 * @param ttl_days - Invitation TTL in days (see invitation_ttl_days).
 * @returns is_expired true only for a pending invitation past its TTL.
 */
export function derive_invitation_display(
  invitation: InvitationView,
  now: Date,
  ttl_days: number,
): { is_expired: boolean } {
  if (invitation.status !== "invited") return { is_expired: false };
  const expires_at =
    invitation.created_at.getTime() + ttl_days * MILLISECONDS_PER_DAY;
  return { is_expired: now.getTime() > expires_at };
}

/**
 * Load a USER invitation in the caller's tenant or raise the typed error.
 * Manager invitations are platform-scope and are refused here.
 *
 * @param ports - Member-admin ports.
 * @param tenant_id - Caller's tenant.
 * @param clerk_invitation_id - Target invitation id.
 * @returns Invitation view.
 * @throws InvitationNotFoundError / ManagerActionForbiddenError.
 */
async function required_user_invitation(
  ports: MemberAdminPorts,
  tenant_id: string,
  clerk_invitation_id: string,
): Promise<InvitationView> {
  const invitation = await ports.invitations.find_by_clerk_id(
    tenant_id,
    clerk_invitation_id,
  );
  if (!invitation) throw new InvitationNotFoundError(clerk_invitation_id);
  if (invitation.tenant_role === "manager") throw new ManagerActionForbiddenError();
  return invitation;
}

/**
 * Revoke a pending user invitation: Clerk first (tolerant of already-dead
 * invitations at the port), then the projection, then the audit trail.
 * Idempotent over already-revoked invitations.
 *
 * @param actor - Verified tenant principal (requires tenant:members:invite_user).
 * @param raw_input - ({ clerk_invitation_id }).
 * @param ports - Member-admin ports.
 * @returns Success marker.
 * @throws AuthorizationError, InvitationNotFoundError,
 *         ManagerActionForbiddenError, InvitationNotPendingError.
 */
export async function revoke_tenant_invitation(
  actor: RequestPrincipal,
  raw_input: { clerk_invitation_id: string },
  ports: MemberAdminPorts,
): Promise<{ success: true }> {
  require_active_tenant(actor);
  require_permission(actor, "tenant:members:invite_user");
  const input = invitation_input_schema.parse(raw_input);
  const tenant_id = actor.active_tenant_id as string;
  console.info({
    boundary: "manage-invitations",
    event: "invitation.revoke.start",
    tenant_id,
    clerk_invitation_id: input.clerk_invitation_id,
  });

  const invitation = await required_user_invitation(
    ports,
    tenant_id,
    input.clerk_invitation_id,
  );
  if (invitation.status === "revoked") return { success: true };
  if (invitation.status !== "invited") {
    throw new InvitationNotPendingError(input.clerk_invitation_id, invitation.status);
  }

  await ports.clerk.revoke_invitation(tenant_id, input.clerk_invitation_id);
  await ports.invitations.mark_status(tenant_id, input.clerk_invitation_id, "revoked");
  await ports.audit.record({
    action: "revoke_tenant_invitation",
    tenantId: tenant_id,
    clerkInvitationId: input.clerk_invitation_id,
    emailNormalized: invitation.email,
    actorProfileId: actor.internal_user_id,
    occurred_at: new Date(),
  });
  console.info({
    boundary: "manage-invitations",
    event: "invitation.revoke.done",
    tenant_id,
    clerk_invitation_id: input.clerk_invitation_id,
  });
  return { success: true };
}

/**
 * Resend a pending user invitation: revoke the old one (Clerk + projection),
 * mint a replacement with the SAME email and the user role, project it, and
 * audit the pair as one resend.
 *
 * @param actor - Verified tenant principal (requires tenant:members:invite_user).
 * @param raw_input - ({ clerk_invitation_id }) of the invitation to replace.
 * @param ports - Member-admin ports.
 * @returns Replacement invitation ID.
 * @throws AuthorizationError, InvitationNotFoundError,
 *         ManagerActionForbiddenError, InvitationNotPendingError, and Error
 *         when the tenant has no Clerk organization.
 */
export async function resend_tenant_invitation(
  actor: RequestPrincipal,
  raw_input: { clerk_invitation_id: string },
  ports: MemberAdminPorts,
): Promise<{ invitation_id: string }> {
  require_active_tenant(actor);
  require_permission(actor, "tenant:members:invite_user");
  const input = invitation_input_schema.parse(raw_input);
  const tenant_id = actor.active_tenant_id as string;
  console.info({
    boundary: "manage-invitations",
    event: "invitation.resend.start",
    tenant_id,
    clerk_invitation_id: input.clerk_invitation_id,
  });

  const invitation = await required_user_invitation(
    ports,
    tenant_id,
    input.clerk_invitation_id,
  );
  if (invitation.status !== "invited") {
    throw new InvitationNotPendingError(input.clerk_invitation_id, invitation.status);
  }

  const clerk_organization_id =
    await ports.tenants.clerk_organization_id_for(tenant_id);
  if (!clerk_organization_id) {
    throw new Error("The tenant has no Clerk organization; provisioning is incomplete.");
  }

  await ports.clerk.revoke_invitation(tenant_id, input.clerk_invitation_id);
  await ports.invitations.mark_status(tenant_id, input.clerk_invitation_id, "revoked");
  const replacement = await ports.clerk.create_user_invitation(
    clerk_organization_id,
    invitation.email,
  );
  await ports.invitations.upsert(tenant_id, replacement, actor.internal_user_id);
  await ports.audit.record({
    action: "resend_tenant_invitation",
    tenantId: tenant_id,
    revokedClerkInvitationId: input.clerk_invitation_id,
    clerkInvitationId: replacement.id,
    emailNormalized: invitation.email,
    actorProfileId: actor.internal_user_id,
    occurred_at: new Date(),
  });
  console.info({
    boundary: "manage-invitations",
    event: "invitation.resend.done",
    tenant_id,
    clerk_invitation_id: replacement.id,
  });
  return { invitation_id: replacement.id };
}
