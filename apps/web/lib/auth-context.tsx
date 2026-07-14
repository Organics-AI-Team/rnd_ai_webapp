"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
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


/**
 * Read the auth_token cookie value in the browser.
 *
 * The cookie is the single client-side token store (G0.7): tokens are never
 * persisted to browser storage APIs, which the G0 security scanner rejects.
 *
 * @returns The token value, or null when the cookie is absent.
 */
function read_auth_token_cookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)auth_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

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
      refetchInterval: 5000, // Refetch every 5 seconds
      refetchOnWindowFocus: true,
    }
  );

  // Load the token from the auth cookie on mount (single client-side store)
  useEffect(() => {
    let is_active = true;
    const storedToken = read_auth_token_cookie();

    queueMicrotask(() => {
      if (!is_active) return;
      if (storedToken) setToken(storedToken);
      else setIsLoading(false);
    });

    return () => {
      is_active = false;
    };
  }, []);

  // Update user when meData changes
  useEffect(() => {
    let is_active = true;

    queueMicrotask(() => {
      if (!is_active) return;
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
        document.cookie = "auth_token=; path=/; max-age=0";
        setIsLoading(false);
      } else if (!token) {
        // No token, just finish loading
        setIsLoading(false);
      }
    });

    return () => {
      is_active = false;
    };
  }, [meData, token, meError]);

  const login = async (email: string, password: string) => {
    try {
      const result = await loginMutation.mutateAsync({ email, password });
      setToken(result.token);
      setUser({
        ...result.user,
        id: result.user._id
      });
      // The cookie is the single client-side token store.
      document.cookie = `auth_token=${result.token}; path=/; max-age=${30 * 24 * 60 * 60}; samesite=lax`;
      await refetchMe();
      router.push("/dashboard");
    } catch (error: any) {
      console.error("Login - Error:", error);
      throw new Error(error.message || "Login failed");
    }
  };

  const signup = async (
    email: string,
    password: string,
    name: string,
    organizationName: string
  ) => {
    try {
      // Public self-signup is closed (G0.5); the server always rejects this
      // with an explicit provisioning message, which we surface verbatim.
      await signupMutation.mutateAsync({
        email,
        password,
        name,
        organizationName,
      });
      throw new Error("University sign-up is closed.");
    } catch (error: any) {
      throw new Error(error.message || "Signup failed");
    }
  };

  const logout = async () => {
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
    // Remove cookie (the single client-side token store)
    document.cookie = "auth_token=; path=/; max-age=0";
    router.push("/login");
  };

  const refreshUser = async () => {
    if (token) {
      await refetchMe();
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        organization,
        token,
        isLoading,
        login,
        signup,
        logout,
        refreshUser,
      }}
    >
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
