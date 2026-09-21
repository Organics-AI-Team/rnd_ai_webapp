import { describe, expect, it } from "vitest";

import {
  classify_onboarding_state,
  type MembershipResolution,
  type OnboardingLookups,
} from "../../apps/web/lib/server/onboarding-state";

/**
 * Build lookups with overridable outcomes.
 *
 * @param overrides - Resolution / projection-status / membership-count seeds.
 */
function lookups(
  overrides: Partial<{
    resolution: MembershipResolution;
    projection_status: "active" | "suspended" | "revoked" | null;
    active_memberships: number;
  }> = {},
): OnboardingLookups {
  return {
    async resolve_membership() {
      return overrides.resolution ?? { kind: "ready" };
    },
    async find_projection_status() {
      return overrides.projection_status ?? null;
    },
    async count_active_memberships() {
      return overrides.active_memberships ?? 0;
    },
  };
}

const signed_in = { clerk_enabled: true, user_id: "user_1", org_id: "org_1" };

describe("classify_onboarding_state", () => {
  it("returns clerk_disabled / unauthenticated for missing prerequisites", async () => {
    await expect(
      classify_onboarding_state(
        { clerk_enabled: false, user_id: null, org_id: null },
        lookups(),
      ),
    ).resolves.toBe("clerk_disabled");
    await expect(
      classify_onboarding_state(
        { clerk_enabled: true, user_id: null, org_id: null },
        lookups(),
      ),
    ).resolves.toBe("unauthenticated");
  });

  it("offers choose_organization for multi-membership sessions with no active org", async () => {
    await expect(
      classify_onboarding_state(
        { ...signed_in, org_id: null },
        lookups({ active_memberships: 2 }),
      ),
    ).resolves.toBe("choose_organization");
  });

  it("keeps invitation_pending for zero or one memberships with no active org", async () => {
    await expect(
      classify_onboarding_state(
        { ...signed_in, org_id: null },
        lookups({ active_memberships: 0 }),
      ),
    ).resolves.toBe("invitation_pending");
    // Exactly one membership: the activator auto-activates it momentarily.
    await expect(
      classify_onboarding_state(
        { ...signed_in, org_id: null },
        lookups({ active_memberships: 1 }),
      ),
    ).resolves.toBe("invitation_pending");
  });

  it("returns ready on a resolved active membership", async () => {
    await expect(
      classify_onboarding_state(signed_in, lookups()),
    ).resolves.toBe("ready");
  });

  it("maps a FORBIDDEN resolution to reconciliation_required", async () => {
    await expect(
      classify_onboarding_state(
        signed_in,
        lookups({ resolution: { kind: "rejected", code: "FORBIDDEN" } }),
      ),
    ).resolves.toBe("reconciliation_required");
  });

  it("distinguishes suspended / removed / still-syncing memberships", async () => {
    const rejected: MembershipResolution = {
      kind: "rejected",
      code: "MEMBERSHIP_INACTIVE",
    };
    await expect(
      classify_onboarding_state(
        signed_in,
        lookups({ resolution: rejected, projection_status: "suspended" }),
      ),
    ).resolves.toBe("access_suspended");
    await expect(
      classify_onboarding_state(
        signed_in,
        lookups({ resolution: rejected, projection_status: "revoked" }),
      ),
    ).resolves.toBe("membership_removed");
    await expect(
      classify_onboarding_state(
        signed_in,
        lookups({ resolution: rejected, projection_status: null }),
      ),
    ).resolves.toBe("membership_sync_pending");
  });

  it("treats an UNAUTHENTICATED resolution as sync pending (profile not projected)", async () => {
    await expect(
      classify_onboarding_state(
        signed_in,
        lookups({ resolution: { kind: "rejected", code: "UNAUTHENTICATED" } }),
      ),
    ).resolves.toBe("membership_sync_pending");
  });
});
