// tests/integration/last-manager-invariant.test.ts
/**
 * Plan 3 Task 6 — last-manager invariant over real Mongo transactions.
 *
 * Uses MongoMemoryReplSet (transactions are unavailable on a plain
 * MongoMemoryServer) and the PRODUCTION member-admin ports with a passing
 * Clerk fake, so the transaction + tenant-touch write-conflict guard is
 * exercised for real, including the concurrent-demote race.
 */
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { demote_manager } from "../../apps/ai/server/services/provisioning/demote-manager";
import { LastManagerError } from "../../apps/ai/server/services/provisioning/member-admin-ports";
import {
  create_production_member_admin_ports,
  type MemberAdminClerkLike,
} from "../../apps/ai/server/services/provisioning/production-member-ports";
import { platform_admin_principal } from "../provisioning/helpers/fake-member-admin-ports";

let repl: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;

const TENANT = new ObjectId("507f1f77bcf86cd7994390b1");
const MANAGER_A = new ObjectId("507f1f77bcf86cd7994390c1");
const MANAGER_B = new ObjectId("507f1f77bcf86cd7994390c2");

/** Clerk fake whose admin calls always succeed. */
function passing_clerk(): MemberAdminClerkLike {
  return {
    organizations: {
      async createOrganizationInvitation(params) {
        return { id: "inv_x", emailAddress: params.emailAddress, role: params.role };
      },
      async getOrganizationInvitationList() {
        return { data: [] };
      },
      async revokeOrganizationInvitation() {
        return {};
      },
      async updateOrganizationMembership() {
        return {};
      },
      async deleteOrganizationMembership() {
        return {};
      },
    },
  };
}

/** Seed one active tenant with two active managers. */
async function seed_two_managers(): Promise<void> {
  await db.collection("tenants").insertOne({
    _id: TENANT,
    clerkOrganizationId: "org_invariant",
    status: "active",
  });
  await db.collection("user_profiles").insertMany([
    { _id: MANAGER_A, clerkUserId: "user_a", status: "active" },
    { _id: MANAGER_B, clerkUserId: "user_b", status: "active" },
  ]);
  await db.collection("tenant_membership_projections").insertMany([
    {
      clerkMembershipId: "orgmem_a",
      tenantId: TENANT.toHexString(),
      userProfileId: MANAGER_A.toHexString(),
      tenantRole: "manager",
      status: "active",
      clerkSyncedAt: new Date(0),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      clerkMembershipId: "orgmem_b",
      tenantId: TENANT.toHexString(),
      userProfileId: MANAGER_B.toHexString(),
      tenantRole: "manager",
      status: "active",
      clerkSyncedAt: new Date(0),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);
}

/** Count active managers in the seeded tenant. */
async function active_manager_count(): Promise<number> {
  return db.collection("tenant_membership_projections").countDocuments({
    tenantId: TENANT.toHexString(),
    tenantRole: "manager",
    status: "active",
  });
}

beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = new MongoClient(repl.getUri());
  await client.connect();
  db = client.db("test_last_manager");
}, 60_000);

afterAll(async () => {
  await client.close();
  await repl.stop();
});

beforeEach(async () => {
  await Promise.all([
    db.collection("tenants").deleteMany({}),
    db.collection("user_profiles").deleteMany({}),
    db.collection("tenant_membership_projections").deleteMany({}),
    db.collection("platform_audit_events").deleteMany({}),
  ]);
  await seed_two_managers();
});

describe("last-manager invariant (transactional)", () => {
  it("allows demoting down to one manager and refuses the last one", async () => {
    const ports = create_production_member_admin_ports(db, passing_clerk());
    await expect(
      demote_manager(
        platform_admin_principal,
        { tenant_id: TENANT.toHexString(), user_profile_id: MANAGER_B.toHexString() },
        ports,
      ),
    ).resolves.toEqual({ success: true, changed: true });
    await expect(
      demote_manager(
        platform_admin_principal,
        { tenant_id: TENANT.toHexString(), user_profile_id: MANAGER_A.toHexString() },
        ports,
      ),
    ).rejects.toBeInstanceOf(LastManagerError);
    expect(await active_manager_count()).toBe(1);
  });

  it("serializes concurrent demotions of the two last managers — exactly one wins", async () => {
    const ports = create_production_member_admin_ports(db, passing_clerk());
    const results = await Promise.allSettled([
      demote_manager(
        platform_admin_principal,
        { tenant_id: TENANT.toHexString(), user_profile_id: MANAGER_A.toHexString() },
        ports,
      ),
      demote_manager(
        platform_admin_principal,
        { tenant_id: TENANT.toHexString(), user_profile_id: MANAGER_B.toHexString() },
        ports,
      ),
    ]);
    const fulfilled = results.filter((entry) => entry.status === "fulfilled");
    const rejected = results.filter(
      (entry): entry is PromiseRejectedResult => entry.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(LastManagerError);
    // The write-conflict guard (tenant-document touch) prevents write-skew:
    // one active manager must remain, never zero.
    expect(await active_manager_count()).toBe(1);
  }, 30_000);
});
