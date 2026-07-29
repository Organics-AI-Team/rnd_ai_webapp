// tests/integration/member-admin-ports.test.ts
/**
 * Plan 3 Task 2 — production member-admin ports over a real replica set.
 *
 * Transactions require a replica set (plain MongoMemoryServer cannot run
 * withTransaction; see tests/integration/ai-rollout.test.ts for the
 * pattern). The Clerk backend is a narrow injected recording fake, so no
 * CLERK_SECRET_KEY is needed.
 */
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  create_production_member_admin_ports,
  type MemberAdminClerkLike,
} from "../../apps/ai/server/services/provisioning/production-member-ports";
import { DuplicatePendingInvitationError } from "../../apps/ai/server/services/provisioning/member-admin-ports";

let repl: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;

const TENANT = new ObjectId("507f1f77bcf86cd799439031");
const PROFILE = new ObjectId("507f1f77bcf86cd799439001");

/**
 * Build a recording narrow Clerk fake.
 *
 * @param overrides - Optional error injections per method.
 * @returns Fake clerk view plus the recorded call list.
 */
function recording_clerk(
  overrides: {
    revoke_error?: Error & { status?: number };
    invitation_error?: Error & { errors?: Array<{ code: string }> };
  } = {},
) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const clerk: MemberAdminClerkLike = {
    organizations: {
      async createOrganizationInvitation(params) {
        calls.push({ method: "createOrganizationInvitation", params });
        if (overrides.invitation_error) throw overrides.invitation_error;
        return { id: "inv_created", emailAddress: params.emailAddress, role: params.role };
      },
      async getOrganizationInvitationList() {
        return { data: [] };
      },
      async revokeOrganizationInvitation(params) {
        calls.push({ method: "revokeOrganizationInvitation", params });
        if (overrides.revoke_error) throw overrides.revoke_error;
        return {};
      },
      async updateOrganizationMembership(params) {
        calls.push({ method: "updateOrganizationMembership", params });
        return {};
      },
      async deleteOrganizationMembership(params) {
        calls.push({ method: "deleteOrganizationMembership", params });
        return {};
      },
    },
  };
  return { clerk, calls };
}

beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = new MongoClient(repl.getUri());
  await client.connect();
  db = client.db("test_member_admin_ports");
}, 60_000);

afterAll(async () => {
  await client.close();
  await repl.stop();
});

