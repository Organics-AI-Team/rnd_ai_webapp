/**
 * Onboarding state classification (Plan 3).
 *
 * Pure decision logic, dependency-free by design: the onboarding page adapts
 * the Clerk session, the principal resolver, and the identity projections
 * into these lookups, so every branch is unit-testable with fakes.
 */

/** All onboarding states the page can render. */
export type OnboardingState =
  | "clerk_disabled"
  | "unauthenticated"
  | "invitation_pending"
  | "choose_organization"
  | "membership_sync_pending"
  | "access_suspended"
  | "membership_removed"
  | "reconciliation_required"
  | "ready";

/** Outcome of running the Clerk principal resolver, without exceptions. */
export type MembershipResolution =
  | { kind: "ready" }
  | {
      kind: "rejected";
      code: "UNAUTHENTICATED" | "MEMBERSHIP_INACTIVE" | "FORBIDDEN";
    };

/** Server-verified session snapshot the classification runs against. */
export interface OnboardingSnapshot {
  clerk_enabled: boolean;
  user_id: string | null;
  org_id: string | null;
}

/** Lazy lookups; only the branches that need them are ever invoked. */
export interface OnboardingLookups {
  /** Run the principal resolver for the (user, active org) pair. */
  resolve_membership(): Promise<MembershipResolution>;
  /** Direct membership projection status for the (user, active org) pair. */
  find_projection_status(): Promise<"active" | "suspended" | "revoked" | null>;
  /** Active memberships across ALL tenants for the user. */
  count_active_memberships(): Promise<number>;
}

/**
 * Classify the onboarding state. A projection that EXISTS with
 * suspended/revoked status is distinguished from an absent one (webhook
 * lag): suspension and removal get explicit states instead of the generic
 * "synchronization pending" (spec §4.5).
 *
 * @param snapshot - Server-verified session snapshot.
 * @param lookups - Lazy resolution/projection lookups.
 * @returns Onboarding state for the current request.
 */
export async function classify_onboarding_state(
  snapshot: OnboardingSnapshot,
  lookups: OnboardingLookups,
): Promise<OnboardingState> {
  if (!snapshot.clerk_enabled) return "clerk_disabled";
  if (!snapshot.user_id) return "unauthenticated";
  if (!snapshot.org_id) {
    const active_memberships = await lookups.count_active_memberships();
    // >=2: the user must pick explicitly (activator renders the picker);
    // exactly 1 is auto-activated by the activator moments later.
    return active_memberships >= 2 ? "choose_organization" : "invitation_pending";
  }
  const resolution = await lookups.resolve_membership();
  if (resolution.kind === "ready") return "ready";
  if (resolution.code === "FORBIDDEN") return "reconciliation_required";
  if (resolution.code === "MEMBERSHIP_INACTIVE") {
    const status = await lookups.find_projection_status();
    if (status === "suspended") return "access_suspended";
    if (status === "revoked") return "membership_removed";
    return "membership_sync_pending";
  }
  // UNAUTHENTICATED: the user profile itself is not projected yet.
  return "membership_sync_pending";
}
