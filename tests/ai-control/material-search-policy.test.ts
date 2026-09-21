import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { PLATFORM_TOOL_UNIVERSE } from "../../apps/ai/server/services/ai-control/platform-ai-constraints";
import { PLAN_ENTITLEMENTS } from "../../apps/ai/server/services/ai-control/plan-entitlements";
import {
  get_specialist,
  is_read_only_specialist,
} from "../../packages/ai-orchestration/src/delegation/delegation-registry";
import { grant_tool_to_tenant } from "../../apps/ai/scripts/grant-tool-allowlist";

describe("material.search policy layers", () => {
  it("is in the platform tool universe", () => {
    expect(PLATFORM_TOOL_UNIVERSE).toContain("material.search");
  });

  it("is granted by the growth and enterprise plans", () => {
    expect(PLAN_ENTITLEMENTS.growth!.allowed_tools).toContain("material.search");
    expect(PLAN_ENTITLEMENTS.enterprise!.allowed_tools).toContain("material.search");
  });

  it("is available to the formulation and research specialists, keeping research read-only", () => {
    expect(get_specialist("formulation")?.tool_allowlist).toContain("material.search");
    expect(get_specialist("raw_material_research")?.tool_allowlist).toContain("material.search");
    expect(is_read_only_specialist(get_specialist("raw_material_research")!)).toBe(true);
  });
});

describe("grant_tool_to_tenant (ops script core)", () => {
  let server: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  const TENANT = new ObjectId();

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = new MongoClient(server.getUri());
    await client.connect();
    db = client.db("grant");
    await db.collection("tenant_ai_profiles").insertOne({
      tenantId: TENANT,
      status: "active",
      allowedTools: ["formula.search", "knowledge.search"],
    });
    await db.collection("agent_deployments").insertMany([
      { tenantId: TENANT, agentKey: "formulation", status: "active", toolAllowlist: ["formula.search"] },
      { tenantId: TENANT, agentKey: "formulation", status: "retired", toolAllowlist: ["formula.search"] },
      { tenantId: new ObjectId(), agentKey: "formulation", status: "active", toolAllowlist: [] },
    ]);
  });
  afterAll(async () => {
    await client.close();
    await server.stop();
  });

  it("adds the tool to the profile and ONLY this tenant's active deployments, idempotently", async () => {
    const first = await grant_tool_to_tenant(db, TENANT.toHexString(), "material.search", ["formulation"]);
    expect(first.profiles_matched).toBe(1);
    expect(first.deployments_updated).toBe(1);

    const second = await grant_tool_to_tenant(db, TENANT.toHexString(), "material.search", ["formulation"]);
    expect(second.deployments_updated).toBe(0); // $addToSet — already present

    const profile = await db.collection("tenant_ai_profiles").findOne({ tenantId: TENANT });
    expect(profile?.allowedTools).toContain("material.search");
    const foreign = await db
      .collection("agent_deployments")
      .findOne({ tenantId: { $ne: TENANT }, agentKey: "formulation" });
    expect(foreign?.toolAllowlist).not.toContain("material.search");
    const retired = await db
      .collection("agent_deployments")
      .findOne({ tenantId: TENANT, status: "retired" });
    expect(retired?.toolAllowlist).not.toContain("material.search");
  });
});
