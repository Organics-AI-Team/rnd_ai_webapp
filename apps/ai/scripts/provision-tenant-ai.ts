/**
 * Idempotent operator script: AI-enable an EXISTING tenant by creating, if
 * missing (create-or-get, safe to re-run):
 *
 * 1. One `tenant_ai_profiles` document (status "active"), derived from the
 *    plan entitlement catalogue so the tenant layer never narrows below plan.
 * 2. One ACTIVE `agent_deployments` document (revision 1) per requested agent
 *    key, pinned to the build's orchestrator/schema versions.
 * 3. One `ai_rollout_assignments` document (executor "agentic", cohort
 *    "internal", version 1) pointing at the formulation deployment — written
 *    through the sanctioned rollout repository (super-admin check, active
 *    deployment check, audit event, transaction).
 *
 * After provisioning (non-dry-run) the effective policy is compiled through
 * ai-policy-repository as a fail-closed acceptance check.
 *
 * Env: MONGODB_URI (or DATABASE_URL), IMPORT_TENANT_ID,
 *      IMPORT_ACTOR_PROFILE_ID (active super-admin user_profiles _id),
 *      PROVISION_PLAN_KEY (default "growth"),
 *      GRANT_AGENT_KEYS (csv, default "formulation,raw_material_research"),
 *      PROVISION_PROVIDERS / PROVISION_MODELS (csv, default from the plan),
 *      PROVISION_ROLLOUT_AGENT_KEY (default "formulation"),
 *      PROVISION_RETENTION_DAYS, PROVISION_KNOWLEDGE_STORAGE_LIMIT_BYTES,
 *      PROVISION_ROLLOUT_REASON.
 * Usage: IMPORT_TENANT_ID=<tenant> IMPORT_ACTOR_PROFILE_ID=<profile> \
 *          npm run provision:tenant-ai -w apps/ai [-- --dry-run]
 */

import { ObjectId, type Db, type Document } from "mongodb";
import { get_specialist, ORCHESTRATOR_VERSION } from "@rnd-ai/ai-orchestration";
import {
  AGENT_RUN_INPUT_SCHEMA_VERSION,
  AGENT_RUN_OUTPUT_SCHEMA_VERSION,
} from "@rnd-ai/shared-types";
import { create_ai_policy_repository } from "../server/repositories/ai-policy-repository";
import { create_ai_rollout_repository } from "../server/repositories/ai-rollout-repository";
import {
  PLAN_ENTITLEMENTS,
  type PlanEntitlement,
} from "../server/services/ai-control/plan-entitlements";
import {
  build_platform_layer,
  PLATFORM_PROVIDER_UNIVERSE,
} from "../server/services/ai-control/platform-ai-constraints";
import { is_dry_run, mongo_uri, target_identity } from "./import/import.config";

/** Documented defaults for fields no policy layer reads (operator-tunable). */
const DEFAULT_PLAN_KEY = "growth";
const DEFAULT_AGENT_KEYS = ["formulation", "raw_material_research"] as const;
const DEFAULT_ROLLOUT_AGENT_KEY = "formulation";
const DEFAULT_RETENTION_DAYS = 365;
const DEFAULT_KNOWLEDGE_STORAGE_LIMIT_BYTES = 5_368_709_120; // 5 GiB
const DEFAULT_ROLLOUT_REASON = "Initial AI enablement (provision-tenant-ai)";
/** Semantic version suffix for first-revision agent definition pins. */
const AGENT_DEFINITION_SEMVER = "1.0.0";

/** Per-record outcome of one create-or-get step. */
export type ProvisionOutcome = "created" | "exists" | "would_create";

