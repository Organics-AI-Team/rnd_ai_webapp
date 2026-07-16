import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { TenantExecutionContext } from "@rnd-ai/shared-types";
import { create_production_run_gateway } from "../../apps/ai/server/services/ai-gateway/run-api-runtime";
import { create_production_agentic_runtime_loader } from "../../apps/ai/server/services/ai-gateway/production-run-runtime";

let repl: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;

const TENANT = "507f1f77bcf86cd7994390a1";
const ACTOR = "507f1f77bcf86cd79943a001";
const PROMPT = new ObjectId();
const DEPLOYMENT = new ObjectId("507f1f77bcf86cd7994390d1");
const ROLLOUT_ASSIGNMENT = new ObjectId("507f1f77bcf86cd7994390c1");

const tenant: TenantExecutionContext = Object.freeze({
  tenant_id: TENANT,
  actor_profile_id: ACTOR,
  clerk_user_id: "user_test",
  clerk_organization_id: "org_test",
  membership_id: "507f1f77bcf86cd79943a002",
  tenant_role: "manager",
  permissions: ["ai:run"],
  access_mode: "member",
  support_grant_id: null,
  correlation_id: "corr-request-runtime",
  request_started_at: "2026-07-16T00:00:00.000Z",
});

beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = new MongoClient(repl.getUri());
  await client.connect();
  db = client.db("run_api_runtime");
  await db.collection("ai_runs").createIndex({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
  await db.collection("ai_runs").createIndex({ correlationId: 1 }, { unique: true });
  await db.collection("ai_run_jobs").createIndex(
    { runId: 1, command: 1, idempotencyKey: 1 },
    { unique: true },
  );
  await db.collection("ai_usage_ledger").createIndex(
    { tenantId: 1, idempotencyKey: 1 },
    { unique: true },
  );
  await db.collection("ai_rollout_assignments").createIndex({ tenantId: 1 }, { unique: true });
}, 60_000);

afterAll(async () => {
  await client.close();
  await repl.stop();
});

beforeEach(async () => {
  await Promise.all([
    db.collection("tenant_ai_profiles").deleteMany({}),
    db.collection("agent_deployments").deleteMany({}),
    db.collection("ai_runs").deleteMany({}),
    db.collection("ai_run_jobs").deleteMany({}),
    db.collection("ai_usage_ledger").deleteMany({}),
    db.collection("ai_usage_counters").deleteMany({}),
    db.collection("ai_rollout_assignments").deleteMany({}),
    db.collection("user_profiles").deleteMany({}),
    db.collection("tenant_membership_projections").deleteMany({}),
    db.collection("platform_ai_state").deleteMany({}),
  ]);
  await db.collection("user_profiles").insertOne({
    _id: new ObjectId(ACTOR),
    clerkUserId: "user_test",
    status: "active",
  });
  await db.collection("tenant_membership_projections").insertOne({
    _id: new ObjectId("507f1f77bcf86cd79943a002"),
    tenantId: TENANT,
    userProfileId: ACTOR,
    tenantRole: "manager",
    status: "active",
  });
  await db.collection("tenant_ai_profiles").insertOne({
    tenantId: new ObjectId(TENANT),
    status: "active",
    planKey: "growth",
    policyVersion: 7,
    allowedProviders: ["google"],
    allowedModels: ["gemini-2.5-flash"],
    allowedTools: ["formula.search", "knowledge.search"],
    monthlyRequestLimit: 1000,
    monthlyTokenLimit: 10_000_000,
    monthlyCostLimitMicrousd: 100_000_000,
    perUserMonthlyRequestLimit: 100,
    perUserMonthlyTokenLimit: 1_000_000,
    perUserMonthlyCostLimitMicrousd: 10_000_000,
    perRunTokenLimit: 50_000,
    perRunCostLimitMicrousd: 500_000,
    maxConcurrentRuns: 3,
    maxIterations: 8,
    defaultLocale: "en-US",
    reviewPolicy: {},
  });
  await db.collection("agent_deployments").insertOne({
    _id: DEPLOYMENT,
    tenantId: new ObjectId(TENANT),
    agentKey: "raw_material_research",
    revision: 3,
    status: "active",
    promptVersionId: PROMPT,
    agentDefinitionVersion: "raw-material-research-1.0.0",
    orchestratorVersion: "agentic-1.0.0",
    inputSchemaVersion: "1",
    outputSchemaVersion: "1",
    allowedProviders: ["google"],
    allowedModels: ["gemini-2.5-flash"],
    toolAllowlist: ["formula.search", "knowledge.search"],
    approvalRules: {},
  });
  await db.collection("ai_rollout_assignments").insertOne({
    _id: ROLLOUT_ASSIGNMENT,
    tenantId: new ObjectId(TENANT),
    executor: "agentic",
    deploymentId: DEPLOYMENT,
    cohort: "internal",
    status: "active",
    assignedByProfileId: new ObjectId(ACTOR),
    reason: "Credential-free runtime integration",
    activatedAt: new Date("2026-07-16T00:00:00.000Z"),
    rolledBackAt: null,
    version: 4,
    createdAt: new Date("2026-07-16T00:00:00.000Z"),
    updatedAt: new Date("2026-07-16T00:00:00.000Z"),
  });
});

