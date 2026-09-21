// apps/ai/server/routers/tenant-members.ts
import { z } from "zod";
import client_promise from "@rnd-ai/shared-database";

import { router, tenantProcedure } from "../trpc";
import { invite_tenant_user } from "../services/provisioning/invite-tenant-user";
import {
  reactivate_tenant_user,
  remove_tenant_user,
  suspend_tenant_user,
} from "../services/provisioning/manage-members";
import {
  derive_invitation_display,
  invitation_ttl_days,
  resend_tenant_invitation,
  revoke_tenant_invitation,
} from "../services/provisioning/manage-invitations";
import {
  create_production_member_admin_ports,
  create_production_member_ports,
} from "../services/provisioning/production-member-ports";
import { list_tenant_members } from "../services/provisioning/list-tenant-members";
import { throw_member_admin_error } from "./member-admin-errors";

/**
 * University member administration. Managers list, invite students, manage
 * invitations, suspend/reactivate/remove users; manager appointment/demotion
 * is a platform operation and is rejected here by construction (the invite
 * path always passes the user role; suspend/reactivate/remove guard against
 * manager targets).
 */
export const tenantMembersRouter = router({
  /**
   * List membership projections for the caller's university.
   */
  list: tenantProcedure("tenant:members:read").query(async ({ ctx }) => {
    const client = await client_promise;
    // Identity-domain projection read, scoped by the verified tenant context.
    return list_tenant_members(client.db(), ctx.tenant_context.tenant_id);
  }),

  /**
   * List invitation projections for the caller's university with the derived
   * expired display state (projection is the source; Clerk's ~TTL applied to
   * createdAt because expiresAt is not stored).
   */
  listInvitations: tenantProcedure("tenant:members:read").query(async ({ ctx }) => {
    const client = await client_promise;
    const db = client.db();
    const ttl_days = invitation_ttl_days();
    const now = new Date();
    const invitations = await db
      .collection("tenant_invitation_projections")
      .find({ tenantId: ctx.tenant_context.tenant_id })
      .sort({ createdAt: -1 })
      .toArray();
    return invitations.map((invitation) => {
      const view = {
        clerk_invitation_id: String(invitation.clerkInvitationId),
        email: String(invitation.emailNormalized),
        tenant_role:
          invitation.tenantRole === "manager"
            ? ("manager" as const)
            : ("user" as const),
        status: String(invitation.status),
        created_at:
          invitation.createdAt instanceof Date ? invitation.createdAt : new Date(0),
      };
      return {
        _id: invitation._id.toString(),
        clerkInvitationId: view.clerk_invitation_id,
        email: view.email,
        tenantRole: view.tenant_role,
        status: view.status,
        createdAt: view.created_at,
        isExpired: derive_invitation_display(view, now, ttl_days).is_expired,
      };
    });
  }),

  /**
   * Invite a student into the caller's university (user role only). Clerk's
   * duplicate-pending rejection surfaces as CONFLICT with a human message.
   */
  inviteUser: tenantProcedure("tenant:members:invite_user")
    .input(z.object({ email: z.string().email() }).strict())
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      try {
        return await invite_tenant_user(
          ctx.principal,
          { email: input.email ?? "" },
          create_production_member_ports(client.db()),
        );
      } catch (error) {
        throw_member_admin_error(error);
      }
    }),

  /**
   * Revoke a pending user invitation (Clerk + projection, audited).
   */
  revokeInvitation: tenantProcedure("tenant:members:invite_user")
    .input(z.object({ clerk_invitation_id: z.string().min(1) }).strict())
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      try {
        return await revoke_tenant_invitation(
          ctx.principal,
          { clerk_invitation_id: input.clerk_invitation_id ?? "" },
          create_production_member_admin_ports(client.db()),
        );
      } catch (error) {
        throw_member_admin_error(error);
      }
    }),

  /**
   * Resend a pending user invitation (revoke + create, audited as a resend).
   */
  resendInvitation: tenantProcedure("tenant:members:invite_user")
    .input(z.object({ clerk_invitation_id: z.string().min(1) }).strict())
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      try {
        return await resend_tenant_invitation(
          ctx.principal,
          { clerk_invitation_id: input.clerk_invitation_id ?? "" },
          create_production_member_admin_ports(client.db()),
        );
      } catch (error) {
        throw_member_admin_error(error);
      }
    }),

  /**
   * Suspend a user's membership in the caller's university (users only —
   * manager lifecycle is platform-scope and refused by the service).
   */
  suspendUser: tenantProcedure("tenant:members:suspend_user")
    .input(z.object({ user_profile_id: z.string().min(1) }).strict())
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      try {
        return await suspend_tenant_user(
          ctx.principal,
          { user_profile_id: input.user_profile_id ?? "" },
          create_production_member_admin_ports(client.db()),
        );
      } catch (error) {
        throw_member_admin_error(error);
      }
    }),

  /**
   * Reactivate a suspended user's membership (app-side; refused when the
   * user profile itself is not active).
   */
  reactivateUser: tenantProcedure("tenant:members:suspend_user")
    .input(z.object({ user_profile_id: z.string().min(1) }).strict())
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      try {
        return await reactivate_tenant_user(
          ctx.principal,
          { user_profile_id: input.user_profile_id ?? "" },
          create_production_member_admin_ports(client.db()),
        );
      } catch (error) {
        throw_member_admin_error(error);
      }
    }),

  /**
   * Remove a user from the caller's university (manager-only permission;
   * soft revoke + Clerk removal with revert-on-failure; re-invite revives).
   */
  removeUser: tenantProcedure("tenant:members:remove_user")
    .input(z.object({ user_profile_id: z.string().min(1) }).strict())
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      try {
        return await remove_tenant_user(
          ctx.principal,
          { user_profile_id: input.user_profile_id ?? "" },
          create_production_member_admin_ports(client.db()),
        );
      } catch (error) {
        throw_member_admin_error(error);
      }
    }),
});