/** Explicit inputs of one provisioning run (env-free for tests). */
export interface ProvisionTenantAIOptions {
  /** Existing tenant _id (hex string) to AI-enable. */
  readonly tenant_id: string;
  /** Active super-admin user_profiles _id used for all provenance fields. */
  readonly actor_profile_id: string;
  /** Plan entitlement key; defaults to the growth plan. */
  readonly plan_key?: string;
  /** Agent keys that receive an active deployment. */
  readonly agent_keys?: readonly string[];
  /** Provider allowlist override; defaults to the plan's providers. */
  readonly providers?: readonly string[];
  /** Model allowlist override; defaults to the plan's models. */
  readonly models?: readonly string[];
  /** Agent key whose deployment the rollout assignment targets. */
  readonly rollout_agent_key?: string;
  /** Report without writing when true. */
  readonly dry_run?: boolean;
  /** Data retention window stored on the profile (days). */
  readonly retention_days?: number;
  /** Tenant knowledge storage ceiling stored on the profile (bytes). */
  readonly knowledge_storage_limit_bytes?: number;
  /** Operator reason recorded on the rollout audit event. */
  readonly rollout_reason?: string;
  /** Clock override for deterministic tests. */
  readonly now?: () => Date;
}

/** Summary of one provisioning run for the operator log and tests. */
export interface ProvisionTenantAISummary {
  readonly tenant_id: string;
  readonly plan_key: string;
  readonly dry_run: boolean;
  readonly profile: ProvisionOutcome;
  readonly deployments: Readonly<Record<string, ProvisionOutcome>>;
  readonly rollout: ProvisionOutcome;
  /** Compiled acceptance snapshot; null on dry-run. */
  readonly compiled: {
    readonly enabled: boolean;
    readonly provider_models: Readonly<Record<string, readonly string[]>>;
    readonly allowed_tools: readonly string[];
  } | null;
}

/**
 * Build a tenantId match filter spanning both stored ObjectId/string encodings.
 *
 * @param tenant_id - Verified tenant _id (hex string).
 * @returns Mongo filter for the tenantId field.
 */
function tenant_filter(tenant_id: string): Document {
  const values: (string | ObjectId)[] = [tenant_id];
  if (ObjectId.isValid(tenant_id)) values.push(new ObjectId(tenant_id));
  return { tenantId: { $in: values } };
}

/**
 * Parse an identifier that must be a Mongo ObjectId hex string.
 *
 * @param value - Raw identifier from env/options.
 * @param name - Field name used in the error message.
 * @returns The parsed ObjectId.
 * @throws Error when the value is not a valid ObjectId.
 */
function required_object_id(value: string, name: string): ObjectId {
  if (!ObjectId.isValid(value)) {
    throw new Error(`${name} must be a valid ObjectId hex string, got "${value}"`);
  }
  return new ObjectId(value);
}

/**
 * Look up a plan entitlement, failing with the known keys listed.
 *
 * @param plan_key - Requested plan key.
 * @returns The plan entitlement record.
 * @throws Error when the plan key is unknown.
 */
function required_plan(plan_key: string): PlanEntitlement {
  const plan = PLAN_ENTITLEMENTS[plan_key];
  if (!plan) {
    throw new Error(
      `Unknown plan "${plan_key}"; known plans: ${Object.keys(PLAN_ENTITLEMENTS).join(", ")}`,
    );
  }
  return plan;
}

/**
 * Resolve and validate the provider/model allowlists against the platform
 * universe, so a typo can never provision an empty effective model set.
 *
 * @param plan - Plan entitlement providing the production defaults.
 * @param providers - Optional provider override (PROVISION_PROVIDERS).
 * @param models - Optional model override (PROVISION_MODELS).
 * @returns Validated provider and model arrays.
 * @throws Error when a provider or model is outside the platform universe.
 */
function resolve_model_catalog(
  plan: PlanEntitlement,
  providers?: readonly string[],
  models?: readonly string[],
): { providers: string[]; models: string[] } {
  const resolved_providers = [...(providers ?? plan.allowed_providers)];
  const resolved_models = [...(models ?? plan.allowed_models)];
  for (const provider of resolved_providers) {
    if (!PLATFORM_PROVIDER_UNIVERSE[provider]) {
      throw new Error(
        `Provider "${provider}" is outside the platform universe (${Object.keys(PLATFORM_PROVIDER_UNIVERSE).join(", ")})`,
      );
    }
  }
  const model_universe = new Set(
    resolved_providers.flatMap((provider) => PLATFORM_PROVIDER_UNIVERSE[provider]),
  );
  for (const model of resolved_models) {
    if (!model_universe.has(model)) {
      throw new Error(
        `Model "${model}" is not offered by providers [${resolved_providers.join(", ")}]`,
      );
    }
  }
  return { providers: resolved_providers, models: resolved_models };
}

