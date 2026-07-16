/**
 * G3.2 — effective tenant AI policy compiler tests.
 *
 * Proves the merge is monotonically restrictive: a tenant cannot enable a
 * forbidden provider/tool, exceed plan quotas/iterations, relax an approval, or
 * select an unapproved deployment. Also covers fail-closed disablement, empty
 * provider/model rejection, request-preference validation, key-order-
 * independent hashing, and the explainable constraint trace. A final block
 * exercises the repository against an in-memory MongoDB.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  compile_effective_policy,
  compile_effective_policy_with_trace,
  type PlatformPolicyLayer,
  type PolicyLayer,
  type PolicyLayers,
} from "../../apps/ai/server/services/ai-control/policy-compiler";
import { build_platform_layer } from "../../apps/ai/server/services/ai-control/platform-ai-constraints";
import { build_plan_layer } from "../../apps/ai/server/services/ai-control/plan-entitlements";
import { create_ai_policy_repository } from "../../apps/ai/server/repositories/ai-policy-repository";
import { ToolGovernanceError } from "../../apps/ai/server/services/ai-control/errors";

const HUGE = 1_000_000_000n;

/**
 * Build a permissive narrowing layer (plan/tenant/deployment) that constrains
 * nothing unless overridden. Numeric limits default high so the min() never
 * picks them unless a test lowers one.
 *
 * @param overrides - Partial fields to override.
 * @returns A PolicyLayer fixture.
 */
function make_layer(overrides: Partial<PolicyLayer> = {}): PolicyLayer {
  return {
    enabled: true,
    allowed_providers: ["google"],
    allowed_models: ["gemini-2.5-flash", "gemini-2.5-pro"],
    allowed_tools: [
      "formula.search",
      "formula.confirm",
      "knowledge.search",
      "web.search",
    ],
    monthly_request_limit: HUGE,
    monthly_token_limit: HUGE,
    monthly_cost_limit_microusd: HUGE,
    per_user_monthly_request_limit: HUGE,
    per_user_monthly_token_limit: HUGE,
    per_user_monthly_cost_limit_microusd: HUGE,
    per_run_token_limit: HUGE,
    per_run_cost_limit_microusd: HUGE,
    max_concurrent_runs: 100,
    max_iterations: 100,
    approval_rules: {},
    ...overrides,
  };
}

/**
 * Build a permissive platform layer owning a two-model universe.
 *
 * @param overrides - Partial fields to override.
 * @returns A PlatformPolicyLayer fixture.
 */
function make_platform(
  overrides: Partial<PlatformPolicyLayer> = {},
): PlatformPolicyLayer {
  return {
    ...make_layer(),
    provider_universe: {
      google: ["gemini-2.5-flash", "gemini-2.5-pro"],
    },
    default_locale: "th-TH",
    approval_rules: { "formula.confirm": "manager" },
    ...overrides,
  };
}

/**
 * Assemble the four ordered layers into a PolicyLayers input.
 *
 * @param parts - Optional per-layer overrides.
 * @returns PolicyLayers fixture.
 */
function make_layers(parts: Partial<PolicyLayers> = {}): PolicyLayers {
  return {
    tenant_id: "507f1f77bcf86cd7994390a1",
    version: 1,
    platform: make_platform(),
    plan: make_layer(),
    tenant: make_layer(),
    deployment: make_layer(),
    ...parts,
  };
}

