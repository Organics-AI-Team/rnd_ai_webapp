/**
 * Integration tests for the idempotent provision-tenant-ai operator script.
 *
 * A real Mongo replica set (transactions are required by the rollout
 * repository) with the production commercial indexes exercises the full
 * create-or-get flow: tenant AI profile, active agent deployments, and the
 * internal-cohort agentic rollout assignment. The acceptance bar is that
 * ai-policy-repository.compile_for_tenant succeeds against the created
 * documents.
 */

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { provision_tenant_ai } from "../../apps/ai/scripts/provision-tenant-ai";
import { setup_commercial_indexes } from "../../apps/ai/scripts/setup-commercial-indexes";
import { create_ai_policy_repository } from "../../apps/ai/server/repositories/ai-policy-repository";

let repl: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;

const TENANT = new ObjectId("507f1f77bcf86cd7994390a1");
const SUPER_ADMIN = new ObjectId("507f1f77bcf86cd7994390f1");
const NOW = new Date("2026-07-28T00:00:00.000Z");

const PROVISIONED_COLLECTIONS = [
  "tenants",
  "user_profiles",
  "tenant_ai_profiles",
  "agent_deployments",
  "ai_rollout_assignments",
  "ai_rollout_events",
] as const;

/**
 * Run the provisioner with the canonical test identity and defaults.
 *
 * @param dry_run - Whether to run in report-only mode.
 * @returns The provisioning summary.
 */
function provision(dry_run = false) {
  return provision_tenant_ai(db, {
    tenant_id: TENANT.toHexString(),
    actor_profile_id: SUPER_ADMIN.toHexString(),
    plan_key: "growth",
    agent_keys: ["formulation", "raw_material_research"],
    dry_run,
    now: () => NOW,
  });
}

beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = new MongoClient(repl.getUri());
  await client.connect();
  db = client.db("test_provision_tenant_ai");
  await setup_commercial_indexes(db);
}, 120_000);

afterAll(async () => {
  await client.close();
  await repl.stop();
});

beforeEach(async () => {
  await Promise.all(
    PROVISIONED_COLLECTIONS.map((name) => db.collection(name).deleteMany({})),
  );
  await db.collection("tenants").insertOne({
    _id: TENANT,
    slug: "test-university",
    name: "Test University",
    status: "active",
    planKey: "growth",
  });
  await db.collection("user_profiles").insertOne({
    _id: SUPER_ADMIN,
    clerkUserId: "user_super",
    platformRole: "super_admin",
    status: "active",
  });
});

describe("provision-tenant-ai operator script", () => {
  it("reports every record as would_create on dry-run and writes nothing", async () => {
    const summary = await provision(true);

    expect(summary).toMatchObject({
      dry_run: true,
      profile: "would_create",
      deployments: {
        formulation: "would_create",
        raw_material_research: "would_create",
      },
      rollout: "would_create",
      compiled: null,
    });
    expect(await db.collection("tenant_ai_profiles").countDocuments({})).toBe(0);
    expect(await db.collection("agent_deployments").countDocuments({})).toBe(0);
    expect(await db.collection("ai_rollout_assignments").countDocuments({})).toBe(0);
    expect(await db.collection("ai_rollout_events").countDocuments({})).toBe(0);
  });

  it("creates profile, deployments, and rollout once and is idempotent on re-run", async () => {
    const first = await provision();
    expect(first).toMatchObject({
      profile: "created",
      deployments: { formulation: "created", raw_material_research: "created" },
      rollout: "created",
    });

    const second = await provision();
    expect(second).toMatchObject({
      profile: "exists",
      deployments: { formulation: "exists", raw_material_research: "exists" },
      rollout: "exists",
    });

    expect(await db.collection("tenant_ai_profiles").countDocuments({})).toBe(1);
    expect(await db.collection("agent_deployments").countDocuments({})).toBe(2);
    expect(await db.collection("ai_rollout_assignments").countDocuments({})).toBe(1);
    expect(await db.collection("ai_rollout_events").countDocuments({})).toBe(1);

    const profile = await db.collection("tenant_ai_profiles").findOne({ tenantId: TENANT });
    expect(profile).toMatchObject({
      status: "active",
      planKey: "growth",
      policyVersion: 1,
      allowedProviders: ["google"],
      createdByProfileId: SUPER_ADMIN,
    });
    expect(profile?.allowedTools).toContain("material.search");
    expect(profile?.allowedTools).toContain("formula.confirm");

    const formulation = await db
      .collection("agent_deployments")
      .findOne({ tenantId: TENANT, agentKey: "formulation" });
    expect(formulation).toMatchObject({
      status: "active",
      revision: 1,
      orchestratorVersion: "agentic-1.0.0",
      inputSchemaVersion: "1",
      outputSchemaVersion: "1",
    });
    expect(formulation?.promptVersionId).toBeInstanceOf(ObjectId);
    expect(formulation?.toolAllowlist).toContain("formula.confirm");

    const specialist = await db
      .collection("agent_deployments")
      .findOne({ tenantId: TENANT, agentKey: "raw_material_research" });
    expect(specialist).toMatchObject({ status: "active", revision: 1 });
    // Registry-informed narrowing: the research specialist keeps read tools
    // only; the commit-class formula.confirm stays on the primary agent.
    expect(specialist?.toolAllowlist).toContain("material.search");
    expect(specialist?.toolAllowlist).not.toContain("formula.confirm");

    const assignment = await db
      .collection("ai_rollout_assignments")
      .findOne({ tenantId: TENANT });
    expect(assignment).toMatchObject({
      executor: "agentic",
      cohort: "internal",
      status: "active",
      version: 1,
      assignedByProfileId: SUPER_ADMIN,
      deploymentId: formulation?._id,
    });
  });

  it("provisions documents that compile into an enabled effective policy", async () => {
    const summary = await provision();
    expect(summary.compiled).toMatchObject({ enabled: true });

    const compiled = await create_ai_policy_repository(db).compile_for_tenant(
      TENANT.toHexString(),
      "formulation",
    );

    expect(compiled.policy.enabled).toBe(true);
    expect(compiled.policy.provider_models.google).toContain("gemini-2.5-flash");
    expect(compiled.policy.allowed_tools).toEqual(
      expect.arrayContaining(["formula.search", "formula.confirm", "material.search"]),
    );
    expect(compiled.deployment_id).not.toBeNull();
    expect(compiled.prompt_version_id).toMatch(/^[a-f0-9]{24}$/);
    expect(compiled.deployment_pins).toMatchObject({
      orchestrator_version: "agentic-1.0.0",
      input_schema_version: "1",
      output_schema_version: "1",
    });
  });

  it("fails closed when the tenant does not exist or the actor is not a super admin", async () => {
    await db.collection("tenants").deleteMany({});
    await expect(provision()).rejects.toThrow(/does not exist/);

    await db.collection("tenants").insertOne({ _id: TENANT, status: "active" });
    await db
      .collection("user_profiles")
      .updateOne({ _id: SUPER_ADMIN }, { $set: { platformRole: "admin" } });
    await expect(provision()).rejects.toThrow(/super_admin/);
    expect(await db.collection("tenant_ai_profiles").countDocuments({})).toBe(0);
  });
});
