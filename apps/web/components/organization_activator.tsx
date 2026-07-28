"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useOrganizationList } from "@clerk/nextjs";

/**
 * Organization context guard (Plan 3).
 *
 * Clerk sessions start with no active organization. With exactly ONE
 * membership the sole organization is activated automatically; with more
 * than one the user chooses explicitly — memberships[0] is never assumed.
 * Mounted in the authenticated layout (conditional-layout.tsx) so
 * mid-session organization loss also lands here, not just /onboarding.
 * Clerk-only: the mount site gates on the publishable key because the
 * legacy flow has no ClerkProvider and these hooks would throw.
 */
export function OrganizationActivator() {
  const router = useRouter();
  const { orgId, isLoaded: auth_loaded } = useAuth();
  const { isLoaded: list_loaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: { pageSize: 20 },
  });
  const activating = useRef(false);
  const memberships = userMemberships?.data ?? [];

  useEffect(() => {
    if (!auth_loaded || !list_loaded || orgId || activating.current) return;
    if (memberships.length !== 1 || !setActive) return; // >1 → explicit picker below
    activating.current = true;
    console.info("[organization-activator] activating sole membership");
    void setActive({ organization: memberships[0].organization.id })
      .then(() => router.refresh())
      .catch((error) => {
        activating.current = false;
        console.error("[organization-activator] activation failed", error);
      });
  }, [auth_loaded, list_loaded, orgId, memberships, setActive, router]);

  /**
   * Activate one explicitly chosen organization and refresh server state.
   *
   * @param organization_id - Clerk organization id chosen by the user.
   */
  const choose = (organization_id: string) => {
    if (!setActive || activating.current) return;
    activating.current = true;
    console.info("[organization-activator] activating chosen organization");
    void setActive({ organization: organization_id })
      .then(() => router.refresh())
      .catch((error) => {
        activating.current = false;
        console.error("[organization-activator] activation failed", error);
      });
  };

  if (!auth_loaded || !list_loaded || orgId || memberships.length <= 1) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
      <div className="w-full max-w-sm space-y-3 rounded border bg-white p-5 shadow">
        <h2 className="text-base font-semibold">Select an organization to continue</h2>
        <p className="text-xs text-muted-foreground">
          Your account belongs to more than one university.
        </p>
        <div className="space-y-1.5">
          {memberships.map((membership) => (
            <button
              key={membership.organization.id}
              type="button"
              className="w-full rounded border px-3 py-2 text-left text-sm hover:bg-gray-50"
              onClick={() => choose(membership.organization.id)}
            >
              {membership.organization.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
