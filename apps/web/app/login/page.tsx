"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { Package } from "lucide-react";

/**
 * Login page - Cloudflare-style clean authentication form
 *
 * Minimal, centered card with email/password fields
 */
export default function LoginPage() {
  const { login, isLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * Handles form submission for user authentication
   *
   * @param e - Form submit event
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-sidebar-bg flex items-center justify-center">
            <Package size={16} className="text-orange-500" />
          </div>
          <span className="text-base font-semibold text-foreground">R&D AI</span>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-center">Sign in to your account</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {error && (
                <div className="px-2.5 py-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Signing in..." : "Sign in"}
              </Button>

              <div className="text-center text-xs">
                <span className="text-muted-foreground">No account? </span>
                <Link href="/signup" className="text-primary hover:underline font-medium">
                  Create one
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
