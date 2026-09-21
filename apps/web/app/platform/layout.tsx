import type { ReactNode } from "react";

import { createTRPCContext } from "@/server/trpc";

export const dynamic = "force-dynamic";

/**
 * Platform administration shell. Access is decided by a server-side
 * principal check — only platform roles may see any child page. There is no
 * tenant business data and no support impersonation shortcut here.
 *
 * @param props - Child pages of the platform console.
 * @returns Platform console or an access-denied panel.
 */
export default async function PlatformLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const context = await createTRPCContext();
  const is_platform = context.principal?.platform_role != null;

  if (!is_platform) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-md text-center space-y-2">
          <h1 className="text-xl font-semibold">Platform access required</h1>
          <p className="text-sm text-muted-foreground">
            This console is available to platform administrators only.
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b px-8 py-4">
        <h1 className="text-lg font-semibold">Platform administration</h1>
        <p className="text-xs text-muted-foreground">
          Signed in with platform role: {context.principal?.platform_role}
        </p>
      </header>
      <div className="p-8">{children}</div>
    </div>
  );
}
