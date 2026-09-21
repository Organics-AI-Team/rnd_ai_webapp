// tests/provisioning/manage-invitations.test.ts
import { afterEach, describe, expect, it } from "vitest";

import {
  derive_invitation_display,
  invitation_ttl_days,
  resend_tenant_invitation,
  revoke_tenant_invitation,
} from "../../apps/ai/server/services/provisioning/manage-invitations";
import {
  InvitationNotFoundError,
  InvitationNotPendingError,
  ManagerActionForbiddenError,
} from "../../apps/ai/server/services/provisioning/member-admin-ports";
import { AuthorizationError } from "../../apps/ai/server/auth/errors";
import {
  TENANT,
  fake_member_admin_world,
  manager_principal,
  student_principal,
} from "./helpers/fake-member-admin-ports";

const NOW = new Date("2026-07-29T00:00:00Z");

/** Seed one pending user invitation into the fake world. */
function seed_invitation(
  world: ReturnType<typeof fake_member_admin_world>,
  overrides: Partial<{
    clerk_invitation_id: string;
    tenant_role: "manager" | "user";
    status: string;
    created_at: Date;
  }> = {},
) {
  const id = overrides.clerk_invitation_id ?? "inv_1";
  world.invitations.set(id, {
    tenant_id: TENANT,
    clerk_invitation_id: id,
    email: "pending@x.ac.th",
    tenant_role: overrides.tenant_role ?? "user",
    status: overrides.status ?? "invited",
    created_at: overrides.created_at ?? NOW,
  });
  return id;
}

afterEach(() => {
  delete process.env.CLERK_INVITATION_TTL_DAYS;
});

describe("revoke_tenant_invitation", () => {
  it("revokes a pending user invitation via Clerk and marks the projection", async () => {
    const world = fake_member_admin_world();
    seed_invitation(world);
    const result = await revoke_tenant_invitation(
      manager_principal,
      { clerk_invitation_id: "inv_1" },
      world.ports,
    );
    expect(result).toEqual({ success: true });
    expect(world.clerk_calls).toEqual([
      { method: "revoke_invitation", args: [TENANT, "inv_1"] },
    ]);
    expect(world.invitations.get("inv_1")?.status).toBe("revoked");
    expect(world.audit_events[0]).toMatchObject({
      action: "revoke_tenant_invitation",
      tenantId: TENANT,
      clerkInvitationId: "inv_1",
    });
  });

  it("is idempotent over an already-revoked invitation (no Clerk call)", async () => {
    const world = fake_member_admin_world();
    seed_invitation(world, { status: "revoked" });
    await expect(
      revoke_tenant_invitation(
        manager_principal,
        { clerk_invitation_id: "inv_1" },
        world.ports,
      ),
    ).resolves.toEqual({ success: true });
    expect(world.clerk_calls).toHaveLength(0);
  });

  it("refuses a manager invitation — manager lifecycle is platform-scope", async () => {
    const world = fake_member_admin_world();
    seed_invitation(world, { tenant_role: "manager" });
    await expect(
      revoke_tenant_invitation(
        manager_principal,
        { clerk_invitation_id: "inv_1" },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(ManagerActionForbiddenError);
  });

  it("rejects an unknown invitation with NOT_FOUND semantics", async () => {
    const world = fake_member_admin_world();
    await expect(
      revoke_tenant_invitation(
        manager_principal,
        { clerk_invitation_id: "inv_missing" },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(InvitationNotFoundError);
  });

  it("rejects an accepted invitation as not pending", async () => {
    const world = fake_member_admin_world();
    seed_invitation(world, { status: "active" });
    await expect(
      revoke_tenant_invitation(
        manager_principal,
        { clerk_invitation_id: "inv_1" },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(InvitationNotPendingError);
  });

  it("rejects a tenant user caller", async () => {
    const world = fake_member_admin_world();
    seed_invitation(world);
    await expect(
      revoke_tenant_invitation(
        student_principal,
        { clerk_invitation_id: "inv_1" },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("resend_tenant_invitation", () => {
  it("revokes the old invitation, mints a replacement, and audits the resend", async () => {
    const world = fake_member_admin_world();
    seed_invitation(world);
    const result = await resend_tenant_invitation(
      manager_principal,
      { clerk_invitation_id: "inv_1" },
      world.ports,
    );
    expect(result).toEqual({ invitation_id: "inv_new_1" });
    expect(world.clerk_calls).toEqual([
      { method: "revoke_invitation", args: [TENANT, "inv_1"] },
      { method: "create_user_invitation", args: [`org_for_${TENANT}`, "pending@x.ac.th"] },
    ]);
    expect(world.invitations.get("inv_1")?.status).toBe("revoked");
    expect(world.upserted_invitations[0]).toMatchObject({
      tenant_id: TENANT,
      invitation: { id: "inv_new_1", email: "pending@x.ac.th" },
    });
    expect(world.audit_events[0]).toMatchObject({
      action: "resend_tenant_invitation",
      revokedClerkInvitationId: "inv_1",
      clerkInvitationId: "inv_new_1",
    });
  });

  it("rejects resending a non-pending invitation", async () => {
    const world = fake_member_admin_world();
    seed_invitation(world, { status: "revoked" });
    await expect(
      resend_tenant_invitation(
        manager_principal,
        { clerk_invitation_id: "inv_1" },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(InvitationNotPendingError);
  });

  it("refuses manager invitations", async () => {
    const world = fake_member_admin_world();
    seed_invitation(world, { tenant_role: "manager" });
    await expect(
      resend_tenant_invitation(
        manager_principal,
        { clerk_invitation_id: "inv_1" },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(ManagerActionForbiddenError);
  });
});

describe("expired display derivation", () => {
  it("marks a pending invitation expired after the TTL and not before", () => {
    const invitation = {
      clerk_invitation_id: "inv_1",
      email: "pending@x.ac.th",
      tenant_role: "user" as const,
      status: "invited",
      created_at: new Date("2026-06-28T00:00:00Z"), // 31 days before NOW
    };
    expect(derive_invitation_display(invitation, NOW, 30)).toEqual({ is_expired: true });
    expect(
      derive_invitation_display(
        { ...invitation, created_at: new Date("2026-07-01T00:00:00Z") },
        NOW,
        30,
      ),
    ).toEqual({ is_expired: false });
    expect(
      derive_invitation_display({ ...invitation, status: "revoked" }, NOW, 30),
    ).toEqual({ is_expired: false });
  });

  it("reads the TTL from CLERK_INVITATION_TTL_DAYS with a 30-day default", () => {
    expect(invitation_ttl_days()).toBe(30);
    process.env.CLERK_INVITATION_TTL_DAYS = "45";
    expect(invitation_ttl_days()).toBe(45);
    process.env.CLERK_INVITATION_TTL_DAYS = "not-a-number";
    expect(invitation_ttl_days()).toBe(30);
  });
});