describe("production run API gateway composition", () => {
  it("accepts and durably admits a governed run without provider credentials", async () => {
    const gateway = create_production_run_gateway(client, db, {
      now: () => new Date("2026-07-16T00:00:00.000Z"),
      correlation_id: () => "corr-runtime-run",
    });
    const accepted = await gateway.create_run(tenant, {
      schema_version: "1",
      thread_id: "507f1f77bcf86cd79943e001",
      agent_key: "raw_material_research",
      message: "Find a gentle surfactant with retrievable evidence.",
      attachment_source_ids: [],
      response_preferences: { language: "en", detail: "standard" },
      idempotency_key: "runtime-create-key-1",
    });

    expect(accepted).toMatchObject({ status: "accepted", executor: "agentic" });
    const run = await db.collection("ai_runs").findOne({ _id: new ObjectId(accepted.run_id) });
    expect(run).toMatchObject({
      tenantId: TENANT,
      actorProfileId: ACTOR,
      deploymentId: DEPLOYMENT.toHexString(),
      rolloutAssignmentId: ROLLOUT_ASSIGNMENT.toHexString(),
      rolloutAssignmentVersion: 4,
      promptVersionId: String(PROMPT),
      agentDefinitionVersion: "raw-material-research-1.0.0",
      orchestratorVersion: "agentic-1.0.0",
      inputSchemaVersion: "1",
      outputSchemaVersion: "1",
      contextPackHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      usageReservationId: expect.any(String),
      input: expect.objectContaining({ message: expect.stringContaining("surfactant") }),
    });
    expect(run?.policySnapshot).not.toHaveProperty("tenant_id", undefined);
    expect(await db.collection("ai_run_jobs").countDocuments({ runId: accepted.run_id })).toBe(1);
    expect(await db.collection("ai_usage_ledger").countDocuments({
      tenantId: TENANT,
      runId: accepted.run_id,
      kind: "reservation",
    })).toBe(1);
  });

  it("pins a rolled-back tenant to legacy and still enqueues one governed job", async () => {
    await db.collection("ai_rollout_assignments").updateOne(
      { _id: ROLLOUT_ASSIGNMENT },
      { $set: { executor: "legacy", status: "rolled_back", version: 5 } },
    );
    const gateway = create_production_run_gateway(client, db, {
      now: () => new Date("2026-07-16T00:00:00.000Z"),
      correlation_id: () => "corr-runtime-legacy",
    });

    const accepted = await gateway.create_run(tenant, {
      schema_version: "1",
      thread_id: "507f1f77bcf86cd79943e001",
      agent_key: "raw_material_research",
      message: "Use the tenant's rolled-back executor.",
      attachment_source_ids: [],
      response_preferences: { language: "en", detail: "standard" },
      idempotency_key: "runtime-legacy-key-1",
    });

    expect(accepted.executor).toBe("legacy");
    expect(await db.collection("ai_runs").findOne({ _id: new ObjectId(accepted.run_id) })).toMatchObject({
      executor: "legacy",
      rolloutAssignmentId: ROLLOUT_ASSIGNMENT.toHexString(),
      rolloutAssignmentVersion: 5,
    });
    expect(await db.collection("ai_run_jobs").countDocuments({ runId: accepted.run_id })).toBe(1);
  });

  it("rebuilds trusted runtime ports and rechecks emergency state per action", async () => {
    const gateway = create_production_run_gateway(client, db, {
      now: () => new Date("2026-07-16T00:00:00.000Z"),
      correlation_id: () => "corr-runtime-worker",
    });
    const accepted = await gateway.create_run(tenant, {
      schema_version: "1",
      thread_id: "507f1f77bcf86cd79943e001",
      agent_key: "raw_material_research",
      message: "Find evidence for a gentle surfactant.",
      attachment_source_ids: [],
      response_preferences: { language: "en", detail: "standard" },
      idempotency_key: "runtime-worker-key-1",
    });
    const run = await db.collection("ai_runs").findOne({ _id: new ObjectId(accepted.run_id) });
    const loader = create_production_agentic_runtime_loader(client, db, {
      gemini_api_key: "private-test-key",
      rate_card_version: "commercial-2026-07-v1",
      input_price_microusd_per_million_tokens: 1n,
      output_price_microusd_per_million_tokens: 2n,
      embedding_model: "gemini-embedding-001",
      embedding_version: "v1",
      embedding_dimensions: 768,
      now: () => new Date("2026-07-16T00:00:00.000Z"),
      next_id: () => "runtime-id",
    });

    const bundle = await loader(run!, {
      job_id: "job-runtime",
      tenant_id: TENANT,
      run_id: accepted.run_id,
      command: "start",
      attempts: 1,
    });
    expect(bundle.runtime.context).toMatchObject({
      tenant_id: TENANT,
      actor_profile_id: ACTOR,
      run_id: accepted.run_id,
    });
    expect(bundle.context_pack.pack_hash).toBe(run?.contextPackHash);
    await expect(bundle.runtime.policy.evaluate_action(
      { tool_name: "knowledge.search", arguments: { query: "surfactant" } },
      bundle.runtime.context,
    )).resolves.toEqual({ kind: "allowed" });

    await db.collection("platform_ai_state").insertOne({
      key: "singleton",
      emergencyDisabled: true,
    });
    await expect(bundle.runtime.policy.evaluate_action(
      { tool_name: "knowledge.search", arguments: { query: "surfactant" } },
      bundle.runtime.context,
    )).resolves.toMatchObject({
      kind: "denied",
      reason_code: "POLICY_EMERGENCY_DISABLED",
      fatal: true,
    });
  });

  it("wires configured web search only inside the private runtime", async () => {
    await Promise.all([
      db.collection("tenant_ai_profiles").updateOne(
        { tenantId: new ObjectId(TENANT) },
        { $set: { planKey: "enterprise", allowedTools: ["web.search"] } },
      ),
      db.collection("agent_deployments").updateOne(
        { _id: DEPLOYMENT },
        { $set: { toolAllowlist: ["web.search"] } },
      ),
    ]);
    const gateway = create_production_run_gateway(client, db, {
      now: () => new Date("2026-07-16T00:00:00.000Z"),
      correlation_id: () => "corr-runtime-web",
    });
    const accepted = await gateway.create_run(tenant, {
      schema_version: "1",
      thread_id: "507f1f77bcf86cd79943e001",
      agent_key: "raw_material_research",
      message: "Search public regulatory sources.",
      attachment_source_ids: [],
      response_preferences: { language: "en", detail: "standard" },
      idempotency_key: "runtime-web-key-1",
    });
    const run = await db.collection("ai_runs").findOne({
      _id: new ObjectId(accepted.run_id),
    });
    const fetch_impl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        items: [{
          title: "Official regulation",
          link: "https://example.gov/regulation",
          snippet: "Public evidence.",
        }],
      }), { status: 200 }),
    );
    const loader = create_production_agentic_runtime_loader(client, db, {
      gemini_api_key: "private-test-key",
      google_search_api_key: "private-search-key",
      google_search_cse_id: "approved-cse",
      web_search_fetch: fetch_impl,
      rate_card_version: "commercial-2026-07-v1",
      input_price_microusd_per_million_tokens: 1n,
      output_price_microusd_per_million_tokens: 2n,
      embedding_model: "gemini-embedding-001",
      embedding_version: "v1",
      embedding_dimensions: 768,
      now: () => new Date("2026-07-16T00:00:00.000Z"),
      next_id: () => "runtime-web-id",
    });
    const bundle = await loader(run!, {
      job_id: "job-runtime-web",
      tenant_id: TENANT,
      run_id: accepted.run_id,
      command: "start",
      attempts: 1,
    });

    await expect(bundle.runtime.ports.tools.execute({
      idempotency_key: "runtime-web-tool-1",
      tool_name: "web.search",
      arguments: { query: "public regulation", max_results: 1 },
      run_id: accepted.run_id,
      iteration: 1,
    }, bundle.runtime.context)).resolves.toMatchObject({
      status: "ok",
      output: {
        answer: "Official regulation: Public evidence.",
        sources: [{ url: "https://example.gov/regulation" }],
      },
    });
    expect(fetch_impl).toHaveBeenCalledOnce();
  });
});
