// apps/ai/server/services/provisioning/manage-members.ts
import { z } from "zod";
import type { ClientSession } from "mongodb";
import type { RequestPrincipal } from "@rnd-ai/shared-types";

import { require_active_tenant, require_permission } from "../../auth/authorize";
import {
  LastManagerError,
  ManagerActionForbiddenError,
  MemberNotFoundError,
  ProfileInactiveError,
  type MemberAdminPorts,
  type MembershipView,
} from "./member-admin-ports";

const member_input_schema = z
  .object({ user_profile_id: z.string().min(1) })
  .strict();

/**
 * Load a membership in the caller's tenant and refuse manager targets:
 * tenant managers act on users only (spec §4.2); manager lifecycle is a
 * platform operation.
 *
 * @param ports - Member-admin ports.
 * @param tenant_id - Caller's tenant.
 * @param user_profile_id - Target profile id.
 * @returns Membership view of a user-role target.
 * @throws MemberNotFoundError / ManagerActionForbiddenError.
 */
async function required_user_target(
  ports: MemberAdminPorts,
  tenant_id: string,
  user_profile_id: string,
): Promise<MembershipView> {
  const membership = await ports.memberships.find_membership(tenant_id, user_profile_id);
  if (!membership) throw new MemberNotFoundError(user_profile_id);
  if (membership.tenant_role === "manager") throw new ManagerActionForbiddenError();
  return membership;
}

/**
 * Suspend a tenant user's membership (app-side; Clerk keeps the membership —
 * the projection is authoritative for authz). Idempotent over suspended
 * memberships; revoked memberships read as not found.
 *
 * @param actor - Verified tenant principal (requires tenant:members:suspend_user).
 * @param raw_input - ({ user_profile_id }).
 * @param ports - Member-admin ports.
 * @returns Success marker.
 * @throws AuthorizationError, MemberNotFoundError, ManagerActionForbiddenError.
 */
export async function suspend_tenant_user(
  actor: RequestPrincipal,
  raw_input: { user_profile_id: string },
  ports: MemberAdminPorts,
): Promise<{ success: true }> {
  require_active_tenant(actor);
  require_permission(actor, "tenant:members:suspend_user");
  const input = member_input_schema.parse(raw_input);
  const tenant_id = actor.active_tenant_id as string;
  console.info({
    boundary: "manage-members",
    event: "suspend.start",
    tenant_id,
    user_profile_id: input.user_profile_id,
  });

  const membership = await required_user_target(ports, tenant_id, input.user_profile_id);
  if (membership.status === "suspended") return { success: true };
  if (membership.status === "revoked") throw new MemberNotFoundError(input.user_profile_id);

  await ports.memberships.set_membership_status(
    tenant_id,
    input.user_profile_id,
    "suspended",
  );
  await ports.audit.record({
    action: "suspend_tenant_user",
    tenantId: tenant_id,
    userProfileId: input.user_profile_id,
    actorProfileId: actor.internal_user_id,
    occurred_at: new Date(),
  });
  console.info({
    boundary: "manage-members",
    event: "suspend.done",
    tenant_id,
    user_profile_id: input.user_profile_id,
  });
  return { success: true };
}

/**
 * Reactivate a suspended tenant user (app-side suspension only — no Clerk
 * call). Refuses when the target's user profile is itself not active, and
 * treats revoked memberships as not found (re-invite is the path back).
 *
 * @param actor - Verified tenant principal (requires tenant:members:suspend_user).
 * @param raw_input - ({ user_profile_id }).
 * @param ports - Member-admin ports.
 * @returns Success marker.
 * @throws AuthorizationError, MemberNotFoundError,
 *         ManagerActionForbiddenError, ProfileInactiveError.
 */
export async function reactivate_tenant_user(
  actor: RequestPrincipal,
  raw_input: { user_profile_id: string },
  ports: MemberAdminPorts,
): Promise<{ success: true }> {
  require_active_tenant(actor);
  require_permission(actor, "tenant:members:suspend_user");
  const input = member_input_schema.parse(raw_input);
  const tenant_id = actor.active_tenant_id as string;
  console.info({
    boundary: "manage-members",
    event: "reactivate.start",
    tenant_id,
    user_profile_id: input.user_profile_id,
  });

  const membership = await required_user_target(ports, tenant_id, input.user_profile_id);
  if (membership.status === "active") return { success: true };
  if (membership.status === "revoked") throw new MemberNotFoundError(input.user_profile_id);

  const profile_status = await ports.profiles.find_profile_status(input.user_profile_id);
  if (profile_status !== "active") {
    throw new ProfileInactiveError(input.user_profile_id, profile_status ?? "missing");
  }

  await ports.memberships.set_membership_status(
    tenant_id,
    input.user_profile_id,
    "active",
  );
  await ports.audit.record({
    action: "reactivate_tenant_user",
    tenantId: tenant_id,
    userProfileId: input.user_profile_id,
    actorProfileId: actor.internal_user_id,
    occurred_at: new Date(),
  });
  console.info({
    boundary: "manage-members",
    event: "reactivate.done",
    tenant_id,
    user_profile_id: input.user_profile_id,
  });
  return { success: true };
}

