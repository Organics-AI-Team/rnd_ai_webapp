/**
 * Clerk deployment configuration (G1.1).
 *
 * Clerk activates only when its runtime configuration is present, so builds,
 * tests, and pre-cutover deployments succeed without Clerk credentials.
 * Enabling the Clerk UI for statically prerendered pages requires building
 * with NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY present, because the provider
 * decision participates in prerendering.
 */

/**
 * Whether the Clerk surface (provider, sign-in/up pages, middleware) is
 * active for this deployment.
 *
 * @returns True when the publishable key is configured.
 */
export function is_clerk_enabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

/**
 * Whether ingress authorization has been cut over from the legacy session
 * adapter to Clerk (G1.7). While false, Clerk renders its surface but the
 * legacy cookie flow still guards pages — this is the documented G1
 * rollback lever (CLERK_CUTOVER=false).
 *
 * @returns True when CLERK_CUTOVER is exactly "true".
 */
export function is_clerk_cutover(): boolean {
  return process.env.CLERK_CUTOVER === "true";
}
