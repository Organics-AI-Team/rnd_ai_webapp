"use client";

import { usePathname } from "next/navigation";
import { Navigation } from "./navigation";
import { AdminNavigation } from "./admin-navigation";
import { OrganizationActivator } from "./organization_activator";
import { CrossOrgNotFoundHint } from "./cross_org_not_found_hint";

// Clerk components render only when the deployment configures Clerk — the
// legacy flow has no ClerkProvider and Clerk hooks would throw (same
// build-time check as app-auth.tsx).
const clerk_enabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Pages that should not have the navigation sidebar
  const publicPages = ["/login", "/signup"];
  const isPublicPage = publicPages.includes(pathname);

  // Check if current route is an admin route
  const isAdminRoute = pathname.startsWith("/admin");

  // AI pages need full height without padding for proper viewport sizing
  const aiPages = ["/ai/raw-materials-ai", "/ai/sales-rnd-ai"];
  const isAIPage = aiPages.includes(pathname);

  if (isPublicPage) {
    return <>{children}</>;
  }

  // Org-context guard: auto-activates a sole membership; renders an explicit
  // picker for multi-membership sessions with no active organization. The
  // cross-org NOT_FOUND hint shares the Clerk gate.
  const org_guard = clerk_enabled ? (
    <>
      <OrganizationActivator />
      <CrossOrgNotFoundHint />
    </>
  ) : null;

  // If it's an admin route, use AdminNavigation
  if (isAdminRoute) {
    return (
      <>
        {org_guard}
        <AdminNavigation>
          <main className="p-6">{children}</main>
        </AdminNavigation>
      </>
    );
  }

  return (
    <>
      {org_guard}
      <Navigation>
        <main className={isAIPage ? "h-full" : "p-6"}>{children}</main>
      </Navigation>
    </>
  );
}
