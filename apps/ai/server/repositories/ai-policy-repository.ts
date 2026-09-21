/**
 * Tenant AI policy repository (G3.2).
 *
 * Loads a tenant's control-plane records (TenantAIProfile + the active
 * AgentDeployment), folds them with the platform and plan layers through the
 * policy compiler into a frozen EffectiveAIPolicy, and persists the canonical
 * snapshot + version on an AIRun. This is the only sanctioned path from stored
 * control-plane state to a compiled, hash-pinned policy.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { ObjectId, type Db, type Document } from "mongodb";
import type {
  AIApprovalRequirement,
  EffectiveAIPolicy,
} from "@rnd-ai/shared-types";
import { ToolGovernanceError } from "../services/ai-control/errors";
import { canonical_json } from "../services/ai-control/hashing";
import { build_platform_layer } from "../services/ai-control/platform-ai-constraints";
import { build_plan_layer } from "../services/ai-control/plan-entitlements";
import {
  compile_effective_policy_with_trace,
  type PlatformPolicyLayer,
  type PolicyCompilationResult,
  type PolicyLayer,
  type RequestPreferences,
} from "../services/ai-control/policy-compiler";

/** Mongo collection names for the AI control-plane records. */
const PROFILES_COLLECTION = "tenant_ai_profiles";
const DEPLOYMENTS_COLLECTION = "agent_deployments";
const RUNS_COLLECTION = "ai_runs";
const PLATFORM_STATE_COLLECTION = "platform_ai_state";
const PLATFORM_STATE_KEY = "singleton";

/** Compilation result plus the deployment/prompt pins to record on the run. */
export interface CompiledTenantPolicy extends PolicyCompilationResult {
  readonly deployment_id: string | null;
  readonly prompt_version_id: string | null;
  readonly deployment_pins: {
    readonly agent_definition_version: string;
    readonly orchestrator_version: string;
    readonly input_schema_version: string;
    readonly output_schema_version: string;
  } | null;
}

/**
 * Coerce a stored numeric limit (BigInt/Long/number/string) to bigint.
 *
 * @param value - Raw value from a Mongo document.
 * @param fallback - Value used when the field is absent or unparseable.
 * @returns The coerced bigint.
 */
function to_bigint(value: unknown, fallback: bigint): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  if (value && typeof value === "object" && "toString" in value) {
    const text = String(value);
    if (/^-?\d+$/.test(text)) return BigInt(text);
  }
  return fallback;
}

/**
 * Coerce a stored value to a string array (defaulting to empty).
 *
 * @param value - Raw value from a Mongo document.
 * @returns String array.
 */
function to_string_array(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/**
 * Read an approval-rule map from a stored JSON value, keeping only the
 * recognised requirement strengths.
 *
 * @param value - Raw approvalRules / reviewPolicy JSON.
 * @returns Sanitised approval-rule map.
 */
function to_approval_rules(
  value: unknown,
): Record<string, AIApprovalRequirement> {
  const rules: Record<string, AIApprovalRequirement> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, requirement] of Object.entries(value)) {
      if (requirement === "manager" || requirement === "none") {
        rules[key] = requirement;
      }
    }
  }
  return rules;
}

/**
 * Build a tenant-match filter spanning both stored ObjectId/string encodings.
 *
 * @param tenant_id - Verified tenant ID.
 * @returns Mongo filter for the tenantId field.
 */
function tenant_filter(tenant_id: string): Document {
  const values: (string | ObjectId)[] = [tenant_id];
  if (ObjectId.isValid(tenant_id)) values.push(new ObjectId(tenant_id));
  return { tenantId: { $in: values } };
}

/**
 * Map a TenantAIProfile document to the tenant policy layer.
 *
 * @param profile - Raw profile document.
 * @param platform - Platform layer (source of non-constraining defaults).
 * @returns The tenant policy layer.
 */
function map_profile_to_layer(
  profile: Document,
  platform: PlatformPolicyLayer,
): PolicyLayer {
  return {
    enabled: profile.status === "active",
    allowed_providers: to_string_array(profile.allowedProviders),
    allowed_models: to_string_array(profile.allowedModels),
    allowed_tools: to_string_array(profile.allowedTools),
    monthly_request_limit: to_bigint(
      profile.monthlyRequestLimit,
      platform.monthly_request_limit,
    ),
    monthly_token_limit: to_bigint(
      profile.monthlyTokenLimit,
      platform.monthly_token_limit,
    ),
    monthly_cost_limit_microusd: to_bigint(
      profile.monthlyCostLimitMicrousd,
      platform.monthly_cost_limit_microusd,
    ),
    per_user_monthly_request_limit: to_bigint(
      profile.perUserMonthlyRequestLimit,
      platform.per_user_monthly_request_limit,
    ),
    per_user_monthly_token_limit: to_bigint(
      profile.perUserMonthlyTokenLimit,
      platform.per_user_monthly_token_limit,
    ),
    per_user_monthly_cost_limit_microusd: to_bigint(
      profile.perUserMonthlyCostLimitMicrousd,
      platform.per_user_monthly_cost_limit_microusd,
    ),
    per_run_token_limit: to_bigint(
      profile.perRunTokenLimit,
      platform.per_run_token_limit,
    ),
    per_run_cost_limit_microusd: to_bigint(
      profile.perRunCostLimitMicrousd,
      platform.per_run_cost_limit_microusd,
    ),
    max_concurrent_runs:
      typeof profile.maxConcurrentRuns === "number"
        ? profile.maxConcurrentRuns
        : platform.max_concurrent_runs,
    max_iterations:
      typeof profile.maxIterations === "number"
        ? profile.maxIterations
        : platform.max_iterations,
    approval_rules: to_approval_rules(profile.reviewPolicy),
    default_locale:
      typeof profile.defaultLocale === "string"
        ? profile.defaultLocale
        : undefined,
  };
}

