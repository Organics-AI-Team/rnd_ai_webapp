// tests/provisioning/demote-manager.test.ts
import { describe, expect, it } from "vitest";

import { demote_manager } from "../../apps/ai/server/services/provisioning/demote-manager";
import {
  LastManagerError,
  MemberNotFoundError,
} from "../../apps/ai/server/services/provisioning/member-admin-ports";
import { AuthorizationError } from "../../apps/ai/server/auth/errors";
import {
  TENANT,
  fake_member_admin_world,
  manager_principal,
  membership_key,
  platform_admin_principal,
} from "./helpers/fake-member-admin-ports";

const TARGET = "507f1f77bcf86cd799439055";
const OTHER_MANAGER = "507f1f77bcf86cd799439056";

describe("demote_manager", () => {
  it("demotes a manager to user, updates Clerk after the transaction, and audits", async () => {
    const world = fake_member_admin_world();
    world.memberships.set(membership_key(TENANT, TARGET), {
      tenant_role: "manager",
      status: "active",
    });
    world.memberships.set(membership_key(TENANT, OTHER_MANAGER), {
      tenant_role: "manager",
      status: "active",
    });
    const result = await demote_manager(
      platform_admin_principal,
      { tenant_id: TENANT, user_profile_id: TARGET },
      world.ports,
    );
    expect(result).toEqual({ success: true, changed: true });
    expect(world.memberships.get(membership_key(TENANT, TARGET))?.tenant_role).toBe("user");
    expect(world.clerk_calls).toEqual([
      { method: "update_membership_role", args: [TENANT, TARGET, "user"] },
    ]);
    expect(world.audit_events[0]).toMatchObject({
      action: "demote_manager",
      tenantId: TENANT,
      userProfileId: TARGET,
    });
  });

  it("is idempotent over a user-role member (no Clerk call, no audit)", async () => {
    const world = fake_member_admin_world();
    world.memberships.set(membership_key(TENANT, TARGET), {
      tenant_role: "user",
      status: "active",
    });
    await expect(
      demote_manager(
        platform_admin_principal,
        { tenant_id: TENANT, user_profile_id: TARGET },
        world.ports,
      ),
    ).resolves.toEqual({ success: true, changed: false });
    expect(world.clerk_calls).toHaveLength(0);
    expect(world.audit_events).toHaveLength(0);
  });

  it("refuses to demote the last active manager", async () => {
    const world = fake_member_admin_world();
    world.memberships.set(membership_key(TENANT, TARGET), {
      tenant_role: "manager",
      status: "active",
    });
    await expect(
      demote_manager(
        platform_admin_principal,
        { tenant_id: TENANT, user_profile_id: TARGET },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(LastManagerError);
    expect(world.memberships.get(membership_key(TENANT, TARGET))?.tenant_role).toBe("manager");
    expect(world.clerk_calls).toHaveLength(0);
  });

  it("reverts the projection role and rethrows when the Clerk update fails", async () => {
    const world = fake_member_admin_world();
    world.memberships.set(membership_key(TENANT, TARGET), {
      tenant_role: "manager",
      status: "active",
    });
    world.memberships.set(membership_key(TENANT, OTHER_MANAGER), {
      tenant_role: "manager",
      status: "active",
    });
    world.fail_clerk.update_membership_role = true;
    await expect(
      demote_manager(
        platform_admin_principal,
        { tenant_id: TENANT, user_profile_id: TARGET },
        world.ports,
      ),
    ).rejects.toThrow("clerk role update failed");
    expect(world.memberships.get(membership_key(TENANT, TARGET))?.tenant_role).toBe("manager");
    expect(
      world.audit_events.some((e) => e.action === "demote_manager_reverted"),
    ).toBe(true);
  });

  it("treats missing and revoked memberships as not found", async () => {
    const world = fake_member_admin_world();
    await expect(
      demote_manager(
        platform_admin_principal,
        { tenant_id: TENANT, user_profile_id: TARGET },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
    world.memberships.set(membership_key(TENANT, TARGET), {
      tenant_role: "manager",
      status: "revoked",
    });
    await expect(
      demote_manager(
        platform_admin_principal,
        { tenant_id: TENANT, user_profile_id: TARGET },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });

  it("rejects a caller without a platform role", async () => {
    const world = fake_member_admin_world();
    world.memberships.set(membership_key(TENANT, TARGET), {
      tenant_role: "manager",
      status: "active",
    });
    await expect(
      demote_manager(
        manager_principal,
        { tenant_id: TENANT, user_profile_id: TARGET },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