/**
 * Remove a tenant user: soft-revoke the projection inside a transaction,
 * then delete the Clerk membership, reverting the projection if Clerk fails
 * (spec §4.2 ordering — the later organizationMembership.deleted webhook is
 * a monotonic no-op). Re-inviting later revives the same projection row.
 * The target is guaranteed a plain user by required_user_target, so the
 * last-manager invariant is structurally not applicable on this path.
 *
 * @param actor - Verified tenant principal (requires tenant:members:remove_user).
 * @param raw_input - ({ user_profile_id }).
 * @param ports - Member-admin ports.
 * @returns Success marker.
 * @throws AuthorizationError, MemberNotFoundError,
 *         ManagerActionForbiddenError, and the Clerk error on revert.
 */
export async function remove_tenant_user(
  actor: RequestPrincipal,
  raw_input: { user_profile_id: string },
  ports: MemberAdminPorts,
): Promise<{ success: true }> {
  require_active_tenant(actor);
  require_permission(actor, "tenant:members:remove_user");
  const input = member_input_schema.parse(raw_input);
  const tenant_id = actor.active_tenant_id as string;
  console.info({
    boundary: "manage-members",
    event: "remove.start",
    tenant_id,
    user_profile_id: input.user_profile_id,
  });

  const membership = await required_user_target(ports, tenant_id, input.user_profile_id);
  if (membership.status === "revoked") return { success: true };
  const previous_status = membership.status;

  await ports.transactions.run(async (session) => {
    await ports.memberships.set_membership_status(
      tenant_id,
      input.user_profile_id,
      "revoked",
      session,
    );
  });
  try {
    await ports.clerk.remove_membership(tenant_id, input.user_profile_id);
  } catch (error) {
    await ports.memberships.set_membership_status(
      tenant_id,
      input.user_profile_id,
      previous_status,
    );
    await ports.audit.record({
      action: "remove_tenant_user_reverted",
      tenantId: tenant_id,
      userProfileId: input.user_profile_id,
      actorProfileId: actor.internal_user_id,
      occurred_at: new Date(),
    });
    console.error({
      boundary: "manage-members",
      event: "remove.reverted",
      tenant_id,
      user_profile_id: input.user_profile_id,
    });
    throw error;
  }
  await ports.audit.record({
    action: "remove_tenant_user",
    tenantId: tenant_id,
    userProfileId: input.user_profile_id,
    actorProfileId: actor.internal_user_id,
    occurred_at: new Date(),
  });
  console.info({
    boundary: "manage-members",
    event: "remove.done",
    tenant_id,
    user_profile_id: input.user_profile_id,
  });
  return { success: true };
}

/**
 * Assert (inside a transaction) that demoting/suspending/removing the given
 * member cannot leave the tenant without an active manager. No-op for
 * non-manager or non-active targets. Enforced for APP-INITIATED mutations
 * only (spec §4.3) — Clerk-originated violations are detected by the
 * zero-manager webhook detector instead.
 *
 * @param ports - Member-admin ports.
 * @param tenant_id - Tenant whose invariant is protected.
 * @param user_profile_id - Member being mutated.
 * @param session - Transaction session the caller is running in. Required
 *                  rationale: the count is only trustworthy inside the same
 *                  transaction as the mutation.
 * @throws LastManagerError when the target is the last active manager.
 */
export async function assert_not_last_active_manager(
  ports: MemberAdminPorts,
  tenant_id: string,
  user_profile_id: string,
  session: ClientSession | undefined,
): Promise<void> {
  const membership = await ports.memberships.find_membership(
    tenant_id,
    user_profile_id,
    session,
  );
  if (
    !membership ||
    membership.tenant_role !== "manager" ||
    membership.status !== "active"
  ) {
    return;
  }
  // Write-conflict guard: both of two racing transactions write the same
  // tenant document, so Mongo aborts one (withTransaction retries it, and
  // the retry re-reads a one-manager count) instead of committing write-skew.
  await ports.memberships.touch_tenant_for_invariant(tenant_id, session);
  const active_managers = await ports.memberships.count_active_managers(
    tenant_id,
    session,
  );
  if (active_managers <= 1) {
    throw new LastManagerError(tenant_id);
  }
}
