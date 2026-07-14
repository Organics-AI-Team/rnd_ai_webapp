import Link from "next/link";
import { SignUp } from "@clerk/nextjs";

import { is_clerk_enabled } from "@/lib/server/clerk-config";

export const dynamic = "force-dynamic";

/**
 * Clerk sign-up catch-all page (G1.1). Sign-up serves invited users only:
 * production Clerk instance settings require an invitation, and no
 * organization self-service component is rendered anywhere.
 *
 * @returns Sign-up surface or pre-cutover notice.
 */
export default function SignUpPage() {
  if (!is_clerk_enabled()) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-semibold">Sign-up is invitation-only</h1>
          <p className="text-sm text-muted-foreground">
            University access is provisioned by platform administration. If you
            received an invitation, follow the link in your invitation email.
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
      <SignUp />
    </main>
  );
}
