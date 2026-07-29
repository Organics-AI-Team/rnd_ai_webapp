"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useOrganizationList } from "@clerk/nextjs";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Cross-org NOT_FOUND hint (Plan 3). Cross-org deep links resolve against
 * the ACTIVE organization (slug routing is deferred), so a NOT_FOUND for a
 * multi-membership user often means "right link, wrong org". This banner
 * subscribes to the React Query cache; when any query settles in a
 * NOT_FOUND error and the user belongs to more than one organization, it
 * suggests switching. Dismissible; auto-clears on navigation.
 *
 * Clerk-only: the mount site gates on the publishable key (Clerk hooks
 * throw without ClerkProvider).
 */
export function CrossOrgNotFoundHint() {
  const [visible, set_visible] = useState(false);
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { isLoaded, userMemberships } = useOrganizationList({
    userMemberships: { pageSize: 20 },
  });
  const other_org_count = (userMemberships?.data?.length ?? 0) - 1;

  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      const candidate = event as {
        type?: string;
        query?: { state?: { error?: { data?: { code?: string } } | null } };
      };
      if (
        candidate.type === "updated" &&
        candidate.query?.state?.error?.data?.code === "NOT_FOUND"
      ) {
        set_visible(true);
      }
    });
    return unsubscribe;
  }, [queryClient]);

  // A navigation resets the hint — it describes the previous view's failure.
  useEffect(() => {
    set_visible(false);
  }, [pathname]);

  if (!visible || !isLoaded || other_org_count < 1) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded border bg-white p-3 text-sm shadow">
      <p>
        Not found in this organization — you belong to {other_org_count} other
        {other_org_count > 1 ? "s" : ""}. Try switching with the organization
        switcher in the sidebar.
      </p>
      <button
        type="button"
        className="mt-2 text-xs underline"
        onClick={() => set_visible(false)}
      >
        Dismiss
      </button>
    </div>
  );
}
