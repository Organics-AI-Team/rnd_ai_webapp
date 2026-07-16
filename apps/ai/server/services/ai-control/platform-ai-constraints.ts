/**
 * Platform AI hard constraints (G3.2) — the outermost policy layer.
 *
 * These are the absolute ceilings no plan, tenant, or deployment can exceed:
 * the provider→models universe, the global tool universe, and the maximum
 * budgets/iterations the platform will ever admit. Values are sourced from the
 * environment where an operator may reasonably tune them, each with a named,
 * documented default constant (never a bare literal at a call site).
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import type {
  AIApprovalRequirement,
  EffectiveAIPolicy,
} from "@rnd-ai/shared-types";
import type { PlatformPolicyLayer } from "./policy-compiler";

/**
 * Provider→models universe the platform recognises. A tenant/plan can only
 * ever select a subset of this map; nothing outside it is admissible.
 */
export const PLATFORM_PROVIDER_UNIVERSE: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  google: Object.freeze([
    "gemini-3.5-flash",
    "gemini-3.1-pro-preview",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
  ]),
});

/**
 * Platform model preference, newest/most-capable first. Run admission pins
 * the first entry present in the effective allowlist; models outside this
 * ranking fall back to a deterministic sort so selection never becomes
 * unstable. Updating the platform default model is a one-line edit here —
 * in-flight runs keep their admission-time pin.
 */
export const PLATFORM_MODEL_PREFERENCE: readonly string[] = Object.freeze([
  "gemini-3.5-flash",
  "gemini-3.1-pro-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
]);

/**
 * Select the provider and model to pin on a run from the effective policy's
 * provider→models map.
 *
 * Providers are considered in deterministic sorted order; within a provider
 * the first PLATFORM_MODEL_PREFERENCE entry present in its allowlist wins,
 * falling back to the lexicographically first allowed model when no ranked
 * entry matches (e.g. a future model added to a plan before the ranking).
 *
 * @param provider_models - Effective provider→models map from the compiled policy.
 * @returns Pinned provider and model, or null when the map allows nothing.
 */
export function select_preferred_model(
  provider_models: Readonly<Record<string, readonly string[]>>,
): { provider: string; model: string } | null {
  for (const provider of Object.keys(provider_models).sort()) {
    const allowed = provider_models[provider] ?? [];
    if (allowed.length === 0) continue;
    const ranked = PLATFORM_MODEL_PREFERENCE.find((model) =>
      allowed.includes(model),
    );
    const model = ranked ?? [...allowed].sort()[0];
    return { provider, model };
  }
  return null;
}

/** Global tool universe; a policy's allowed tools are always a subset. */
export const PLATFORM_TOOL_UNIVERSE: readonly string[] = Object.freeze([
  "formula.search",
  "formula.draft",
  "formula.revise",
  "formula.comment",
  "formula.confirm",
  "knowledge.search",
  "web.search",
]);

/**
 * Platform-mandated approval floors. A commit-class formula confirmation always
 * requires manager approval; lower layers may strengthen but never relax it.
 */
export const PLATFORM_APPROVAL_FLOORS: Readonly<
  Record<string, AIApprovalRequirement>
> = Object.freeze({
  "formula.confirm": "manager",
});

/** Documented default ceilings (micro-USD for monetary limits). */
export const PLATFORM_DEFAULTS = Object.freeze({
  monthly_request_limit: BigInt(1_000_000),
  monthly_token_limit: BigInt(5_000_000_000),
  monthly_cost_limit_microusd: BigInt(50_000_000_000),
  per_user_monthly_request_limit: BigInt(100_000),
  per_user_monthly_token_limit: BigInt(500_000_000),
  per_user_monthly_cost_limit_microusd: BigInt(5_000_000_000),
  per_run_token_limit: BigInt(2_000_000),
  per_run_cost_limit_microusd: BigInt(20_000_000),
  max_concurrent_runs: 50,
  max_iterations: 24,
  default_locale: "th-TH",
});

/**
 * Read a bigint hard-limit override from the environment, falling back to the
 * documented default.
 *
 * @param env - Environment variable map.
 * @param name - Variable name (integer string, base-10).
 * @param fallback - Default when unset or unparseable.
 * @returns The effective bigint limit.
 */
