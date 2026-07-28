import { z } from "zod";
import { ObjectId } from "mongodb";
import client_promise from "@rnd-ai/shared-database";

import { router, tenantProcedure } from "../trpc";
import {
  invite_tenant_user,
  suspend_tenant_user,
} from "../services/provisioning/invite-tenant-user";
import { create_production_member_ports } from "../services/provisioning/production-member-ports";

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
    // Identity-domain projection read, scoped by the verified tenant context.
    const memberships = await db
      .collection("tenant_membership_projections")
      .find({ tenantId: ctx.tenant_context.tenant_id })
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
      return invite_tenant_user(
        ctx.principal,
        { email: input.email ?? "" },
        create_production_member_ports(client.db()),
      );
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
        create_production_member_ports(client.db()),
      );
    }),
});
