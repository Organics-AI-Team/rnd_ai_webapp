"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { trpc } from "./trpc-client";
import { useRouter } from "next/navigation";

interface User {
  _id: string;
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
    { enabled: !!token, retry: false }
  );

  // Load token from localStorage on mount and sync with cookie
  useEffect(() => {
    const storedToken = localStorage.getItem("auth_token");
    console.log("Auth Context - Stored token:", storedToken ? "exists" : "null");
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
    console.log("Auth Context - meData:", meData ? "exists" : "null", "token:", token ? "exists" : "null", "error:", meError ? "yes" : "no");
    if (meData) {
      console.log("Auth Context - Setting user:", meData.user);
      setUser(meData.user);
      setOrganization(meData.organization);
      setIsLoading(false);
    } else if (token && meError) {
      // Token exists but meData failed with error (invalid session)
      console.log("Auth Context - Token exists but meData failed, clearing session");
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

  const login = async (email: string, password: string) => {
    try {
      console.log("Login - Starting login process");
      const result = await loginMutation.mutateAsync({ email, password });
      console.log("Login - Received result:", result ? "success" : "failed", "token:", result?.token ? "exists" : "missing");
      setToken(result.token);
      setUser(result.user);
      localStorage.setItem("auth_token", result.token);
      console.log("Login - Token saved to localStorage");
      // Set cookie for middleware
      document.cookie = `auth_token=${result.token}; path=/; max-age=${30 * 24 * 60 * 60}; samesite=lax`;
      console.log("Login - Cookie set");
      await refetchMe();
      console.log("Login - Refetched user data");
      router.push("/");
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
      const result = await signupMutation.mutateAsync({
        email,
        password,
        name,
        organizationName,
      });
      setToken(result.token);
      setUser(result.user);
      localStorage.setItem("auth_token", result.token);
      // Set cookie for middleware
      document.cookie = `auth_token=${result.token}; path=/; max-age=${30 * 24 * 60 * 60}; samesite=lax`;
      await refetchMe();
      router.push("/");
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
    localStorage.removeItem("auth_token");
    // Remove cookie
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
