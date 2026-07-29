"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { OrganizationSwitcher, useAuth as useClerkAuth } from "@clerk/nextjs";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Organization switcher plus the org-switch cache guard (Plan 3).
 *
 * tRPC query keys carry no organization id and React Query holds a
 * 10-minute gcTime, so without an explicit clear, tenant-A rows would bleed
 * into tenant-B views after switching. This component watches the active
 * orgId; on a REAL change (never the first render) it clears the entire
 * query cache and navigates home, and the server re-resolves the principal
 * from the new active organization.
 *
 * Clerk-only: the parent must gate rendering on the publishable key —
 * Clerk hooks throw outside ClerkProvider (app-auth.tsx pattern).
 */
export function OrgSwitcherPanel() {
  const { orgId } = useClerkAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const previous_org = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const current = orgId ?? null;
    if (previous_org.current === undefined) {
      previous_org.current = current; // first render: record only, never clear
      return;
    }
    if (previous_org.current !== current) {
      previous_org.current = current;
      console.info({
        boundary: "org-switcher",
        event: "org.switched",
        cache_cleared: true,
      });
      queryClient.clear();
      router.push("/");
      router.refresh();
    }
  }, [orgId, queryClient, router]);

  return (
    <OrganizationSwitcher
      hidePersonal
      afterSelectOrganizationUrl="/"
      appearance={{
        elements: {
          // Member admin stays in-app (/settings/members) and organizations
          // are platform-provisioned; hide Clerk's own management surfaces.
          // Instance-level settings additionally disable member-initiated
          // leave (Task 14); the zero-manager detector is the backstop.
          organizationSwitcherPopoverActionButton__manageOrganization: {
            display: "none",
          },
          organizationSwitcherPopoverActionButton__createOrganization: {
            display: "none",
          },
        },
      }}
    />
  );
}