/**
 * Convert a plan bigint limit to the plain number stored on profile documents
 * (mirrors the existing control-plane fixtures; to_bigint re-coerces on read).
 *
 * @param value - Plan entitlement bigint limit.
 * @returns The same value as a safe integer number.
 * @throws Error when the limit exceeds Number.MAX_SAFE_INTEGER.
 */
function limit_number(value: bigint): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) {
    throw new Error(`Plan limit ${value} does not fit a safe integer`);
  }
  return numeric;
}

/**
 * Derive one deployment's tool allowlist. The rollout-primary agent keeps the
 * full plan grant (it runs approval-gated commit tools such as
 * formula.confirm); a registered specialist is narrowed to its delegation
 * registry allowlist — the same list delegate-tool-factory enforces at
 * delegation time — intersected with the plan.
 *
 * @param agent_key - Deployment agent key.
 * @param plan_tools - The plan's allowed tools.
 * @param rollout_agent_key - The tenant's primary (rollout target) agent key.
 * @returns Tool allowlist for the deployment document.
 */
function deployment_tool_allowlist(
  agent_key: string,
  plan_tools: readonly string[],
  rollout_agent_key: string,
): string[] {
  if (agent_key === rollout_agent_key) return [...plan_tools];
  const specialist = get_specialist(agent_key);
  if (!specialist) return [...plan_tools];
  return plan_tools.filter((tool) => specialist.tool_allowlist.includes(tool));
}

/**
 * Verify the tenant exists and the actor is an active platform super admin
 * before any write, so partial provisioning cannot start from bad identifiers.
 *
 * @param db - Connected Mongo database.
 * @param tenant_id - Tenant ObjectId.
 * @param actor_profile_id - Actor profile ObjectId.
 * @throws Error when the tenant is missing or the actor is not a super admin.
 */
async function assert_provision_preconditions(
  db: Db,
  tenant_id: ObjectId,
  actor_profile_id: ObjectId,
): Promise<void> {
  const [tenant, actor] = await Promise.all([
    db.collection("tenants").findOne({ _id: tenant_id }, { projection: { _id: 1 } }),
    db.collection("user_profiles").findOne(
      { _id: actor_profile_id, status: "active", platformRole: "super_admin" },
      { projection: { _id: 1 } },
    ),
  ]);
  if (!tenant) {
    throw new Error(`Tenant ${tenant_id.toHexString()} does not exist; provision it first`);
  }
  if (!actor) {
    throw new Error(
      `Actor ${actor_profile_id.toHexString()} is not an active super_admin user profile`,
    );
  }
}

/**
 * Create the tenant AI profile if missing (create-or-get; never mutates an
 * existing profile).
 *
 * @param db - Connected Mongo database.
 * @param input - Resolved provisioning inputs.
 * @returns The step outcome.
 */
