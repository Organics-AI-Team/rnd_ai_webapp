import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { grant_platform_role_by_email } from "../../apps/ai/scripts/grant-platform-role";

let server: MongoMemoryServer;
let client: MongoClient;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
});
afterAll(async () => {
  await client.close();
  await server.stop();
});

describe("grant_platform_role_by_email", () => {
  it("grants once, is idempotent, and audits exactly one change", async () => {
    const db = client.db("g1");
    await db.collection("user_profiles").insertOne({
      clerkUserId: "user_1",
      primaryEmail: "IT@organicscosme.com",
      status: "active",
      platformRole: null,
    });

    const first = await grant_platform_role_by_email(db, "it@organicscosme.com", "super_admin", "actor1");
    expect(first).toBe("granted");
    const doc = await db.collection("user_profiles").findOne({ clerkUserId: "user_1" });
    expect(doc?.platformRole).toBe("super_admin");

    const second = await grant_platform_role_by_email(db, "it@organicscosme.com", "super_admin", "actor1");
    expect(second).toBe("already");
    expect(
      await db.collection("platform_audit_events").countDocuments({ action: "grant_platform_role" }),
    ).toBe(1);
  });

  it("reports pending_first_sign_in for unknown emails and touches nothing", async () => {
    const db = client.db("g2");
    const out = await grant_platform_role_by_email(db, "dev@ireadcustomer.com", "super_admin", "actor1");
    expect(out).toBe("pending_first_sign_in");
    expect(await db.collection("user_profiles").countDocuments()).toBe(0);
  });

  it("refuses inactive profiles", async () => {
    const db = client.db("g3");
    await db.collection("user_profiles").insertOne({
      clerkUserId: "user_2",
      primaryEmail: "ai@organicscosme.com",
      status: "suspended",
      platformRole: null,
    });
    const out = await grant_platform_role_by_email(db, "ai@organicscosme.com", "super_admin", "actor1");
    expect(out).toBe("profile_inactive");
  });
});