describe("compile_effective_policy — monotonic restriction", () => {
  it("intersects tools so a tenant cannot enable a plan-forbidden tool", () => {
    const policy = compile_effective_policy(
      make_layers({
        plan: make_layer({ allowed_tools: ["knowledge.search"] }),
        tenant: make_layer({
          allowed_tools: ["knowledge.search", "formula.confirm", "web.search"],
        }),
      }),
    );
    expect(policy.allowed_tools).toEqual(["knowledge.search"]);
  });

  it("intersects providers/models so a tenant cannot enable a forbidden model", () => {
    const policy = compile_effective_policy(
      make_layers({
        plan: make_layer({ allowed_models: ["gemini-2.5-flash"] }),
        tenant: make_layer({
          allowed_models: ["gemini-2.5-flash", "gemini-2.5-pro"],
        }),
      }),
    );
    expect(policy.provider_models).toEqual({ google: ["gemini-2.5-flash"] });
  });

  it("takes the minimum limit so a tenant cannot exceed a plan quota", () => {
    const policy = compile_effective_policy(
      make_layers({
        plan: make_layer({ per_run_token_limit: 10_000n, max_iterations: 8 }),
        tenant: make_layer({
          per_run_token_limit: 999_999n,
          max_iterations: 50,
        }),
      }),
    );
    expect(policy.per_run_token_limit).toBe(10_000n);
    expect(policy.max_iterations).toBe(8);
  });

  it("keeps the strongest approval so a tenant cannot relax it", () => {
    const policy = compile_effective_policy(
      make_layers({
        // tenant tries to downgrade formula.confirm to "none"
        tenant: make_layer({ approval_rules: { "formula.confirm": "none" } }),
      }),
    );
    expect(policy.approval_rules["formula.confirm"]).toBe("manager");
  });

  it("matches the plan's narrowing anchor (tools/limit/approval together)", () => {
    const policy = compile_effective_policy(
      make_layers({
        plan: make_layer({
          allowed_tools: ["knowledge.search"],
          per_run_token_limit: 10_000n,
        }),
        tenant: make_layer({
          allowed_tools: ["knowledge.search", "formula.confirm"],
          per_run_token_limit: 50_000n,
          approval_rules: { "formula.confirm": "none" },
        }),
      }),
    );
    expect(policy.allowed_tools).toEqual(["knowledge.search"]);
    expect(policy.per_run_token_limit).toBe(10_000n);
    expect(policy.approval_rules["formula.confirm"]).toBe("manager");
  });

  it("disables the policy when any layer is disabled (false wins)", () => {
    const policy = compile_effective_policy(
      make_layers({ tenant: make_layer({ enabled: false }) }),
    );
    expect(policy.enabled).toBe(false);
  });

  it("rejects an unapproved deployment (its empty tool set intersects to none)", () => {
    const policy = compile_effective_policy(
      make_layers({ deployment: make_layer({ allowed_tools: [] }) }),
    );
    expect(policy.allowed_tools).toEqual([]);
  });

  it("rejects an empty provider/model intersection on an enabled policy", () => {
    expect(() =>
      compile_effective_policy(
        make_layers({ tenant: make_layer({ allowed_models: ["nonexistent"] }) }),
      ),
    ).toThrowError(ToolGovernanceError);
    try {
      compile_effective_policy(
        make_layers({ tenant: make_layer({ allowed_providers: ["openai"] }) }),
      );
    } catch (error) {
      expect((error as ToolGovernanceError).code).toBe("POLICY_NO_PROVIDER");
    }
  });
});

describe("compile_effective_policy — request preferences", () => {
  it("rejects an unknown preference field with POLICY_INPUT_INVALID", () => {
    try {
      compile_effective_policy(
        make_layers({
          request_preferences: { escalate_privileges: true } as never,
        }),
      );
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as ToolGovernanceError).code).toBe("POLICY_INPUT_INVALID");
    }
  });

  it("rejects a model alias outside the effective allowlist", () => {
    try {
      compile_effective_policy(
        make_layers({ request_preferences: { model_alias: "gpt-4" } }),
      );
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as ToolGovernanceError).code).toBe("POLICY_INPUT_INVALID");
    }
  });

  it("accepts a response language and narrows the locale", () => {
    const policy = compile_effective_policy(
      make_layers({ request_preferences: { response_language: "en-US" } }),
    );
    expect(policy.default_locale).toBe("en-US");
  });
});

describe("compile_effective_policy — hashing and trace", () => {
  it("hashes independently of object key order", () => {
    const a = compile_effective_policy(
      make_layers({
        platform: make_platform({
          approval_rules: { "formula.confirm": "manager", "formula.draft": "none" },
        }),
      }),
    );
    const b = compile_effective_policy(
      make_layers({
        platform: make_platform({
          approval_rules: { "formula.draft": "none", "formula.confirm": "manager" },
        }),
      }),
    );
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes the hash when a limit changes", () => {
    const a = compile_effective_policy(make_layers());
    const b = compile_effective_policy(
      make_layers({ plan: make_layer({ per_run_token_limit: 1n }) }),
    );
    expect(a.hash).not.toBe(b.hash);
  });

  it("names the constraining layer in the trace", () => {
    const { constraint_trace } = compile_effective_policy_with_trace(
      make_layers({
        plan: make_layer({ per_run_token_limit: 10_000n }),
        tenant: make_layer({ max_iterations: 5 }),
      }),
    );
    expect(constraint_trace.per_run_token_limit).toBe("plan");
    expect(constraint_trace.max_iterations).toBe("tenant");
  });
});

