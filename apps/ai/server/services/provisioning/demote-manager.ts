// apps/ai/server/services/provisioning/demote-manager.ts
import { z } from "zod";
import type { RequestPrincipal } from "@rnd-ai/shared-types";

import { require_platform_admin } from "../../auth/authorize";
import {
  MemberNotFoundError,
  type MemberAdminPorts,
} from "./member-admin-ports";
import { assert_not_last_active_manager } from "./manage-members";

const demote_input_schema = z
  .object({
    tenant_id: z.string().min(1),
    user_profile_id: z.string().min(1),
  })
  .strict();

/**
 * Demote a university manager to the user role (platform scope). Idempotent:
 * demoting a user-role member is a no-op success. Ordering (spec §4.3):
 * transaction (last-manager assert + projection role write) → Clerk role
 * update after commit → revert the projection and rethrow on Clerk failure.
 * The role string is mapped through CLERK_ORG_ROLE_MODE by the port.
 *
 * @param actor - Verified principal; must hold a platform role.
 * @param raw_input - ({ tenant_id, user_profile_id }).
 * @param ports - Member-admin ports.
 * @returns changed=false for the idempotent no-op, true otherwise.
 * @throws AuthorizationError, MemberNotFoundError, LastManagerError, and
 *         the Clerk error on revert.
 */
export async function demote_manager(
  actor: RequestPrincipal,
  raw_input: { tenant_id: string; user_profile_id: string },
  ports: MemberAdminPorts,
): Promise<{ success: true; changed: boolean }> {
  require_platform_admin(actor);
  const input = demote_input_schema.parse(raw_input);
  console.info({
    boundary: "platform-tenants",
    event: "demote.start",
    tenant_id: input.tenant_id,
    user_profile_id: input.user_profile_id,
  });

  const membership = await ports.memberships.find_membership(
    input.tenant_id,
    input.user_profile_id,
  );
  if (!membership || membership.status === "revoked") {
    throw new MemberNotFoundError(input.user_profile_id);
  }
  if (membership.tenant_role === "user") {
    // Idempotent: demoting a user-role member is a no-op success.
    return { success: true, changed: false };
  }

  await ports.transactions.run(async (session) => {
    await assert_not_last_active_manager(
      ports,
      input.tenant_id,
      input.user_profile_id,
      session,
    );
    await ports.memberships.set_membership_role(
      input.tenant_id,
      input.user_profile_id,
      "user",
      session,
    );
  });
  try {
    await ports.clerk.update_membership_role(
      input.tenant_id,
      input.user_profile_id,
      "user",
    );
  } catch (error) {
    await ports.memberships.set_membership_role(
      input.tenant_id,
      input.user_profile_id,
      "manager",
    );
    await ports.audit.record({
      action: "demote_manager_reverted",
      tenantId: input.tenant_id,
      userProfileId: input.user_profile_id,
      actorProfileId: actor.internal_user_id,
      occurred_at: new Date(),
    });
    console.error({
      boundary: "platform-tenants",
      event: "demote.reverted",
      tenant_id: input.tenant_id,
      user_profile_id: input.user_profile_id,
    });
    throw error;
  }
  await ports.audit.record({
    action: "demote_manager",
    tenantId: input.tenant_id,
    userProfileId: input.user_profile_id,
    actorProfileId: actor.internal_user_id,
    occurred_at: new Date(),
  });
  console.info({
    boundary: "platform-tenants",
    event: "manager.demoted",
    tenant_id: input.tenant_id,
    user_profile_id: input.user_profile_id,
  });
  return { success: true, changed: true };
}
