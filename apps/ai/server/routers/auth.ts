import { router, publicProcedure } from "../trpc";

/**
 * Auth router after the Clerk cutover (G1.7).
 *
 * Clerk owns sign-in, sign-up, sessions, and sign-out; the custom login,
 * signup, logout, and me procedures are retired. Only an explicitly public
 * health probe remains. Legacy Account/Session collections stay read-only
 * until their G5 retirement.
 */
export const authRouter = router({
  /**
   * Liveness probe. Deliberately public and side-effect free.
   */
  health: publicProcedure.query(() => ({ ok: true })),
});
