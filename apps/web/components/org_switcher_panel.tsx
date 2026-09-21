"use client";

import { useEffect, useRef, useState } from "react";
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
  const { orgId, isLoaded } = useClerkAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const previous_org = useRef<string | null | undefined>(undefined);
  const [is_syncing, set_is_syncing] = useState(false);
  const [sync_error, set_sync_error] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    const current = orgId ?? null;
    if (previous_org.current === undefined) {
      previous_org.current = current; // first render: record only, never clear
      return;
    }
    if (previous_org.current !== current) {
      let cancelled = false;
      set_is_syncing(true);
      set_sync_error(null);
      void (async () => {
        await queryClient.cancelQueries();
        let last_failure = "The server session did not confirm the selected organization.";
        for (let attempt = 0; attempt < 20 && !cancelled; attempt += 1) {
          let body: { organization_id?: string | null } | null = null;
          try {
            const response = await fetch("/api/auth/session-organization", {
              credentials: "include",
              cache: "no-store",
            });
            if (!response.ok) {
              last_failure = `Organization session check failed (${response.status}).`;
            } else {
              body = await response.json();
            }
          } catch (error) {
            last_failure = error instanceof Error
              ? error.message
              : "Organization session check failed.";
          }
          if (body?.organization_id === current) {
            previous_org.current = current;
            queryClient.clear();
            console.info({
              boundary: "org-switcher",
              event: "org.switched",
              cache_cleared: true,
              server_session_confirmed: true,
            });
            router.replace("/");
            router.refresh();
            set_is_syncing(false);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        if (!cancelled) {
          console.error({
            boundary: "org-switcher",
            event: "org.switch_confirmation_failed",
            selected_organization_id: current,
          });
          set_sync_error(last_failure);
          set_is_syncing(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
  }, [isLoaded, orgId, queryClient, router]);

  return (
    <>
      <OrganizationSwitcher
        hidePersonal
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
      {is_syncing && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-white/90 text-sm">
          Switching organization securely…
        </div>
      )}
      {sync_error && (
        <div className="fixed inset-x-4 bottom-4 z-[101] rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 shadow-lg">
          <p>Organization switch was not confirmed: {sync_error}</p>
          <button
            type="button"
            className="mt-2 rounded border border-red-300 px-2 py-1 font-medium"
            onClick={() => window.location.reload()}
          >
            Reload and retry
          </button>
        </div>
      )}
    </>
  );
}
