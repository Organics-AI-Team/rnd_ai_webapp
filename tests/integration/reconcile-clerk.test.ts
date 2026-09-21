import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

import { reconcile_tenant } from "../../apps/ai/server/services/provisioning/reconcile-clerk";

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db("reconcile_clerk");
}, 60_000);

afterAll(async () => {
  await client.close();
  await server.stop();
});

describe("reconcile_tenant", () => {
  it("repairs missing projections, marks role contradictions, and revokes orphans", async () => {
    const tenant_id = new ObjectId();
    const repaired_profile = new ObjectId();
    const contradictory_profile = new ObjectId();
    await db.collection("tenants").insertOne({
      _id: tenant_id,
      clerkOrganizationId: "org_1",
    });
    await db.collection("user_profiles").insertMany([
      { _id: repaired_profile, clerkUserId: "user_repaired" },
      { _id: contradictory_profile, clerkUserId: "user_contradictory" },
    ]);
    await db.collection("tenant_membership_projections").insertMany([
      {
        tenantId: tenant_id.toString(),
        userProfileId: contradictory_profile.toString(),
        clerkMembershipId: "mem_contradictory",
        tenantRole: "user",
        status: "active",
      },
      {
        tenantId: tenant_id.toString(),
        userProfileId: new ObjectId().toString(),
        clerkMembershipId: "mem_orphan",
        tenantRole: "user",
        status: "active",
      },
    ]);

    const report = await reconcile_tenant(db, tenant_id.toString(), {
      async list_clerk_memberships() {
        return [
          {
            id: "mem_repaired",
            clerk_user_id: "user_repaired",
            role: "org:member",
          },
          {
            id: "mem_contradictory",
            clerk_user_id: "user_contradictory",
            role: "org:admin",
          },
        ];
      },
    });

    expect(report.findings.map((finding) => finding.kind).sort()).toEqual([
      "contradictory_role_marked",
      "missing_projection_repaired",
      "orphaned_projection",
    ]);
    expect(await db.collection("tenant_membership_projections").findOne({
      clerkMembershipId: "mem_repaired",
    })).toMatchObject({ status: "active", tenantRole: "user" });
    expect(await db.collection("tenant_membership_projections").findOne({
      clerkMembershipId: "mem_contradictory",
    })).toMatchObject({ reconciliationRequired: true });
    expect(await db.collection("tenant_membership_projections").findOne({
      clerkMembershipId: "mem_orphan",
    })).toMatchObject({ status: "revoked" });
  });

  it("rejects a malformed tenant id before touching MongoDB", async () => {
    await expect(reconcile_tenant(db, "not-an-id", {
      async list_clerk_memberships() {
        return [];
      },
    })).rejects.toThrow("valid tenant id");
  });
});
