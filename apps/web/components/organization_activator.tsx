"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useOrganizationList } from "@clerk/nextjs";

/**
 * Activate the user's university organization on the Clerk session.
 *
 * Clerk sessions start with no active organization: a user who has just
 * accepted an invitation is a member of exactly one organization, but
 * `orgId` stays null until something calls `setActive`. Without this,
 * onboarding reports "Invitation pending" forever and every tenant-scoped
 * page stays empty. This component activates the sole membership once and
 * refreshes the route so server-side resolution sees the organization.
 *
 * Renders nothing; safe to mount on any page.
 */
export function OrganizationActivator() {
  const router = useRouter();
  const { orgId, isLoaded: auth_loaded } = useAuth();
  const { isLoaded: list_loaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: { pageSize: 5 },
  });
  const activating = useRef(false);

  useEffect(() => {
    if (!auth_loaded || !list_loaded || orgId || activating.current) return;
    const memberships = userMemberships?.data ?? [];
    if (memberships.length === 0 || !setActive) return;
    activating.current = true;
    console.info("[organization-activator] activating sole membership");
    void setActive({ organization: memberships[0].organization.id })
      .then(() => router.refresh())
      .catch((error) => {
        activating.current = false;
        console.error("[organization-activator] activation failed", error);
      });
  }, [auth_loaded, list_loaded, orgId, userMemberships?.data, setActive, router]);

  return null;
}
