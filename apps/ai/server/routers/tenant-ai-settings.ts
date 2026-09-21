/**
 * Tenant AI settings router (G3.6).
 *
 * Manager-only governance of a tenant's AI profile. Reads require
 * tenant:ai:read; updates require tenant:ai:configure. Every update may only
 * NARROW the tenant's policy: a requested value that would exceed the plan or
 * platform ceiling is rejected, and the prospective effective policy is
 * compiled (fail-closed) before persistence. Updates store a new revision
 * (policyVersion bump) — an active deployment or prompt is never edited in place.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { ObjectId } from "mongodb";
import client_promise from "@rnd-ai/shared-database";

import { router, tenantPermissionProcedure } from "../trpc";
import { build_platform_layer } from "../services/ai-control/platform-ai-constraints";
import { build_plan_layer } from "../services/ai-control/plan-entitlements";
import {
  compile_effective_policy,
  type PolicyLayer,
} from "../services/ai-control/policy-compiler";
import { ToolGovernanceError } from "../services/ai-control/errors";

const PROFILES = "tenant_ai_profiles";

/** Narrowable tenant AI settings a manager may update. */
const tenant_ai_profile_update_schema = z
  .object({
    max_iterations: z.number().int().min(1).max(100).optional(),
    monthly_request_limit: z.string().regex(/^\d+$/).optional(),
    per_run_token_limit: z.string().regex(/^\d+$/).optional(),
    allowed_models: z.array(z.string().min(1)).max(20).optional(),
    default_locale: z.string().min(2).max(20).optional(),
    status: z.enum(["active", "disabled"]).optional(),
  })
  .strict();

type TenantAIProfileUpdate = z.infer<typeof tenant_ai_profile_update_schema>;

/**
 * Build a tenantId match filter spanning both stored encodings.
 *
 * @param tenant_id - Verified tenant ID.
 * @returns Mongo filter.
 */
function tenant_filter(tenant_id: string): Record<string, unknown> {
  const values: (string | ObjectId)[] = [tenant_id];
  if (ObjectId.isValid(tenant_id)) values.push(new ObjectId(tenant_id));
  return { tenantId: { $in: values } };
}

/**
 * The strongest (lowest) numeric ceiling across the plan and platform layers.
 *
 * @param plan - Plan layer.
 * @param platform - Platform layer.
 * @param select - Numeric selector.
 * @returns The minimum ceiling.
 */
function ceiling_bigint(
  plan: PolicyLayer,
  platform: PolicyLayer,
  select: (layer: PolicyLayer) => bigint,
): bigint {
  const a = select(plan);
  const b = select(platform);
  return a < b ? a : b;
}

/**
 * Validate that an update only narrows the policy. Rejects any requested value
 * that would exceed the plan or platform ceiling, or select a model outside the
 * plan/platform intersection.
 *
 * @param input - The requested update.
 * @param plan - The plan entitlement layer.
 * @param platform - The platform hard-constraint layer.
 * @throws TRPCError FORBIDDEN on any expansion attempt.
 */
