import { SignIn } from "@clerk/nextjs";

import { is_clerk_enabled } from "@/lib/server/clerk-config";

export const dynamic = "force-dynamic";

/**
 * Clerk sign-in catch-all page (G1.1). Renders the Clerk sign-in surface when
 * the deployment configures Clerk; otherwise explains that sign-in is not
 * enabled (the legacy login page was removed at the G1.7 cutover, so there is
 * no other page to link to).
 *
 * @returns Sign-in surface or configuration notice.
 */
export default function SignInPage() {
  if (!is_clerk_enabled()) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-semibold">Sign-in is not enabled</h1>
          <p className="text-sm text-muted-foreground">
            This deployment has not enabled the sign-in system yet. Contact
            your administrator to complete authentication setup.
          </p>
        </div>
      </main>
    );
  }
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <SignIn />
    </main>
  );
}
