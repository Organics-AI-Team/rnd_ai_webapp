import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { setup_commercial_indexes } from "../../apps/ai/scripts/setup-commercial-indexes";
import { bootstrap_super_admin } from "../../apps/ai/scripts/bootstrap-super-admin";
import { create_user_profile_repository } from "../../apps/ai/server/repositories/user-profile-repository";
import { create_tenant_repository } from "../../apps/ai/server/repositories/tenant-repository";
import { create_membership_repository } from "../../apps/ai/server/repositories/membership-repository";

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db("identity_projections_test");
  await setup_commercial_indexes(db);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

beforeEach(async () => {
  for (const name of [
    "user_profiles",
    "tenants",
    "tenant_membership_projections",
    "tenant_invitation_projections",
    "platform_audit_events",
  ]) {
    await db.collection(name).deleteMany({});
  }
});

/**
 * Insert a minimal tenant document for index tests.
 *
 * @param overrides - Field overrides.
 * @returns Insertable tenant document.
 */
function tenant_doc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: `tenant-${Math.random().toString(36).slice(2, 10)}`,
    name: "Test University",
    type: "university",
    status: "provisioning",
    planKey: "standard",
    dataResidencyRegion: "sgp",
    provisioningKey: `prov-${Math.random().toString(36).slice(2, 12)}`,
    createdByProfileId: "000000000000000000000001",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("partial unique external identifiers", () => {
  it("allows many null external IDs but rejects duplicate present IDs", async () => {
    const tenants = db.collection("tenants");
    await tenants.insertMany([tenant_doc(), tenant_doc()]);
    await tenants.insertOne(tenant_doc({ clerkOrganizationId: "org_1" }));
    await expect(
      tenants.insertOne(tenant_doc({ clerkOrganizationId: "org_1" })),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("rejects duplicate clerkUserId on user profiles", async () => {
    const profiles = db.collection("user_profiles");
    await profiles.insertOne({ clerkUserId: "user_1", primaryEmail: "a@x.com", displayName: "A", status: "active" });
    await expect(
      profiles.insertOne({ clerkUserId: "user_1", primaryEmail: "b@x.com", displayName: "B", status: "active" }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("rejects duplicate present clerkMembershipId but allows nulls", async () => {
    const memberships = db.collection("tenant_membership_projections");
    await memberships.insertMany([
      { tenantId: "000000000000000000000010", userProfileId: "000000000000000000000020", tenantRole: "user", status: "invited" },
      { tenantId: "000000000000000000000011", userProfileId: "000000000000000000000021", tenantRole: "user", status: "invited" },
    ]);
    await memberships.insertOne({ tenantId: "000000000000000000000012", userProfileId: "000000000000000000000022", tenantRole: "user", status: "active", clerkMembershipId: "mem_1" });
    await expect(
      memberships.insertOne({ tenantId: "000000000000000000000013", userProfileId: "000000000000000000000023", tenantRole: "user", status: "active", clerkMembershipId: "mem_1" }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("setup is idempotent under repeated invocation", async () => {
    await setup_commercial_indexes(db);
    await setup_commercial_indexes(db);
    const indexes = await db.collection("tenants").listIndexes().toArray();
    const names = indexes.map((index) => index.name);
    expect(names.filter((n) => n === "uniq_tenant_clerk_org_present")).toHaveLength(1);
  });
});

describe("commercial AI indexes", () => {
  it("creates the uniqueness, queue, replay, budget, rollout, and operations indexes used by repositories", async () => {
    const expected: Record<string, readonly string[]> = {
      tenant_ai_profiles: ["uniq_tenant_ai_profile_tenant"],
      agent_deployments: [
        "uniq_agent_deployment_revision",
        "idx_agent_deployment_active_lookup",
      ],
      platform_ai_state: ["uniq_platform_ai_state_key"],
      ai_rollout_assignments: ["uniq_ai_rollout_assignment_tenant"],
      ai_rollout_events: [
        "uniq_ai_rollout_event_idempotency",
        "idx_ai_rollout_event_replay",
      ],
      ai_runs: [
        "uniq_ai_run_tenant_idempotency",
        "uniq_ai_run_correlation",
        "idx_ai_run_tenant_status_created",
      ],
      ai_usage_ledger: [
        "uniq_ai_usage_tenant_idempotency",
        "idx_ai_usage_tenant_month",
        "idx_ai_usage_tenant_run_kind",
      ],
      ai_usage_counters: ["uniq_ai_usage_counter_tenant_month"],
      ai_artifacts: ["uniq_ai_artifact_run_content"],
      ai_approvals: [
        "uniq_ai_approval_idempotency",
        "idx_ai_approval_run_checkpoint_status",
        "idx_ai_approval_artifact_status",
      ],
      ai_run_jobs: [
        "uniq_ai_run_job_command",
        "idx_ai_run_job_available",
        "idx_ai_run_job_expired_lease",
      ],
      ai_run_events: [
        "uniq_ai_run_event_sequence",
        "idx_ai_run_event_replay",
      ],
      ai_tool_usage_events: ["uniq_ai_tool_usage_tenant_idempotency"],
      ai_tool_results: ["uniq_ai_tool_result_tenant_idempotency"],
      ai_commercial_events: ["idx_ai_commercial_event_occurred"],
      ai_incidents: ["idx_ai_incident_active_started"],
    };

    for (const [collection, required_names] of Object.entries(expected)) {
      const names = new Set(
        (await db.collection(collection).listIndexes().toArray()).map(
          (index) => index.name,
        ),
      );
      for (const name of required_names) expect(names.has(name)).toBe(true);
    }
  });
});

describe("membership uniqueness", () => {
  it("rejects a duplicate tenant/profile membership", async () => {
    const memberships = create_membership_repository(db);
    await memberships.create_membership({
      tenant_id: "000000000000000000000010",
      user_profile_id: "000000000000000000000020",
      tenant_role: "manager",
      status: "active",
    });
    await expect(
      memberships.create_membership({
        tenant_id: "000000000000000000000010",
        user_profile_id: "000000000000000000000020",
        tenant_role: "user",
        status: "invited",
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});

describe("active-record repositories", () => {
  it("finds tenants by Clerk organization ID only while active", async () => {
    const tenants = create_tenant_repository(db);
    const created = await tenants.create_tenant({
      slug: "chula",
      name: "Chulalongkorn University",
      plan_key: "standard",
      data_residency_region: "sgp",
      provisioning_key: "prov-chula-1",
      created_by_profile_id: "000000000000000000000001",
    });
    await db.collection("tenants").updateOne(
      { _id: created._id },
      { $set: { clerkOrganizationId: "org_chula", status: "active" } },
    );
    const found = await tenants.find_active_by_clerk_organization_id("org_chula");
    expect(found?.slug).toBe("chula");

    await db.collection("tenants").updateOne(
      { _id: created._id },
      { $set: { status: "suspended" } },
    );
    expect(await tenants.find_active_by_clerk_organization_id("org_chula")).toBeNull();
  });

  it("rejects inactive user profiles from active lookups", async () => {
    const profiles = create_user_profile_repository(db);
    await profiles.create_user_profile({
      clerk_user_id: "user_9",
      primary_email: "s@x.com",
      display_name: "Suspended",
    });
    await db.collection("user_profiles").updateOne(
      { clerkUserId: "user_9" },
      { $set: { status: "suspended" } },
    );
    expect(await profiles.find_active_by_clerk_user_id("user_9")).toBeNull();
  });

  it("returns only active memberships for a profile", async () => {
    const memberships = create_membership_repository(db);
    await memberships.create_membership({
      tenant_id: "000000000000000000000010",
      user_profile_id: "000000000000000000000020",
      tenant_role: "manager",
      status: "active",
    });
    await memberships.create_membership({
      tenant_id: "000000000000000000000011",
      user_profile_id: "000000000000000000000020",
      tenant_role: "user",
      status: "revoked",
    });
    const active = await memberships.find_active_memberships_for_profile(
      "000000000000000000000020",
    );
    expect(active).toHaveLength(1);
    expect(active[0]?.tenantRole).toBe("manager");
  });
});

describe("bootstrap super admin", () => {
  it("creates exactly one super admin and refuses a second bootstrap", async () => {
    const first = await bootstrap_super_admin(db, {
      clerk_user_id: "user_admin",
      email: "root@platform.example",
    });
    expect(first.created).toBe(true);

    const audit = await db.collection("platform_audit_events").find({}).toArray();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("bootstrap_super_admin");

    await expect(
      bootstrap_super_admin(db, {
        clerk_user_id: "user_admin_2",
        email: "other@platform.example",
      }),
    ).rejects.toThrow(/already/i);
  });
});