function assert_narrowing_only(
  input: TenantAIProfileUpdate,
  plan: PolicyLayer,
  platform: PolicyLayer,
): void {
  if (
    input.max_iterations !== undefined &&
    input.max_iterations > Math.min(plan.max_iterations, platform.max_iterations)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "max_iterations cannot exceed the plan or platform maximum.",
    });
  }
  if (
    input.monthly_request_limit !== undefined &&
    BigInt(input.monthly_request_limit) >
      ceiling_bigint(plan, platform, (l) => l.monthly_request_limit)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "monthly_request_limit cannot exceed the plan or platform maximum.",
    });
  }
  if (
    input.per_run_token_limit !== undefined &&
    BigInt(input.per_run_token_limit) >
      ceiling_bigint(plan, platform, (l) => l.per_run_token_limit)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "per_run_token_limit cannot exceed the plan or platform maximum.",
    });
  }
  if (input.allowed_models !== undefined) {
    const allowed = new Set(
      plan.allowed_models.filter((model) => platform.allowed_models.includes(model)),
    );
    const forbidden = input.allowed_models.find((model) => !allowed.has(model));
    if (forbidden) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Model '${forbidden}' is not permitted by the plan or platform.`,
      });
    }
  }
}

/**
 * Build a tenant PolicyLayer from a profile document merged with the update, so
 * the prospective effective policy can be compiled before persistence.
 *
 * @param profile - The current profile document.
 * @param input - The requested update.
 * @param platform - Platform layer (defaults for unspecified numeric fields).
 * @returns The prospective tenant policy layer.
 */
function prospective_tenant_layer(
  profile: Record<string, unknown>,
  input: TenantAIProfileUpdate,
  platform: PolicyLayer,
): PolicyLayer {
  const models =
    input.allowed_models ??
    (Array.isArray(profile.allowedModels) ? profile.allowedModels.map(String) : platform.allowed_models);
  const providers = Array.isArray(profile.allowedProviders)
    ? profile.allowedProviders.map(String)
    : platform.allowed_providers;
  return {
    enabled: (input.status ?? profile.status) !== "disabled",
    allowed_providers: providers,
    allowed_models: models,
    allowed_tools: Array.isArray(profile.allowedTools)
      ? profile.allowedTools.map(String)
      : platform.allowed_tools,
    monthly_request_limit: input.monthly_request_limit
      ? BigInt(input.monthly_request_limit)
      : platform.monthly_request_limit,
    monthly_token_limit: platform.monthly_token_limit,
    monthly_cost_limit_microusd: platform.monthly_cost_limit_microusd,
    per_user_monthly_request_limit: platform.per_user_monthly_request_limit,
    per_user_monthly_token_limit: platform.per_user_monthly_token_limit,
    per_user_monthly_cost_limit_microusd: platform.per_user_monthly_cost_limit_microusd,
    per_run_token_limit: input.per_run_token_limit
      ? BigInt(input.per_run_token_limit)
      : platform.per_run_token_limit,
    per_run_cost_limit_microusd: platform.per_run_cost_limit_microusd,
    max_concurrent_runs: platform.max_concurrent_runs,
    max_iterations: input.max_iterations ?? platform.max_iterations,
    approval_rules: {},
    default_locale: input.default_locale ?? (profile.defaultLocale as string | undefined),
  };
}

export const tenantAiSettingsRouter = router({
  /**
   * Read the tenant's stored AI settings and the compiled effective ceilings,
   * so the UI can render locked (plan/platform-constrained) values.
   */
  read: tenantPermissionProcedure("tenant:ai:read").query(async ({ ctx }) => {
    const db = (await client_promise).db();
    const profile = await db
      .collection(PROFILES)
      .findOne(tenant_filter(ctx.tenant_context.tenant_id));
    const platform = build_platform_layer();
    return {
      provisioned: Boolean(profile),
      status: profile?.status ?? "unprovisioned",
      plan_key: profile?.planKey ?? null,
      policy_version: profile?.policyVersion ?? null,
      allowed_models: profile?.allowedModels ?? [],
      max_iterations: profile?.maxIterations ?? null,
      default_locale: profile?.defaultLocale ?? null,
      platform_ceilings: {
        max_iterations: platform.max_iterations,
        allowed_models: platform.allowed_models,
      },
    };
  }),

  /**
   * Update the tenant AI settings. Narrowing-only, compiled fail-closed, and
   * stored as a new revision.
   */
  update: tenantPermissionProcedure("tenant:ai:configure")
    .input(tenant_ai_profile_update_schema)
    .mutation(async ({ ctx, input }) => {
      const db = (await client_promise).db();
      const filter = tenant_filter(ctx.tenant_context.tenant_id);
      const profile = await db.collection(PROFILES).findOne(filter);
      if (!profile) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Tenant AI is not provisioned.",
        });
      }
      const platform = build_platform_layer();
      const plan = build_plan_layer(String(profile.planKey));

      assert_narrowing_only(input, plan, platform);

      // Compile the prospective policy fail-closed before persisting.
      const tenant_layer = prospective_tenant_layer(profile, input, platform);
      try {
        compile_effective_policy({
          tenant_id: ctx.tenant_context.tenant_id,
          version: (profile.policyVersion ?? 1) + 1,
          platform,
          plan,
          tenant: tenant_layer,
          deployment: {
            ...tenant_layer,
            enabled: true,
            allowed_providers: platform.allowed_providers,
            allowed_models: platform.allowed_models,
            allowed_tools: platform.allowed_tools,
            approval_rules: {},
          },
        });
      } catch (error) {
        if (error instanceof ToolGovernanceError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }

      const next_version = (profile.policyVersion ?? 1) + 1;
      const set: Record<string, unknown> = {
        policyVersion: next_version,
        updatedByProfileId: ctx.principal.internal_user_id,
        updatedAt: new Date(),
      };
      if (input.max_iterations !== undefined) set.maxIterations = input.max_iterations;
      if (input.allowed_models !== undefined) set.allowedModels = input.allowed_models;
      if (input.default_locale !== undefined) set.defaultLocale = input.default_locale;
      if (input.status !== undefined) set.status = input.status;
      if (input.monthly_request_limit !== undefined) {
        set.monthlyRequestLimit = input.monthly_request_limit;
      }
      if (input.per_run_token_limit !== undefined) {
        set.perRunTokenLimit = input.per_run_token_limit;
      }
      await db.collection(PROFILES).updateOne(filter, { $set: set });
      return { policy_version: next_version, applied: input };
    }),
});
