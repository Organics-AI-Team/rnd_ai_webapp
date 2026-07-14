import Link from "next/link";
import { SignIn } from "@clerk/nextjs";

import { is_clerk_enabled } from "@/lib/server/clerk-config";

export const dynamic = "force-dynamic";

/**
 * Clerk sign-in catch-all page (G1.1). Renders the Clerk sign-in surface when
 * the deployment configures Clerk; otherwise points at the legacy login page,
 * which remains active until the G1.7 cutover.
 *
 * @returns Sign-in surface or pre-cutover notice.
 */
export default function SignInPage() {
  if (!is_clerk_enabled()) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-semibold">Sign-in is not enabled yet</h1>
          <p className="text-sm text-muted-foreground">
            This deployment has not been switched to the new sign-in system.
            Please use the current login page.
          </p>
          <Link className="underline" href="/login">
            Go to login
          </Link>
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