async function ensure_profile(
  db: Db,
  input: {
    tenant_id: ObjectId;
    actor_profile_id: ObjectId;
    plan_key: string;
    plan: PlanEntitlement;
    providers: readonly string[];
    models: readonly string[];
    retention_days: number;
    knowledge_storage_limit_bytes: number;
    dry_run: boolean;
    now: Date;
  },
): Promise<ProvisionOutcome> {
  const profiles = db.collection("tenant_ai_profiles");
  const existing = await profiles.findOne(tenant_filter(input.tenant_id.toHexString()));
  if (existing) {
    console.log("[provision:tenant-ai] profile exists", { status: existing.status });
    return "exists";
  }
  if (input.dry_run) return "would_create";
  const platform = build_platform_layer();
  try {
    await profiles.insertOne({
      tenantId: input.tenant_id,
      status: "active",
      planKey: input.plan_key,
      policyVersion: 1,
      allowedProviders: [...input.providers],
      allowedModels: [...input.models],
      allowedTools: [...input.plan.allowed_tools],
      monthlyRequestLimit: limit_number(input.plan.monthly_request_limit),
      monthlyTokenLimit: limit_number(input.plan.monthly_token_limit),
      monthlyCostLimitMicrousd: limit_number(input.plan.monthly_cost_limit_microusd),
      perUserMonthlyRequestLimit: limit_number(input.plan.per_user_monthly_request_limit),
      perUserMonthlyTokenLimit: limit_number(input.plan.per_user_monthly_token_limit),
      perUserMonthlyCostLimitMicrousd: limit_number(
        input.plan.per_user_monthly_cost_limit_microusd,
      ),
      perRunTokenLimit: limit_number(input.plan.per_run_token_limit),
      perRunCostLimitMicrousd: limit_number(input.plan.per_run_cost_limit_microusd),
      maxConcurrentRuns: input.plan.max_concurrent_runs,
      maxIterations: input.plan.max_iterations,
      defaultLocale: platform.default_locale,
      retentionDays: input.retention_days,
      allowWebSearch: input.plan.allowed_tools.includes("web.search"),
      allowTenantKnowledge: true,
      knowledgeStorageLimitBytes: input.knowledge_storage_limit_bytes,
      reviewPolicy: { ...input.plan.approval_rules },
      qualityPolicy: null,
      createdByProfileId: input.actor_profile_id,
      updatedByProfileId: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
    return "created";
  } catch (error) {
    // Unique tenantId index: a concurrent run created it first.
    if ((error as { code?: number }).code === 11000) return "exists";
    throw error;
  }
}

/**
 * Create one ACTIVE agent deployment if the tenant has none for the agent key
 * (create-or-get). Fresh tenants receive revision 1; if retired/draft
 * revisions already exist the next free revision is used so the unique
 * (tenantId, agentKey, revision) index cannot conflict.
 *
 * @param db - Connected Mongo database.
 * @param input - Resolved provisioning inputs.
 * @param agent_key - Agent key for this deployment.
 * @returns Outcome plus the active deployment _id (null on dry-run create).
 */
async function ensure_deployment(
  db: Db,
  input: {
    tenant_id: ObjectId;
    actor_profile_id: ObjectId;
    plan: PlanEntitlement;
    providers: readonly string[];
    models: readonly string[];
    rollout_agent_key: string;
    dry_run: boolean;
    now: Date;
  },
  agent_key: string,
): Promise<{ outcome: ProvisionOutcome; deployment_id: ObjectId | null }> {
  const deployments = db.collection("agent_deployments");
  const scope = { ...tenant_filter(input.tenant_id.toHexString()), agentKey: agent_key };
  const active = await deployments.findOne({ ...scope, status: "active" });
  if (active) return { outcome: "exists", deployment_id: active._id };
  if (input.dry_run) return { outcome: "would_create", deployment_id: null };

  const latest = await deployments.findOne(scope, { sort: { revision: -1 } });
  const revision = typeof latest?.revision === "number" ? latest.revision + 1 : 1;
  const document = {
    tenantId: input.tenant_id,
    agentKey: agent_key,
    revision,
    status: "active",
    agentDefinitionVersion: `${agent_key.replace(/_/g, "-")}-${AGENT_DEFINITION_SEMVER}`,
    orchestratorVersion: ORCHESTRATOR_VERSION,
    promptVersionId: new ObjectId(),
    allowedProviders: [...input.providers],
    allowedModels: [...input.models],
    temperature: null,
    maxOutputTokens: null,
    modelRouting: null,
    toolAllowlist: deployment_tool_allowlist(
      agent_key,
      input.plan.allowed_tools,
      input.rollout_agent_key,
    ),
    approvalRules: { ...input.plan.approval_rules },
    featureFlags: null,
    inputSchemaVersion: AGENT_RUN_INPUT_SCHEMA_VERSION,
    outputSchemaVersion: AGENT_RUN_OUTPUT_SCHEMA_VERSION,
    activatedByProfileId: input.actor_profile_id,
    activatedAt: input.now,
    retiredAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
  try {
    const inserted = await deployments.insertOne(document);
    return { outcome: "created", deployment_id: inserted.insertedId };
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const concurrent = await deployments.findOne({ ...scope, status: "active" });
      if (concurrent) return { outcome: "exists", deployment_id: concurrent._id };
    }
    throw error;
  }
}

/**
 * Create the internal-cohort agentic rollout assignment if the tenant has
 * none, through the sanctioned rollout repository (transactional, audited,
 * super-admin and active-deployment checked). An existing assignment is left
 * untouched regardless of its state — rollout mutations belong to the
 * set-ai-rollout / rollback-ai-rollout operator scripts.
 *
 * @param db - Connected Mongo database (client must support transactions).
 * @param input - Resolved provisioning inputs.
 * @param deployment_id - Active rollout-target deployment _id (null on dry-run).
 * @returns The step outcome.
 * @throws Error when a real run has no rollout-target deployment available.
 */
async function ensure_rollout(
  db: Db,
  input: {
    tenant_id: ObjectId;
    actor_profile_id: ObjectId;
    rollout_agent_key: string;
    rollout_reason: string;
    dry_run: boolean;
    now: Date;
  },
  deployment_id: ObjectId | null,
): Promise<ProvisionOutcome> {
  const existing = await db
    .collection("ai_rollout_assignments")
    .findOne({ tenantId: input.tenant_id });
  if (existing) {
    console.log("[provision:tenant-ai] rollout exists", {
      executor: existing.executor,
      status: existing.status,
      version: existing.version,
    });
    return "exists";
  }
  if (input.dry_run) return "would_create";
  if (!deployment_id) {
    throw new Error(
      `No active "${input.rollout_agent_key}" deployment available for the rollout assignment`,
    );
  }
  await create_ai_rollout_repository(db).assign(
    {
      tenant_id: input.tenant_id.toHexString(),
      executor: "agentic",
      deployment_id: deployment_id.toHexString(),
      cohort: "internal",
      actor_profile_id: input.actor_profile_id.toHexString(),
      reason: input.rollout_reason,
      expected_version: null,
    },
    input.now,
  );
  return "created";
}

/**
 * AI-enable an existing tenant: create-or-get its AI profile, active agent
 * deployments, and internal-cohort agentic rollout assignment, then compile
 * the effective policy as a fail-closed acceptance check.
 *
 * @param db - Connected Mongo database (transactions required unless dry-run).
 * @param options - Explicit provisioning inputs (see ProvisionTenantAIOptions).
 * @returns Per-record outcome summary plus the compiled policy snapshot.
 * @throws Error on invalid identifiers, unknown plan/provider/model, missing
 *         tenant/super-admin, or a policy that fails to compile.
 */
export async function provision_tenant_ai(
  db: Db,
  options: ProvisionTenantAIOptions,
): Promise<ProvisionTenantAISummary> {
  const started_at = new Date();
  const tenant_id = required_object_id(options.tenant_id, "IMPORT_TENANT_ID");
  const actor_profile_id = required_object_id(
    options.actor_profile_id,
    "IMPORT_ACTOR_PROFILE_ID",
  );
  const plan_key = options.plan_key ?? DEFAULT_PLAN_KEY;
  const plan = required_plan(plan_key);
  const agent_keys = options.agent_keys?.length ? options.agent_keys : DEFAULT_AGENT_KEYS;
  const rollout_agent_key = options.rollout_agent_key ?? DEFAULT_ROLLOUT_AGENT_KEY;
  const dry_run = options.dry_run ?? false;
  const now = (options.now ?? (() => new Date()))();
  const { providers, models } = resolve_model_catalog(plan, options.providers, options.models);
  console.log("[provision:tenant-ai] start", {
    at: started_at.toISOString(),
    tenant_id: options.tenant_id,
    plan_key,
    agent_keys,
    providers,
    models,
    dry_run,
  });

  await assert_provision_preconditions(db, tenant_id, actor_profile_id);

  const profile = await ensure_profile(db, {
    tenant_id,
    actor_profile_id,
    plan_key,
    plan,
    providers,
    models,
    retention_days: options.retention_days ?? DEFAULT_RETENTION_DAYS,
    knowledge_storage_limit_bytes:
      options.knowledge_storage_limit_bytes ?? DEFAULT_KNOWLEDGE_STORAGE_LIMIT_BYTES,
    dry_run,
    now,
  });

  const deployments: Record<string, ProvisionOutcome> = {};
  let rollout_deployment_id: ObjectId | null = null;
  for (const agent_key of agent_keys) {
    const result = await ensure_deployment(
      db,
      { tenant_id, actor_profile_id, plan, providers, models, rollout_agent_key, dry_run, now },
      agent_key,
    );
    deployments[agent_key] = result.outcome;
    if (agent_key === rollout_agent_key) rollout_deployment_id = result.deployment_id;
  }
  if (!rollout_deployment_id && !dry_run) {
    // The rollout target may pre-exist outside GRANT_AGENT_KEYS.
    const active = await db.collection("agent_deployments").findOne({
      ...tenant_filter(tenant_id.toHexString()),
      agentKey: rollout_agent_key,
      status: "active",
    });
    rollout_deployment_id = active?._id ?? null;
  }

  const rollout = await ensure_rollout(
    db,
    {
      tenant_id,
      actor_profile_id,
      rollout_agent_key,
      rollout_reason: options.rollout_reason ?? DEFAULT_ROLLOUT_REASON,
      dry_run,
      now,
    },
    rollout_deployment_id,
  );

  // Acceptance: the provisioned documents must compile into an effective
  // policy for the primary agent (fail-closed; throws on any layer conflict).
  let compiled: ProvisionTenantAISummary["compiled"] = null;
  if (!dry_run) {
    const result = await create_ai_policy_repository(db).compile_for_tenant(
      tenant_id.toHexString(),
      rollout_agent_key,
    );
    compiled = {
      enabled: result.policy.enabled,
      provider_models: result.policy.provider_models,
      allowed_tools: result.policy.allowed_tools,
    };
  }

  const summary: ProvisionTenantAISummary = {
    tenant_id: tenant_id.toHexString(),
    plan_key,
    dry_run,
    profile,
    deployments,
    rollout,
    compiled,
  };
  console.log("[provision:tenant-ai] done", {
    at: new Date().toISOString(),
    elapsed_ms: Date.now() - started_at.getTime(),
    ...summary,
  });
  return summary;
}

/**
 * Read an optional csv env variable into a trimmed string array.
 *
 * @param name - Environment variable name.
 * @returns Parsed values, or undefined when unset/empty.
 */
function csv_env(name: string): string[] | undefined {
  const values = (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

/**
 * Read an optional positive-integer env variable.
 *
 * @param name - Environment variable name.
 * @returns Parsed integer, or undefined when unset/unparseable.
 */
function positive_int_env(name: string): number | undefined {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * CLI entry: resolve env inputs, connect via the shared database client, and
 * provision the tenant.
 *
 * @throws Error when required env vars are missing or provisioning fails.
 */
async function run_cli(): Promise<void> {
  void mongo_uri();
  const { tenant_id, actor_profile_id } = target_identity();
  const { default: client_promise } = await import("@rnd-ai/shared-database");
  const client = await client_promise;
  try {
    const summary = await provision_tenant_ai(client.db(), {
      tenant_id,
      actor_profile_id,
      plan_key: process.env.PROVISION_PLAN_KEY?.trim() || DEFAULT_PLAN_KEY,
      agent_keys: csv_env("GRANT_AGENT_KEYS") ?? DEFAULT_AGENT_KEYS,
      providers: csv_env("PROVISION_PROVIDERS"),
      models: csv_env("PROVISION_MODELS"),
      rollout_agent_key:
        process.env.PROVISION_ROLLOUT_AGENT_KEY?.trim() || DEFAULT_ROLLOUT_AGENT_KEY,
      dry_run: is_dry_run(),
      retention_days: positive_int_env("PROVISION_RETENTION_DAYS"),
      knowledge_storage_limit_bytes: positive_int_env(
        "PROVISION_KNOWLEDGE_STORAGE_LIMIT_BYTES",
      ),
      rollout_reason: process.env.PROVISION_ROLLOUT_REASON?.trim() || undefined,
    });
    console.log("provision:tenant-ai — summary", JSON.stringify(summary, null, 2));
  } finally {
    await client.close();
  }
}

if (process.argv[1]?.includes("provision-tenant-ai")) {
  run_cli().catch((error) => {
    console.error("[provision:tenant-ai] failed:", error?.message ?? error);
    process.exitCode = 1;
  });
}