/**
 * Map an active AgentDeployment document to the deployment policy layer. The
 * deployment constrains providers/models/tools/approvals only; its numeric
 * limits mirror the platform so they never become the binding minimum.
 *
 * @param deployment - Raw deployment document, or null when none is active.
 * @param platform - Platform layer (non-constraining numeric defaults).
 * @returns The deployment policy layer.
 */
function map_deployment_to_layer(
  deployment: Document | null,
  platform: PlatformPolicyLayer,
): PolicyLayer {
  const numeric = {
    monthly_request_limit: platform.monthly_request_limit,
    monthly_token_limit: platform.monthly_token_limit,
    monthly_cost_limit_microusd: platform.monthly_cost_limit_microusd,
    per_user_monthly_request_limit: platform.per_user_monthly_request_limit,
    per_user_monthly_token_limit: platform.per_user_monthly_token_limit,
    per_user_monthly_cost_limit_microusd:
      platform.per_user_monthly_cost_limit_microusd,
    per_run_token_limit: platform.per_run_token_limit,
    per_run_cost_limit_microusd: platform.per_run_cost_limit_microusd,
    max_concurrent_runs: platform.max_concurrent_runs,
    max_iterations: platform.max_iterations,
  };
  if (!deployment) {
    // No active deployment: a fully permissive layer (mirrors the platform
    // universe) so the profile+plan+platform layers decide the policy.
    return {
      enabled: true,
      allowed_providers: platform.allowed_providers,
      allowed_models: platform.allowed_models,
      allowed_tools: platform.allowed_tools,
      approval_rules: {},
      ...numeric,
    };
  }
  return {
    enabled: deployment.status === "active",
    allowed_providers: to_string_array(deployment.allowedProviders),
    allowed_models: to_string_array(deployment.allowedModels),
    allowed_tools: to_string_array(deployment.toolAllowlist),
    approval_rules: to_approval_rules(deployment.approvalRules),
    ...numeric,
  };
}

/** Repository operations for compiling and pinning tenant AI policy. */
export interface AIPolicyRepository {
  compile_for_tenant(
    tenant_id: string,
    agent_key: string,
    request_preferences?: RequestPreferences,
  ): Promise<CompiledTenantPolicy>;
  persist_run_snapshot(run_id: string, policy: EffectiveAIPolicy): Promise<void>;
}

/**
 * Create the tenant AI policy repository over a MongoDB database handle.
 *
 * @param db - Connected database exposing the control-plane collections.
 * @returns AIPolicyRepository bound to that database.
 */
export function create_ai_policy_repository(db: Db): AIPolicyRepository {
  return {
    /**
     * Compile the effective policy for a tenant's agent from stored state.
     *
     * @param tenant_id - Verified tenant ID.
     * @param agent_key - Agent whose active deployment applies.
     * @param request_preferences - Optional safe per-request preferences.
     * @returns Compiled policy, trace, and deployment/prompt pins.
     * @throws ToolGovernanceError POLICY_DISABLED when no active profile exists.
     */
    async compile_for_tenant(tenant_id, agent_key, request_preferences) {
      const profile = await db
        .collection(PROFILES_COLLECTION)
        .findOne(tenant_filter(tenant_id));
      if (!profile || profile.status !== "active") {
        throw new ToolGovernanceError(
          "POLICY_DISABLED",
          "Tenant AI is disabled or not provisioned.",
        );
      }

      const deployment = await db.collection(DEPLOYMENTS_COLLECTION).findOne(
        { ...tenant_filter(tenant_id), agentKey: agent_key, status: "active" },
        { sort: { revision: -1 } },
      );

      const platform_state = await db
        .collection(PLATFORM_STATE_COLLECTION)
        .findOne({ key: PLATFORM_STATE_KEY });
      const configured_platform = build_platform_layer();
      const platform: PlatformPolicyLayer = {
        ...configured_platform,
        enabled:
          configured_platform.enabled &&
          !Boolean(platform_state?.emergencyDisabled),
      };
      const plan = build_plan_layer(String(profile.planKey), true);
      const tenant = map_profile_to_layer(profile, platform);
      const deployment_layer = map_deployment_to_layer(deployment, platform);

      const compiled = compile_effective_policy_with_trace({
        tenant_id,
        version:
          typeof profile.policyVersion === "number" ? profile.policyVersion : 1,
        platform,
        plan,
        tenant,
        deployment: deployment_layer,
        request_preferences,
      });

      return {
        ...compiled,
        deployment_id: deployment ? String(deployment._id) : null,
        prompt_version_id: deployment
          ? String(deployment.promptVersionId)
          : null,
        deployment_pins: deployment
          ? {
              agent_definition_version: String(deployment.agentDefinitionVersion ?? ""),
              orchestrator_version: String(deployment.orchestratorVersion ?? ""),
              input_schema_version: String(deployment.inputSchemaVersion ?? ""),
              output_schema_version: String(deployment.outputSchemaVersion ?? ""),
            }
          : null,
      };
    },

    /**
     * Persist the compiled policy snapshot and version on an AIRun.
     *
     * @param run_id - AIRun identifier.
     * @param policy - Compiled, hash-pinned effective policy.
     */
    async persist_run_snapshot(run_id, policy) {
      const run_filter = ObjectId.isValid(run_id)
        ? { _id: new ObjectId(run_id) }
        : { correlationId: run_id };
      await db.collection(RUNS_COLLECTION).updateOne(run_filter, {
        $set: {
          policySnapshot: JSON.parse(canonical_json(policy)),
          policyVersion: policy.version,
          policyHash: policy.hash,
          updatedAt: new Date(),
        },
      });
    },
  };
}
