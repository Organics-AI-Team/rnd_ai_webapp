import Link from "next/link";
import { auth } from "@clerk/nextjs/server";

import { is_clerk_enabled } from "@/lib/server/clerk-config";

export const dynamic = "force-dynamic";

type OnboardingState =
  | "clerk_disabled"
  | "unauthenticated"
  | "invitation_pending"
  | "membership_sync_pending";

/**
 * Determine the onboarding state from the server-side Clerk principal only.
 * This page never queries tenant business data.
 *
 * @returns Onboarding state for the current request.
 */
async function resolve_onboarding_state(): Promise<OnboardingState> {
  if (!is_clerk_enabled()) return "clerk_disabled";
  const { userId, orgId } = await auth();
  if (!userId) return "unauthenticated";
  if (!orgId) return "invitation_pending";
  // A Clerk organization exists but the internal membership projection may
  // not be synchronized yet (webhook processing, G1.5) — the principal
  // resolver (G1.3) turns this state into a real membership.
  return "membership_sync_pending";
}

/**
 * Onboarding status page (G1.1). Shows three explicit states from the
 * server-side principal lookup: invitation pending, membership
 * synchronization pending, or contact support.
 *
 * @returns Onboarding status view.
 */
export default async function OnboardingPage() {
  const state = await resolve_onboarding_state();

  const content: Record<OnboardingState, { title: string; body: string }> = {
    clerk_disabled: {
      title: "Onboarding is not available yet",
      body: "This deployment has not enabled the new sign-in system. Please use the current login page or contact support.",
    },
    unauthenticated: {
      title: "Please sign in first",
      body: "Sign in with your invited account to continue onboarding.",
    },
    invitation_pending: {
      title: "Invitation pending",
      body: "Your account is not a member of a university yet. Ask your university manager to send you an invitation, then follow the link in the invitation email.",
    },
    membership_sync_pending: {
      title: "Membership synchronization pending",
      body: "Your university membership is being synchronized. This usually completes within a minute — refresh this page. If it persists, contact support.",
    },
  };

  const { title, body } = content[state];

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
        {state === "unauthenticated" && (
          <Link className="underline" href="/sign-in">
            Go to sign-in
          </Link>
        )}
        <p className="text-xs text-muted-foreground">
          Need help? Contact support at your university administration.
        </p>
      </div>
    </main>
  );
}