function read_bigint_limit(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: bigint,
): bigint {
  const raw = env[name];
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return fallback;
  return BigInt(raw.trim());
}

/**
 * Read a positive integer override from the environment.
 *
 * @param env - Environment variable map.
 * @param name - Variable name.
 * @param fallback - Default when unset or unparseable.
 * @returns The effective integer.
 */
function read_int(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Build the platform hard-constraint layer.
 *
 * @param env - Environment variable map (defaults to process.env). Overridable
 *              for tests; unset variables fall back to the documented defaults.
 * @returns The platform policy layer (owns the provider universe).
 */
export function build_platform_layer(
  env: NodeJS.ProcessEnv = process.env,
): PlatformPolicyLayer {
  const providers = Object.keys(PLATFORM_PROVIDER_UNIVERSE);
  const models = Object.values(PLATFORM_PROVIDER_UNIVERSE).flat();
  return {
    enabled: env.AI_PLATFORM_DISABLED !== "true",
    provider_universe: PLATFORM_PROVIDER_UNIVERSE,
    allowed_providers: providers,
    allowed_models: models,
    allowed_tools: PLATFORM_TOOL_UNIVERSE,
    monthly_request_limit: read_bigint_limit(
      env,
      "AI_PLATFORM_MONTHLY_REQUEST_LIMIT",
      PLATFORM_DEFAULTS.monthly_request_limit,
    ),
    monthly_token_limit: read_bigint_limit(
      env,
      "AI_PLATFORM_MONTHLY_TOKEN_LIMIT",
      PLATFORM_DEFAULTS.monthly_token_limit,
    ),
    monthly_cost_limit_microusd: read_bigint_limit(
      env,
      "AI_PLATFORM_MONTHLY_COST_LIMIT_MICROUSD",
      PLATFORM_DEFAULTS.monthly_cost_limit_microusd,
    ),
    per_user_monthly_request_limit: read_bigint_limit(
      env,
      "AI_PLATFORM_PER_USER_MONTHLY_REQUEST_LIMIT",
      PLATFORM_DEFAULTS.per_user_monthly_request_limit,
    ),
    per_user_monthly_token_limit: read_bigint_limit(
      env,
      "AI_PLATFORM_PER_USER_MONTHLY_TOKEN_LIMIT",
      PLATFORM_DEFAULTS.per_user_monthly_token_limit,
    ),
    per_user_monthly_cost_limit_microusd: read_bigint_limit(
      env,
      "AI_PLATFORM_PER_USER_MONTHLY_COST_LIMIT_MICROUSD",
      PLATFORM_DEFAULTS.per_user_monthly_cost_limit_microusd,
    ),
    per_run_token_limit: read_bigint_limit(
      env,
      "AI_PLATFORM_PER_RUN_TOKEN_LIMIT",
      PLATFORM_DEFAULTS.per_run_token_limit,
    ),
    per_run_cost_limit_microusd: read_bigint_limit(
      env,
      "AI_PLATFORM_PER_RUN_COST_LIMIT_MICROUSD",
      PLATFORM_DEFAULTS.per_run_cost_limit_microusd,
    ),
    max_concurrent_runs: read_int(
      env,
      "AI_PLATFORM_MAX_CONCURRENT_RUNS",
      PLATFORM_DEFAULTS.max_concurrent_runs,
    ),
    max_iterations: read_int(
      env,
      "AI_PLATFORM_MAX_ITERATIONS",
      PLATFORM_DEFAULTS.max_iterations,
    ),
    approval_rules: PLATFORM_APPROVAL_FLOORS,
    default_locale: env.AI_PLATFORM_DEFAULT_LOCALE ?? PLATFORM_DEFAULTS.default_locale,
  } satisfies PlatformPolicyLayer;
}

/** The set of numeric EffectiveAIPolicy limit keys, shared for iteration. */
export const POLICY_LIMIT_KEYS: readonly (keyof EffectiveAIPolicy)[] =
  Object.freeze([
    "monthly_request_limit",
    "monthly_token_limit",
    "monthly_cost_limit_microusd",
    "per_user_monthly_request_limit",
    "per_user_monthly_token_limit",
    "per_user_monthly_cost_limit_microusd",
    "per_run_token_limit",
    "per_run_cost_limit_microusd",
  ]);