describe("platform + plan layer builders", () => {
  it("plan entitlements never widen the platform universe once compiled", () => {
    const policy = compile_effective_policy({
      tenant_id: "507f1f77bcf86cd7994390a1",
      version: 1,
      platform: build_platform_layer({} as NodeJS.ProcessEnv),
      plan: build_plan_layer("starter"),
      tenant: make_layer(),
      deployment: make_layer(),
    });
    // starter grants only flash + a 2-tool subset
    expect(policy.provider_models).toEqual({ google: ["gemini-2.5-flash"] });
    expect(policy.allowed_tools.sort()).toEqual(
      ["formula.search", "knowledge.search"].sort(),
    );
  });

  it("rejects an unknown plan key", () => {
    expect(() => build_plan_layer("mystery")).toThrowError(ToolGovernanceError);
  });
});

describe("ai-policy-repository (in-memory MongoDB)", () => {
  let server: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  const TENANT = "507f1f77bcf86cd7994390a1";

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = new MongoClient(server.getUri());
    await client.connect();
    db = client.db("test");
  });

  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });

  beforeEach(async () => {
    for (const name of [
      "tenant_ai_profiles",
      "agent_deployments",
      "ai_runs",
      "platform_ai_state",
    ]) {
      await db.collection(name).deleteMany({});
    }
  });

  it("compiles from stored profile + deployment and pins the snapshot on a run", async () => {
    await db.collection("tenant_ai_profiles").insertOne({
      tenantId: new ObjectId(TENANT),
      status: "active",
      planKey: "growth",
      policyVersion: 3,
      allowedProviders: ["google"],
      allowedModels: ["gemini-2.5-flash", "gemini-2.5-pro"],
      allowedTools: ["formula.search", "formula.confirm", "knowledge.search"],
      monthlyRequestLimit: 40_000,
      monthlyTokenLimit: 400_000_000,
      monthlyCostLimitMicrousd: 4_000_000_000,
      perUserMonthlyRequestLimit: 8_000,
      perUserMonthlyTokenLimit: 40_000_000,
      perUserMonthlyCostLimitMicrousd: 400_000_000,
      perRunTokenLimit: 300_000,
      perRunCostLimitMicrousd: 3_000_000,
      maxConcurrentRuns: 8,
      maxIterations: 12,
      defaultLocale: "th-TH",
      reviewPolicy: { "formula.confirm": "manager" },
    });
    await db.collection("agent_deployments").insertOne({
      tenantId: new ObjectId(TENANT),
      agentKey: "formulation",
      revision: 2,
      status: "active",
      promptVersionId: new ObjectId(),
      allowedProviders: ["google"],
      allowedModels: ["gemini-2.5-flash"],
      toolAllowlist: ["formula.search", "formula.confirm", "knowledge.search"],
      approvalRules: { "formula.confirm": "manager" },
    });
    const run_id = new ObjectId();
    await db.collection("ai_runs").insertOne({
      _id: run_id,
      tenantId: new ObjectId(TENANT),
      status: "queued",
    });

    const repo = create_ai_policy_repository(db);
    const compiled = await repo.compile_for_tenant(TENANT, "formulation");

    expect(compiled.policy.enabled).toBe(true);
    // deployment narrows models to flash only
    expect(compiled.policy.provider_models).toEqual({
      google: ["gemini-2.5-flash"],
    });
    // growth plan's per-run token limit (400k) is below the tenant's 300k? tenant is lower
    expect(compiled.policy.per_run_token_limit).toBe(300_000n);
    expect(compiled.policy.approval_rules["formula.confirm"]).toBe("manager");
    expect(compiled.deployment_id).not.toBeNull();

    await repo.persist_run_snapshot(String(run_id), compiled.policy);
    const run = await db.collection("ai_runs").findOne({ _id: run_id });
    expect(run?.policyVersion).toBe(3);
    expect(run?.policyHash).toBe(compiled.policy.hash);
    expect(run?.policySnapshot.allowed_tools).toContain("formula.search");
  });

  it("fails closed when no active profile exists", async () => {
    const repo = create_ai_policy_repository(db);
    await expect(
      repo.compile_for_tenant(TENANT, "formulation"),
    ).rejects.toMatchObject({ code: "POLICY_DISABLED" });
  });

  it("disables new admissions while the platform emergency control is active", async () => {
    await db.collection("tenant_ai_profiles").insertOne({
      tenantId: new ObjectId(TENANT),
      status: "active",
      planKey: "growth",
      policyVersion: 4,
      allowedProviders: ["google"],
      allowedModels: ["gemini-2.5-flash"],
      allowedTools: ["formula.search"],
    });
    await db.collection("platform_ai_state").insertOne({
      key: "singleton",
      emergencyDisabled: true,
    });

    const compiled = await create_ai_policy_repository(db).compile_for_tenant(
      TENANT,
      "formulation",
    );

    expect(compiled.policy.enabled).toBe(false);
    expect(compiled.constraint_trace.enabled).toBe("platform");
  });
});
