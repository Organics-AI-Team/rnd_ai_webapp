// tests/provisioning/manage-members.test.ts
import { describe, expect, it } from "vitest";

import {
  reactivate_tenant_user,
  remove_tenant_user,
  suspend_tenant_user,
} from "../../apps/ai/server/services/provisioning/manage-members";
import {
  ManagerActionForbiddenError,
  MemberNotFoundError,
  ProfileInactiveError,
} from "../../apps/ai/server/services/provisioning/member-admin-ports";
import { AuthorizationError } from "../../apps/ai/server/auth/errors";
import {
  TENANT,
  fake_member_admin_world,
  manager_principal,
  membership_key,
  student_principal,
} from "./helpers/fake-member-admin-ports";

const TARGET = "507f1f77bcf86cd799439055";

/** Seed one target membership + profile status into the fake world. */
function seed_target(
  world: ReturnType<typeof fake_member_admin_world>,
  overrides: Partial<{
    tenant_role: "manager" | "user";
    status: "active" | "suspended" | "revoked";
    profile_status: string;
  }> = {},
) {
  world.memberships.set(membership_key(TENANT, TARGET), {
    tenant_role: overrides.tenant_role ?? "user",
    status: overrides.status ?? "active",
  });
  world.profiles.set(TARGET, overrides.profile_status ?? "active");
}

describe("suspend_tenant_user (relocated with target guard)", () => {
  it("suspends an active user and audits", async () => {
    const world = fake_member_admin_world();
    seed_target(world);
    await expect(
      suspend_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).resolves.toEqual({ success: true });
    expect(world.memberships.get(membership_key(TENANT, TARGET))?.status).toBe("suspended");
    expect(world.audit_events[0]).toMatchObject({
      action: "suspend_tenant_user",
      tenantId: TENANT,
      userProfileId: TARGET,
    });
  });

  it("refuses a manager target — manager lifecycle is platform-scope", async () => {
    const world = fake_member_admin_world();
    seed_target(world, { tenant_role: "manager" });
    await expect(
      suspend_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).rejects.toBeInstanceOf(ManagerActionForbiddenError);
    expect(world.memberships.get(membership_key(TENANT, TARGET))?.status).toBe("active");
  });

  it("is idempotent over an already-suspended membership", async () => {
    const world = fake_member_admin_world();
    seed_target(world, { status: "suspended" });
    await expect(
      suspend_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).resolves.toEqual({ success: true });
    expect(world.audit_events).toHaveLength(0);
  });

  it("treats a revoked membership as not found", async () => {
    const world = fake_member_admin_world();
    seed_target(world, { status: "revoked" });
    await expect(
      suspend_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });

  it("rejects a tenant user caller", async () => {
    const world = fake_member_admin_world();
    seed_target(world);
    await expect(
      suspend_tenant_user(student_principal, { user_profile_id: TARGET }, world.ports),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("reactivate_tenant_user", () => {
  it("reactivates a suspended user whose profile is active", async () => {
    const world = fake_member_admin_world();
    seed_target(world, { status: "suspended" });
    await expect(
      reactivate_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).resolves.toEqual({ success: true });
    expect(world.memberships.get(membership_key(TENANT, TARGET))?.status).toBe("active");
    expect(world.audit_events[0]).toMatchObject({ action: "reactivate_tenant_user" });
    expect(world.clerk_calls).toHaveLength(0); // app-side suspension only
  });

  it("refuses when the user profile itself is not active", async () => {
    const world = fake_member_admin_world();
    seed_target(world, { status: "suspended", profile_status: "suspended" });
    await expect(
      reactivate_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).rejects.toBeInstanceOf(ProfileInactiveError);
    expect(world.memberships.get(membership_key(TENANT, TARGET))?.status).toBe("suspended");
  });

  it("is idempotent over an already-active membership", async () => {
    const world = fake_member_admin_world();
    seed_target(world);
    await expect(
      reactivate_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).resolves.toEqual({ success: true });
    expect(world.audit_events).toHaveLength(0);
  });

  it("treats a revoked membership as not found (re-invite is the path back)", async () => {
    const world = fake_member_admin_world();
    seed_target(world, { status: "revoked" });
    await expect(
      reactivate_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });

  it("refuses a manager target", async () => {
    const world = fake_member_admin_world();
    seed_target(world, { tenant_role: "manager", status: "suspended" });
    await expect(
      reactivate_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).rejects.toBeInstanceOf(ManagerActionForbiddenError);
  });
});

describe("remove_tenant_user", () => {
  it("revokes the projection first, then removes the Clerk membership, and audits", async () => {
    const world = fake_member_admin_world();
    seed_target(world);
    await expect(
      remove_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).resolves.toEqual({ success: true });
    expect(world.memberships.get(membership_key(TENANT, TARGET))?.status).toBe("revoked");
    expect(world.clerk_calls).toEqual([
      { method: "remove_membership", args: [TENANT, TARGET] },
    ]);
    expect(world.audit_events[0]).toMatchObject({
      action: "remove_tenant_user",
      tenantId: TENANT,
      userProfileId: TARGET,
    });
  });

  it("reverts the projection and rethrows when the Clerk removal fails", async () => {
    const world = fake_member_admin_world();
    seed_target(world);
    world.fail_clerk.remove_membership = true;
    await expect(
      remove_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).rejects.toThrow("clerk remove failed");
    expect(world.memberships.get(membership_key(TENANT, TARGET))?.status).toBe("active");
    expect(
      world.audit_events.some((e) => e.action === "remove_tenant_user_reverted"),
    ).toBe(true);
  });

  it("refuses a manager target", async () => {
    const world = fake_member_admin_world();
    seed_target(world, { tenant_role: "manager" });
    await expect(
      remove_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).rejects.toBeInstanceOf(ManagerActionForbiddenError);
  });

  it("is idempotent over an already-revoked membership (no Clerk call)", async () => {
    const world = fake_member_admin_world();
    seed_target(world, { status: "revoked" });
    await expect(
      remove_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).resolves.toEqual({ success: true });
    expect(world.clerk_calls).toHaveLength(0);
  });

  it("rejects a caller without tenant:members:remove_user", async () => {
    const world = fake_member_admin_world();
    seed_target(world);
    await expect(
      remove_tenant_user(student_principal, { user_profile_id: TARGET }, world.ports),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
