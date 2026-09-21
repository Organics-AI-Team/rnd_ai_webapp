"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { trpc } from "./trpc-client";
import { useRouter } from "next/navigation";

interface User {
  _id: string;
  id: string; // Add id field for compatibility
  accountId: string;
  organizationId: string;
  email: string;
  name: string;
  role: string;
}

interface Organization {
  _id: string;
  name: string;
  credits: number;
  ownerId: string;
}

interface AuthContextType {
  user: User | null;
  organization: Organization | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string, organizationName: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const loginMutation = trpc.auth.login.useMutation();
  const signupMutation = trpc.auth.signup.useMutation();
  const logoutMutation = trpc.auth.logout.useMutation();
  const { data: meData, refetch: refetchMe, error: meError } = trpc.auth.me.useQuery(
    { token: token || "" },
    {
      enabled: !!token,
      retry: false,
      // The session is re-read on a timer only as a backstop for changes made
      // elsewhere (credits spent by another tab, an account deactivated by an
      // admin). At 5s this was three queries per signed-in user every five
      // seconds, forever, to observe data that changes maybe once a session.
      // Anything needing immediacy calls refreshUser(); returning to the tab
      // refetches regardless.
      refetchInterval: 60_000,
      refetchOnWindowFocus: true,
    }
  );

  // Load token from localStorage on mount and sync with cookie
  useEffect(() => {
    const storedToken = localStorage.getItem("auth_token");
    if (storedToken) {
      setToken(storedToken);
      // Ensure cookie is set
      document.cookie = `auth_token=${storedToken}; path=/; max-age=${30 * 24 * 60 * 60}; samesite=lax`;
    } else {
      setIsLoading(false);
    }
  }, []);

  // Update user when meData changes
  useEffect(() => {
    if (meData) {
      const userWithId = { ...meData.user, id: meData.user._id };
      setUser(userWithId);
      setOrganization(meData.organization);
      setIsLoading(false);
    } else if (token && meError) {
      // Token exists but meData failed with error (invalid session)
      setUser(null);
      setOrganization(null);
      setToken(null);
      localStorage.removeItem("auth_token");
      document.cookie = "auth_token=; path=/; max-age=0";
      setIsLoading(false);
    } else if (!token) {
      // No token, just finish loading
      setIsLoading(false);
    }
  }, [meData, token, meError]);

  /** Authenticate, persist the session, and land the user on the dashboard. */
  const login = useCallback(async (email: string, password: string) => {
    try {
      const result = await loginMutation.mutateAsync({ email, password });
      setToken(result.token);
      setUser({
        ...result.user,
        id: result.user._id
      });
      localStorage.setItem("auth_token", result.token);
      // Set cookie for middleware
      document.cookie = `auth_token=${result.token}; path=/; max-age=${30 * 24 * 60 * 60}; samesite=lax`;
      await refetchMe();
      router.push("/dashboard");
    } catch (error: any) {
      console.error("Login - Error:", error);
      throw new Error(error.message || "Login failed");
    }
  }, [loginMutation.mutateAsync, refetchMe, router]);

  /** Create an account plus organization, then sign the new user in. */
  const signup = useCallback(async (
    email: string,
    password: string,
    name: string,
    organizationName: string
  ) => {
    try {
      const result = await signupMutation.mutateAsync({
        email,
        password,
        name,
        organizationName,
      });
      setToken(result.token);
      setUser({
        ...result.user,
        id: result.user._id
      });
      localStorage.setItem("auth_token", result.token);
      // Set cookie for middleware
      document.cookie = `auth_token=${result.token}; path=/; max-age=${30 * 24 * 60 * 60}; samesite=lax`;
      await refetchMe();
      router.push("/dashboard");
    } catch (error: any) {
      throw new Error(error.message || "Signup failed");
    }
  }, [signupMutation.mutateAsync, refetchMe, router]);

  /** Clear the session on the server and locally, then return to login. */
  const logout = useCallback(async () => {
    if (token) {
      try {
        await logoutMutation.mutateAsync({ token });
      } catch (error) {
        console.error("Logout error:", error);
      }
    }
    setUser(null);
    setOrganization(null);
    setToken(null);
    localStorage.removeItem("auth_token");
    // Remove cookie
    document.cookie = "auth_token=; path=/; max-age=0";
    router.push("/login");
  }, [logoutMutation.mutateAsync, router, token]);

  /** Force an immediate re-read of the session (e.g. after a credit change). */
  const refreshUser = useCallback(async () => {
    if (token) {
      await refetchMe();
    }
  }, [refetchMe, token]);

  // The session is polled on an interval. Without this memo the provider
  // handed every consumer a brand-new object on each poll, re-rendering the
  // whole authenticated tree every few seconds (visible as the UI refreshing
  // on its own). Identity now changes only when the session actually does.
  const context_value = useMemo(
    () => ({ user, organization, token, isLoading, login, signup, logout, refreshUser }),
    [user, organization, token, isLoading, login, signup, logout, refreshUser],
  );

  return (
    <AuthContext.Provider value={context_value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
