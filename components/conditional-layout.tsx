"use client";

import { usePathname } from "next/navigation";
import { Navigation } from "./navigation";

export function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Pages that should not have the navigation sidebar
  const publicPages = ["/login", "/signup"];
  const isPublicPage = publicPages.includes(pathname);

  if (isPublicPage) {
    return <>{children}</>;
  }

  return (
    <Navigation>
      <main className="p-6">{children}</main>
    </Navigation>
  );
}
