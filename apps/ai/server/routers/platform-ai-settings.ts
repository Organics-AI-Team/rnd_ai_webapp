/**
 * Platform AI settings router (G3.6).
 *
 * Platform-level AI governance. Reading and managing hard constraints/plan
 * defaults requires a platform admin role; the emergency AI kill switch is
 * reserved for the super administrator. This surface exposes only non-content
 * configuration and diagnostics — never tenant conversations or artifacts.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { z } from "zod";
import client_promise from "@rnd-ai/shared-database";

import { router, platformAdminProcedure, superAdminProcedure } from "../trpc";
import {
  PLATFORM_PROVIDER_UNIVERSE,
  PLATFORM_TOOL_UNIVERSE,
  build_platform_layer,
} from "../services/ai-control/platform-ai-constraints";
import { PLAN_ENTITLEMENTS } from "../services/ai-control/plan-entitlements";

const PLATFORM_STATE = "platform_ai_state";
const PLATFORM_STATE_KEY = "singleton";

export const platformAiSettingsRouter = router({
  /** Read the platform hard constraints, provider/tool universe, and plans. */
  getConstraints: platformAdminProcedure.query(async () => {
    const platform = build_platform_layer();
    const db = (await client_promise).db();
    const state = await db
      .collection(PLATFORM_STATE)
      .findOne({ key: PLATFORM_STATE_KEY });
    return {
      emergency_disabled: Boolean(state?.emergencyDisabled),
      provider_universe: PLATFORM_PROVIDER_UNIVERSE,
      tool_universe: PLATFORM_TOOL_UNIVERSE,
      hard_limits: {
        max_iterations: platform.max_iterations,
        max_concurrent_runs: platform.max_concurrent_runs,
      },
      plans: Object.keys(PLAN_ENTITLEMENTS),
    };
  }),

  /**
   * Record platform default overlays (diagnostics/config only). Full plan
   * catalogue editing is data-driven; this persists an operator note + the
   * acting admin for audit.
   */
  setDefaults: platformAdminProcedure
    .input(
      z
        .object({
          note: z.string().trim().min(1).max(500),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const db = (await client_promise).db();
      await db.collection(PLATFORM_STATE).updateOne(
        { key: PLATFORM_STATE_KEY },
        {
          $set: {
            lastDefaultsNote: input.note,
            updatedByProfileId: ctx.principal.internal_user_id,
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );
      return { recorded: true };
    }),

  /**
   * Emergency AI kill switch (super administrator only). Flips the platform-wide
   * disable flag; the policy compiler and gate fail closed while it is set.
   */
  emergencyDisable: superAdminProcedure
    .input(z.object({ disabled: z.boolean() }).strict())
    .mutation(async ({ ctx, input }) => {
      const db = (await client_promise).db();
      await db.collection(PLATFORM_STATE).updateOne(
        { key: PLATFORM_STATE_KEY },
        {
          $set: {
            emergencyDisabled: input.disabled,
            emergencyToggledByProfileId: ctx.principal.internal_user_id,
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );
      return { emergency_disabled: input.disabled };
    }),
});