beforeEach(async () => {
  delete process.env.CLERK_ORG_ROLE_MODE;
  await Promise.all([
    db.collection("tenants").deleteMany({}),
    db.collection("user_profiles").deleteMany({}),
    db.collection("tenant_membership_projections").deleteMany({}),
    db.collection("tenant_invitation_projections").deleteMany({}),
    db.collection("platform_audit_events").deleteMany({}),
  ]);
  await db.collection("tenants").insertOne({
    _id: TENANT,
    clerkOrganizationId: "org_test",
    status: "active",
  });
  await db.collection("user_profiles").insertOne({
    _id: PROFILE,
    clerkUserId: "user_test",
    primaryEmail: "member@x.ac.th",
    status: "active",
  });
  await db.collection("tenant_membership_projections").insertOne({
    clerkMembershipId: "orgmem_1",
    tenantId: TENANT.toHexString(),
    userProfileId: PROFILE.toHexString(),
    tenantRole: "manager",
    status: "active",
    clerkSyncedAt: new Date(0),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

describe("clerk member-admin calls", () => {
  it("removes a membership by resolved organization and user ids", async () => {
    const world = recording_clerk();
    const ports = create_production_member_admin_ports(db, world.clerk);
    await ports.clerk.remove_membership(TENANT.toHexString(), PROFILE.toHexString());
    expect(world.calls).toEqual([
      {
        method: "deleteOrganizationMembership",
        params: { organizationId: "org_test", userId: "user_test" },
      },
    ]);
  });

  it("maps internal roles through CLERK_ORG_ROLE_MODE on role updates", async () => {
    const world = recording_clerk();
    const ports = create_production_member_admin_ports(db, world.clerk);
    await ports.clerk.update_membership_role(TENANT.toHexString(), PROFILE.toHexString(), "user");
    process.env.CLERK_ORG_ROLE_MODE = "built_in";
    await ports.clerk.update_membership_role(TENANT.toHexString(), PROFILE.toHexString(), "manager");
    expect(world.calls[0]!.params.role).toBe("org:user");
    expect(world.calls[1]!.params.role).toBe("org:admin");
  });

  it("revokes an invitation against the tenant's organization and tolerates 4xx", async () => {
    const tolerated = Object.assign(new Error("already revoked"), { status: 400 });
    const world = recording_clerk({ revoke_error: tolerated });
    const ports = create_production_member_admin_ports(db, world.clerk);
    await expect(
      ports.clerk.revoke_invitation(TENANT.toHexString(), "inv_1"),
    ).resolves.toBeUndefined();
    expect(world.calls[0]).toEqual({
      method: "revokeOrganizationInvitation",
      params: { organizationId: "org_test", invitationId: "inv_1" },
    });
  });

  it("translates Clerk duplicate-pending rejections into the typed CONFLICT error", async () => {
    const duplicate = Object.assign(new Error("duplicate"), {
      errors: [{ code: "duplicate_record" }],
    });
    const world = recording_clerk({ invitation_error: duplicate });
    const ports = create_production_member_admin_ports(db, world.clerk);
    await expect(
      ports.clerk.create_user_invitation("org_test", "member@x.ac.th"),
    ).rejects.toBeInstanceOf(DuplicatePendingInvitationError);
  });
});

describe("membership projections", () => {
  it("finds, updates status/role, and counts active managers", async () => {
    const ports = create_production_member_admin_ports(db, recording_clerk().clerk);
    const found = await ports.memberships.find_membership(
      TENANT.toHexString(),
      PROFILE.toHexString(),
    );
    expect(found).toEqual({ tenant_role: "manager", status: "active" });
    expect(await ports.memberships.count_active_managers(TENANT.toHexString())).toBe(1);
    await ports.memberships.set_membership_status(
      TENANT.toHexString(),
      PROFILE.toHexString(),
      "suspended",
    );
    expect(await ports.memberships.count_active_managers(TENANT.toHexString())).toBe(0);
    await ports.memberships.set_membership_role(
      TENANT.toHexString(),
      PROFILE.toHexString(),
      "user",
    );
    expect(
      await ports.memberships.find_membership(TENANT.toHexString(), PROFILE.toHexString()),
    ).toEqual({ tenant_role: "user", status: "suspended" });
  });

  it("rolls a transactional write back when the operation throws", async () => {
    const ports = create_production_member_admin_ports(db, recording_clerk().clerk);
    await expect(
      ports.transactions.run(async (session) => {
        await ports.memberships.set_membership_status(
          TENANT.toHexString(),
          PROFILE.toHexString(),
          "revoked",
          session,
        );
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const membership = await ports.memberships.find_membership(
      TENANT.toHexString(),
      PROFILE.toHexString(),
    );
    expect(membership?.status).toBe("active");
  });
});

describe("invitation projections", () => {
  it("finds by clerk id within the tenant and marks status", async () => {
    await db.collection("tenant_invitation_projections").insertOne({
      clerkInvitationId: "inv_9",
      tenantId: TENANT.toHexString(),
      emailNormalized: "pending@x.ac.th",
      tenantRole: "user",
      status: "invited",
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date(),
    });
    const ports = create_production_member_admin_ports(db, recording_clerk().clerk);
    const found = await ports.invitations.find_by_clerk_id(TENANT.toHexString(), "inv_9");
    expect(found).toMatchObject({
      clerk_invitation_id: "inv_9",
      email: "pending@x.ac.th",
      tenant_role: "user",
      status: "invited",
    });
    expect(await ports.invitations.find_by_clerk_id("other_tenant", "inv_9")).toBeNull();
    await ports.invitations.mark_status(TENANT.toHexString(), "inv_9", "revoked");
    expect(
      (await ports.invitations.find_by_clerk_id(TENANT.toHexString(), "inv_9"))?.status,
    ).toBe("revoked");
  });
});
