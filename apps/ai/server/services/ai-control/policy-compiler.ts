/**
 * Effective tenant AI policy compiler (G3.2).
 *
 * Folds four ordered policy layers — platform hard limits, plan entitlements,
 * tenant settings (TenantAIProfile), and the active agent deployment — into a
 * single immutable {@link EffectiveAIPolicy}. The merge is monotonically
 * restrictive: a lower layer can only ever narrow the layer above it.
 *
 *   - enabled        : logical AND (false wins — any disabled layer disables).
 *   - provider_models: set intersection over the platform universe.
 *   - allowed_tools  : set intersection.
 *   - numeric maxima : minimum (bigint-safe) across layers.
 *   - approval_rules : strongest-of (a tenant can never relax an approval).
 *
 * An empty provider/model intersection on an enabled policy is rejected before
 * a run can be created. Request preferences may only narrow to a locale,
 * detail level, and a model alias already in the effective allowlist; any
 * unknown field is rejected. The canonical JSON of the compiled policy is
 * SHA-256 hashed (key-order independent) and pinned on every AIRun.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import type {
  AIApprovalRequirement,
  EffectiveAIPolicy,
} from "@rnd-ai/shared-types";
import { ToolGovernanceError } from "./errors";
import { canonical_json, sha256_hex } from "./hashing";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Ordered policy layer sources, from broadest (platform) to narrowest. */
export type PolicyLayerSource = "platform" | "plan" | "tenant" | "deployment";

/** Response verbosity a caller may request; validated against this allowlist. */
export const ALLOWED_RESPONSE_DETAILS = [
  "brief",
  "standard",
  "detailed",
] as const;

/** The only request-preference fields a caller may supply. */
export const ALLOWED_REQUEST_PREFERENCE_KEYS = [
  "response_language",
  "response_detail",
  "model_alias",
] as const;

/**
 * Safe per-request preferences. May only narrow the compiled policy — never
 * enable a capability or raise a limit.
 */
export interface RequestPreferences {
  readonly response_language?: string;
  readonly response_detail?: (typeof ALLOWED_RESPONSE_DETAILS)[number];
  readonly model_alias?: string;
}

/**
 * One layer's contribution to the merge. Narrowing layers (plan/tenant/
 * deployment) declare flat allowlists; the platform layer additionally owns
 * the provider→models universe every narrowing layer intersects against.
 */
export interface PolicyLayer {
  readonly enabled: boolean;
  readonly allowed_providers: readonly string[];
  readonly allowed_models: readonly string[];
  readonly allowed_tools: readonly string[];
  readonly monthly_request_limit: bigint;
  readonly monthly_token_limit: bigint;
  readonly monthly_cost_limit_microusd: bigint;
  readonly per_user_monthly_request_limit: bigint;
  readonly per_user_monthly_token_limit: bigint;
  readonly per_user_monthly_cost_limit_microusd: bigint;
  readonly per_run_token_limit: bigint;
  readonly per_run_cost_limit_microusd: bigint;
  readonly max_concurrent_runs: number;
  readonly max_iterations: number;
  readonly approval_rules: Readonly<Record<string, AIApprovalRequirement>>;
  readonly default_locale?: string;
}

/** The platform layer additionally owns the provider→models universe. */
export interface PlatformPolicyLayer extends PolicyLayer {
  readonly provider_universe: Readonly<Record<string, readonly string[]>>;
  readonly default_locale: string;
}

/** The complete, ordered set of layers to compile for one tenant. */
export interface PolicyLayers {
  readonly tenant_id: string;
  readonly version: number;
  readonly platform: PlatformPolicyLayer;
  readonly plan: PolicyLayer;
  readonly tenant: PolicyLayer;
  readonly deployment: PolicyLayer;
  readonly request_preferences?: RequestPreferences;
}

/** Names which layer constrained each explainable field (no secrets). */
export type ConstraintTrace = Readonly<Record<string, PolicyLayerSource>>;

/** The compiled policy plus its explainable constraint trace. */
export interface PolicyCompilationResult {
  readonly policy: EffectiveAIPolicy;
  readonly constraint_trace: ConstraintTrace;
}

// ---------------------------------------------------------------------------
// Numeric / set helpers
// ---------------------------------------------------------------------------

/**
 * Return the minimum bigint of a non-empty list.
 *
 * @param values - Candidate bigints.
 * @returns The smallest value.
 */
function min_bigint(values: readonly bigint[]): bigint {
  return values.reduce((lowest, value) => (value < lowest ? value : lowest));
}

