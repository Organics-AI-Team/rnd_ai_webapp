import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import client_promise from "@rnd-ai/shared-database";

import { is_clerk_enabled } from "@/lib/server/clerk-config";
import {
  classify_onboarding_state,
  type MembershipResolution,
  type OnboardingState,
} from "@/lib/server/onboarding-state";
import { AuthorizationError } from "@/server/auth/errors";
import { resolve_clerk_principal } from "@/server/auth/clerk-principal-resolver";
import { create_identity_projection_repositories } from "@/server/auth/identity-repositories";

export const dynamic = "force-dynamic";

/**
 * Lazily connect and return the database handle (never touched when Clerk
 * is disabled — the classification short-circuits first).
 *
 * @returns Connected database handle.
 */
async function database() {
  return (await client_promise).db();
}

/**
 * Determine the onboarding state from the server-side Clerk session and the
 * internal identity projections. A Clerk organization on the session is not
 * enough — the database-authoritative membership projection decides whether
 * the user is onboarded, suspended, removed, still synchronizing, or must
 * choose among several organizations. Never queries tenant business data.
 *
 * @returns Onboarding state for the current request.
 */
async function resolve_onboarding_state(): Promise<OnboardingState> {
  const clerk_enabled = is_clerk_enabled();
  const auth_state = clerk_enabled ? await auth() : null;
  const snapshot = {
    clerk_enabled,
    user_id: auth_state?.userId ?? null,
    org_id: auth_state?.orgId ?? null,
  };

  return classify_onboarding_state(snapshot, {
    async resolve_membership(): Promise<MembershipResolution> {
      try {
        const principal = await resolve_clerk_principal(
          {
            userId: auth_state?.userId ?? null,
            orgId: auth_state?.orgId ?? null,
            orgRole: auth_state?.orgRole ?? null,
            sessionId: auth_state?.sessionId ?? null,
          },
          create_identity_projection_repositories(await database()),
        );
        console.info({
          boundary: "onboarding",
          event: "membership.resolved",
          membership_status: principal.membership_status,
        });
        return principal.membership_status === "active"
          ? { kind: "ready" }
          : { kind: "rejected", code: "MEMBERSHIP_INACTIVE" };
      } catch (error) {
        if (error instanceof AuthorizationError) {
          console.info({
            boundary: "onboarding",
            event: "membership.unresolved",
            code: error.code,
          });
          const code =
            error.code === "MEMBERSHIP_INACTIVE" || error.code === "FORBIDDEN"
              ? error.code
              : "UNAUTHENTICATED";
          return { kind: "rejected", code };
        }
        throw error;
      }
    },
    async find_projection_status() {
      const db = await database();
      const profile = await db
        .collection("user_profiles")
        .findOne({ clerkUserId: snapshot.user_id });
      const tenant = await db
        .collection("tenants")
        .findOne({ clerkOrganizationId: snapshot.org_id });
      if (!profile || !tenant) return null;
      const membership = await db
        .collection("tenant_membership_projections")
        .findOne({
          tenantId: tenant._id.toString(),
          userProfileId: profile._id.toString(),
        });
      const status = membership ? String(membership.status) : null;
      return status === "active" || status === "suspended" || status === "revoked"
        ? status
        : null;
    },
    async count_active_memberships() {
      const db = await database();
      const profile = await db
        .collection("user_profiles")
        .findOne({ clerkUserId: snapshot.user_id });
      if (!profile) return 0;
      return db.collection("tenant_membership_projections").countDocuments({
        userProfileId: profile._id.toString(),
        status: "active",
      });
    },
  });
}

/**
 * Onboarding status page. Explicit states from server-side principal
 * resolution — including Plan 3's suspended / removed / choose-organization
 * states. The org-context guard (organization activator + picker) is
 * mounted globally by the authenticated layout, not by this page.
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
    choose_organization: {
      title: "Choose your organization",
      body: "Your account belongs to more than one university. Pick the one you want to work in from the selector, or use the organization switcher in the sidebar.",
    },
    membership_sync_pending: {
      title: "Membership synchronization pending",
      body: "Your university membership is being synchronized. This usually completes within a minute — refresh this page. If it persists, contact support.",
    },
    access_suspended: {
      title: "Access suspended",
      body: "Your access was suspended by your university manager — contact your administrator to restore it.",
    },
    membership_removed: {
      title: "Membership removed",
      body: "You are no longer a member of this university. If this is unexpected, ask your university manager for a new invitation — accepting it restores your access.",
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
