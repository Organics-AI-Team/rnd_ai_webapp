"use client";

import { usePathname } from "next/navigation";
import { Navigation } from "./navigation";
import { AdminNavigation } from "./admin-navigation";

export function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Pages that should not have the navigation sidebar
  const publicPages = ["/login", "/signup"];
  const isPublicPage = publicPages.includes(pathname);

  // Check if current route is an admin route
  const isAdminRoute = pathname.startsWith("/admin");

  const isAIPage = pathname === "/ai";

  if (isPublicPage) {
    return <>{children}</>;
  }

  // If it's an admin route, use AdminNavigation
  if (isAdminRoute) {
    return (
      <AdminNavigation>
        <main className="p-6">{children}</main>
      </AdminNavigation>
    );
  }

  return (
    <Navigation>
      <main className={isAIPage ? "h-full" : "p-6"}>{children}</main>
    </Navigation>
  );
}