/**
 * Find the index of the layer that owns the minimum of a numeric selector,
 * so the constraint trace can name the constraining layer.
 *
 * @param layers - Ordered layers.
 * @param select - Selector returning a comparable bigint per layer.
 * @returns Index of the constraining layer (first on ties).
 */
function argmin_layer(
  layers: readonly PolicyLayer[],
  select: (layer: PolicyLayer) => bigint,
): number {
  let best = 0;
  for (let index = 1; index < layers.length; index += 1) {
    if (select(layers[index]) < select(layers[best])) best = index;
  }
  return best;
}

/**
 * Intersect an ordered list of string arrays into a stable, de-duplicated
 * array preserving the first layer's order.
 *
 * @param lists - Ordered string arrays.
 * @returns Their intersection.
 */
function intersect_string_arrays(
  lists: readonly (readonly string[])[],
): string[] {
  if (lists.length === 0) return [];
  const [first, ...rest] = lists;
  const rest_sets = rest.map((list) => new Set(list));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of first) {
    if (seen.has(value)) continue;
    if (rest_sets.every((set) => set.has(value))) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

/**
 * Compute the effective provider→models map: providers allowed by every layer,
 * each with the models allowed by every layer, over the platform universe.
 *
 * @param platform - Platform layer owning the universe.
 * @param narrowing - Plan/tenant/deployment layers.
 * @returns Effective provider→models map (providers with an empty model
 *          intersection are dropped).
 */
function intersect_provider_models(
  platform: PlatformPolicyLayer,
  narrowing: readonly PolicyLayer[],
): Record<string, readonly string[]> {
  const provider_sets = narrowing.map((layer) => new Set(layer.allowed_providers));
  const model_sets = narrowing.map((layer) => new Set(layer.allowed_models));
  const platform_provider_set = new Set(platform.allowed_providers);
  const platform_model_set = new Set(platform.allowed_models);

  const result: Record<string, readonly string[]> = {};
  for (const [provider, universe_models] of Object.entries(
    platform.provider_universe,
  )) {
    const provider_allowed =
      platform_provider_set.has(provider) &&
      provider_sets.every((set) => set.has(provider));
    if (!provider_allowed) continue;
    const models = universe_models.filter(
      (model) =>
        platform_model_set.has(model) &&
        model_sets.every((set) => set.has(model)),
    );
    if (models.length > 0) result[provider] = models;
  }
  return result;
}

/**
 * Merge approval rules to the strongest requirement per operation key. Any
 * "manager" wins over "none"; a tenant can only strengthen an approval.
 *
 * @param layers - Ordered layers.
 * @returns Merged approval-rule map.
 */
function strongest_approval(
  layers: readonly PolicyLayer[],
): Record<string, AIApprovalRequirement> {
  const merged: Record<string, AIApprovalRequirement> = {};
  for (const layer of layers) {
    for (const [key, requirement] of Object.entries(layer.approval_rules)) {
      if (merged[key] === "manager") continue;
      merged[key] = requirement === "manager" ? "manager" : merged[key] ?? "none";
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Request preference validation
// ---------------------------------------------------------------------------

/**
 * Validate request preferences: reject unknown fields, an out-of-allowlist
 * detail level, or a model alias not in the effective allowlist.
 *
 * @param preferences - Raw request preferences (may be undefined).
 * @param effective_models - Flattened effective model allowlist.
 * @returns The validated preferences (empty object when none supplied).
 * @throws ToolGovernanceError POLICY_INPUT_INVALID on any violation.
 */
function validate_request_preferences(
  preferences: RequestPreferences | undefined,
  effective_models: readonly string[],
): RequestPreferences {
  if (!preferences) return {};
  const allowed = new Set<string>(ALLOWED_REQUEST_PREFERENCE_KEYS);
  for (const key of Object.keys(preferences)) {
    if (!allowed.has(key)) {
      throw new ToolGovernanceError(
        "POLICY_INPUT_INVALID",
        `Unknown request preference '${key}'.`,
      );
    }
  }
  if (
    preferences.response_detail !== undefined &&
    !ALLOWED_RESPONSE_DETAILS.includes(preferences.response_detail)
  ) {
    throw new ToolGovernanceError(
      "POLICY_INPUT_INVALID",
      `Unsupported response_detail '${preferences.response_detail}'.`,
    );
  }
  if (
    preferences.response_language !== undefined &&
    preferences.response_language.trim().length === 0
  ) {
    throw new ToolGovernanceError(
      "POLICY_INPUT_INVALID",
      "response_language must be a non-empty locale.",
    );
  }
  if (
    preferences.model_alias !== undefined &&
    !effective_models.includes(preferences.model_alias)
  ) {
    throw new ToolGovernanceError(
      "POLICY_INPUT_INVALID",
      "model_alias must already be in the effective model allowlist.",
    );
  }
  return preferences;
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

/**
 * Compile the four ordered layers into an immutable effective policy, and
 * return the constraint trace alongside it.
 *
 * @param layers - Platform, plan, tenant, and deployment layers plus optional
 *                 request preferences.
 * @returns The compiled EffectiveAIPolicy and its constraint trace.
 * @throws ToolGovernanceError POLICY_NO_PROVIDER when an enabled policy has an
 *         empty provider/model intersection; POLICY_INPUT_INVALID on bad
 *         request preferences.
 */
export function compile_effective_policy_with_trace(
  layers: PolicyLayers,
): PolicyCompilationResult {
  const { platform, plan, tenant, deployment } = layers;
  const ordered: readonly PolicyLayer[] = [platform, plan, tenant, deployment];
  const sources: readonly PolicyLayerSource[] = [
    "platform",
    "plan",
    "tenant",
    "deployment",
  ];

  const enabled = ordered.every((layer) => layer.enabled);
  const provider_models = intersect_provider_models(platform, [
    plan,
    tenant,
    deployment,
  ]);
  const effective_models = Object.values(provider_models).flat();

  if (enabled && Object.keys(provider_models).length === 0) {
    throw new ToolGovernanceError(
      "POLICY_NO_PROVIDER",
      "The effective provider/model intersection is empty; a run cannot be created.",
    );
  }

  const preferences = validate_request_preferences(
    layers.request_preferences,
    effective_models,
  );

  const allowed_tools = intersect_string_arrays(
    ordered.map((layer) => layer.allowed_tools),
  );

  const numeric_fields = [
    "monthly_request_limit",
    "monthly_token_limit",
    "monthly_cost_limit_microusd",
    "per_user_monthly_request_limit",
    "per_user_monthly_token_limit",
    "per_user_monthly_cost_limit_microusd",
    "per_run_token_limit",
    "per_run_cost_limit_microusd",
  ] as const;

  const trace: Record<string, PolicyLayerSource> = {};
  const bigint_values = {} as Record<(typeof numeric_fields)[number], bigint>;
  for (const field of numeric_fields) {
    const select = (layer: PolicyLayer): bigint => layer[field];
    bigint_values[field] = min_bigint(ordered.map(select));
    trace[field] = sources[argmin_layer(ordered, select)];
  }

  const max_concurrent_runs = Math.min(
    ...ordered.map((layer) => layer.max_concurrent_runs),
  );
  const max_iterations = Math.min(...ordered.map((layer) => layer.max_iterations));
  trace.max_concurrent_runs =
    sources[
      ordered.reduce(
        (best, layer, index) =>
          layer.max_concurrent_runs < ordered[best].max_concurrent_runs
            ? index
            : best,
        0,
      )
    ];
  trace.max_iterations =
    sources[
      ordered.reduce(
        (best, layer, index) =>
          layer.max_iterations < ordered[best].max_iterations ? index : best,
        0,
      )
    ];

  const disabling_index = ordered.findIndex((layer) => !layer.enabled);
  trace.enabled = disabling_index >= 0 ? sources[disabling_index] : "platform";

  // A request-preference locale narrows presentation only; it never widens the
  // policy. Fall back to the tenant then platform default.
  const default_locale =
    preferences.response_language ??
    tenant.default_locale ??
    platform.default_locale;
  if (preferences.response_language) trace.default_locale = "tenant";

  const policy_without_hash: Omit<EffectiveAIPolicy, "hash"> = {
    tenant_id: layers.tenant_id,
    version: layers.version,
    enabled,
    provider_models,
    allowed_tools,
    ...bigint_values,
    max_concurrent_runs,
    default_locale,
    max_iterations,
    approval_rules: strongest_approval(ordered),
  };

  const hash = sha256_hex(canonical_json(policy_without_hash));

  return {
    policy: Object.freeze({ ...policy_without_hash, hash }),
    constraint_trace: Object.freeze(trace),
  };
}

/**
 * Compile the effective policy (convenience wrapper returning only the policy).
 *
 * @param layers - Ordered policy layers plus optional request preferences.
 * @returns The compiled, immutable EffectiveAIPolicy.
 * @throws ToolGovernanceError as documented on
 *         {@link compile_effective_policy_with_trace}.
 */
export function compile_effective_policy(
  layers: PolicyLayers,
): EffectiveAIPolicy {
  return compile_effective_policy_with_trace(layers).policy;
}
