// apps/ai/server/routers/auth.ts
import type { RequestPrincipal } from "@rnd-ai/shared-types";

import { router, publicProcedure } from "../trpc";

/** Display-only principal fields consumed by navigation visibility. */
export interface PrincipalDisplayView {
  tenant_role: RequestPrincipal["tenant_role"];
  platform_role: RequestPrincipal["platform_role"];
  membership_status: RequestPrincipal["membership_status"];
}

/**
 * Project a resolved principal onto the three display-only fields the
 * sidebar needs (link visibility). Anonymous/unresolved sessions project as
 * all-null instead of erroring so the navigation never special-cases auth
 * failures. NEVER used for authorization — server procedures authorize.
 *
 * @param principal - Resolved principal, or null when unauthenticated.
 * @returns Display view with nulls for missing dimensions.
 */
export function principal_display_view(
  principal: RequestPrincipal | null,
): PrincipalDisplayView {
  return {
    tenant_role: principal?.tenant_role ?? null,
    platform_role: principal?.platform_role ?? null,
    membership_status: principal?.membership_status ?? null,
  };
}

/**
 * Auth router after the Clerk cutover (G1.7).
 *
 * Clerk owns sign-in, sign-up, sessions, and sign-out; the custom login,
 * signup, logout procedures are retired. Only an explicitly public health
 * probe and the display-only principal view remain. Legacy Account/Session
 * collections stay read-only until their G5 retirement.
 */
export const authRouter = router({
  /**
   * Liveness probe. Deliberately public and side-effect free.
   */
  health: publicProcedure.query(() => ({ ok: true })),

  /**
   * Display-only principal view for navigation visibility (Plan 3).
   * Deliberately public: anonymous or inactive sessions receive nulls.
   */
  me: publicProcedure.query(({ ctx }) => principal_display_view(ctx.principal)),
});
