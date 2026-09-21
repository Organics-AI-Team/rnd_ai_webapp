"use client";

import React, { createContext, useContext, useMemo } from "react";
import { useAuth as useClerkAuth, useClerk, useUser } from "@clerk/nextjs";

import { trpc } from "./trpc-client";

/**
 * Application auth view (G1.7). Clerk owns identity and sessions; this
 * context adapts the Clerk session plus the tenant-scoped organization query
 * into the narrow shape the application UI consumes. Tokens are never
 * persisted in localStorage or JavaScript-readable cookies — Clerk manages
 * its own httpOnly session.
 */
export interface AppAuthUser {
  id: string;
  name: string;
  email: string;
  /** Legacy display-role label: "admin" for tenant managers, else "shopper". */
  role: "admin" | "shopper";
}

export interface AppAuthOrganization {
  _id: string;
  name: string;
  credits: number;
}

export interface AppAuthContextValue {
  user: AppAuthUser | null;
  organization: AppAuthOrganization | null;
  isLoading: boolean;
  logout: () => Promise<void>;
}

const AppAuthContext = createContext<AppAuthContextValue | undefined>(undefined);

const clerk_enabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/**
 * Clerk-backed provider. Rendered only when Clerk is configured (inside
 * ClerkProvider); organization data comes from the tenant-scoped router.
 *
 * @param props - Child tree.
 * @returns Context provider with live session state.
 */
function ClerkAppAuthProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useUser();
  const { orgRole, orgId } = useClerkAuth();
  const clerk = useClerk();
  const organizations = trpc.organizations.list.useQuery(undefined, {
    enabled: Boolean(user && orgId),
    retry: false,
  });

  const value = useMemo<AppAuthContextValue>(() => {
    const organization = organizations.data?.[0] as
      | (AppAuthOrganization & Record<string, unknown>)
      | undefined;
    return {
      user: user
        ? {
            id: user.id,
            name: user.fullName ?? user.primaryEmailAddress?.emailAddress ?? "",
            email: user.primaryEmailAddress?.emailAddress ?? "",
            role:
              orgRole === "org:manager" || orgRole === "org:admin"
                ? "admin"
                : "shopper",
          }
        : null,
      organization: organization
        ? {
            _id: String(organization._id),
            name: String(organization.name),
            credits: Number(organization.credits ?? 0),
          }
        : null,
      isLoading: !isLoaded,
      logout: async () => {
        await clerk.signOut({ redirectUrl: "/sign-in" });
      },
    };
  }, [user, isLoaded, orgRole, organizations.data, clerk]);

  return <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>;
}

/**
 * Signed-out provider for deployments without Clerk configuration (local
 * builds without keys). Every guard treats this as anonymous.
 *
 * @param props - Child tree.
 * @returns Context provider with anonymous state.
 */
function DisabledAppAuthProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo<AppAuthContextValue>(
    () => ({
      user: null,
      organization: null,
      isLoading: false,
      logout: async () => {},
    }),
    [],
  );
  return <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>;
}

/**
 * Application auth provider. Selects the Clerk-backed implementation when
 * the publishable key is configured at build time.
 *
 * @param props - Child tree.
 * @returns Auth context provider.
 */
export function AppAuthProvider({ children }: { children: React.ReactNode }) {
  if (clerk_enabled) {
    return <ClerkAppAuthProvider>{children}</ClerkAppAuthProvider>;
  }
  return <DisabledAppAuthProvider>{children}</DisabledAppAuthProvider>;
}

/**
 * Read the application auth view.
 *
 * @returns Current auth context value.
 * @throws Error when used outside AppAuthProvider.
 */
export function useAuth(): AppAuthContextValue {
  const context = useContext(AppAuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within AppAuthProvider");
  }
  return context;
}
