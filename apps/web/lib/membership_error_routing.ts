/**
 * Client-side routing for membership-loss errors (Plan 3).
 *
 * When the active organization's membership disappears mid-session
 * (suspended, removed, or the tenant deactivated), tenant procedures reject
 * with FORBIDDEN whose messages come from a small closed set produced by the
 * authenticated middleware (apps/ai/server/trpc.ts) and the Clerk principal
 * resolver. Those requests route the user to /onboarding, which explains
 * the exact state.
 */

/** Server messages that identify a lost/inactive membership (closed set). */
export const MEMBERSHIP_INACTIVE_MESSAGES: readonly string[] = [
  "Membership is not active.",
  "No active membership exists for this tenant.",
  "The organization is not an active tenant.",
  "Session role does not match the membership projection",
];

/**
 * Decide whether a tRPC client error represents membership loss.
 *
 * @param error - Unknown error from the query/mutation cache. tRPC client
 *                errors carry `data.code` and a server `message`.
 * @returns True only for FORBIDDEN errors with a known membership message.
 */
export function is_membership_inactive_error(error: unknown): boolean {
  const candidate = error as
    | { message?: unknown; data?: { code?: unknown } }
    | null
    | undefined;
  if (!candidate || candidate.data?.code !== "FORBIDDEN") return false;
  const message = typeof candidate.message === "string" ? candidate.message : "";
  return MEMBERSHIP_INACTIVE_MESSAGES.some((known) => message.includes(known));
}

/**
 * Route a membership-loss error to /onboarding. No-op on the server, for
 * non-membership errors, and when already on /onboarding (loop guard).
 *
 * @param error - Unknown error from the query/mutation cache.
 */
export function route_membership_error(error: unknown): void {
  if (typeof window === "undefined") return;
  if (!is_membership_inactive_error(error)) return;
  if (window.location.pathname.startsWith("/onboarding")) return;
  console.warn({
    boundary: "membership-error-routing",
    event: "redirect.onboarding",
  });
  window.location.assign("/onboarding");
}
