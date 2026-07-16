import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import client_promise from "@rnd-ai/shared-database";

import { is_clerk_enabled } from "@/lib/server/clerk-config";
import { AuthorizationError } from "@/server/auth/errors";
import { resolve_clerk_principal } from "@/server/auth/clerk-principal-resolver";
import { create_identity_projection_repositories } from "@/server/auth/identity-repositories";

export const dynamic = "force-dynamic";

type OnboardingState =
  | "clerk_disabled"
  | "unauthenticated"
  | "invitation_pending"
  | "membership_sync_pending"
  | "reconciliation_required"
  | "ready";

/**
 * Determine the onboarding state from the server-side Clerk session and the
 * internal identity projections. A Clerk organization on the session is not
 * enough — the database-authoritative membership projection decides whether
 * the user is actually onboarded, still synchronizing, or needs support.
 * This page never queries tenant business data.
 *
 * @returns Onboarding state for the current request.
 */
async function resolve_onboarding_state(): Promise<OnboardingState> {
  if (!is_clerk_enabled()) return "clerk_disabled";
  const auth_state = await auth();
  if (!auth_state.userId) return "unauthenticated";
  if (!auth_state.orgId) return "invitation_pending";

  try {
    const repositories = create_identity_projection_repositories(
      (await client_promise).db(),
    );
    const principal = await resolve_clerk_principal(
      {
        userId: auth_state.userId,
        orgId: auth_state.orgId ?? null,
        orgRole: auth_state.orgRole ?? null,
        sessionId: auth_state.sessionId ?? null,
      },
      repositories,
    );
    console.info({
      boundary: "onboarding",
      event: "membership.resolved",
      membership_status: principal.membership_status,
    });
    return principal.membership_status === "active"
      ? "ready"
      : "membership_sync_pending";
  } catch (error) {
    if (error instanceof AuthorizationError) {
      // UNAUTHENTICATED (profile not projected yet) and MEMBERSHIP_INACTIVE
      // (membership not projected yet) are normal webhook-lag states;
      // FORBIDDEN (inactive tenant or role mismatch) needs an operator.
      console.info({
        boundary: "onboarding",
        event: "membership.unresolved",
        code: error.code,
      });
      return error.code === "FORBIDDEN"
        ? "reconciliation_required"
        : "membership_sync_pending";
    }
    throw error;
  }
}

/**
 * Onboarding status page (G1.1). Shows explicit states from the server-side
 * principal resolution: invitation pending, membership synchronization
 * pending, reconciliation required, or ready with a link into the app.
 *
 * @returns Onboarding status view.
 */
export default async function OnboardingPage() {
  const state = await resolve_onboarding_state();

  const content: Record<OnboardingState, { title: string; body: string }> = {
    clerk_disabled: {
      title: "Onboarding is not available yet",
      body: "This deployment has not enabled the sign-in system. Contact your administrator.",
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
    reconciliation_required: {
      title: "Account needs attention",
      body: "Your membership requires review by an administrator before you can continue. Please contact support at your university administration.",
    },
    ready: {
      title: "You're all set",
      body: "Your university membership is active. Continue into the application.",
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
        {state === "ready" && (
          <Link className="underline" href="/dashboard">
            Go to dashboard
          </Link>
        )}
        <p className="text-xs text-muted-foreground">
          Need help? Contact support at your university administration.
        </p>
      </div>
    </main>
  );
}
