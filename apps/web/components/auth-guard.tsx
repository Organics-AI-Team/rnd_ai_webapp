"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface AuthGuardProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
  fallbackPath?: string;
}

export function LoadingSpinner({ message = "กำลังโหลด..." }: { message?: string }) {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">{message}</p>
      </div>
    </div>
  );
}

export function UnauthenticatedCard({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <Card className="max-w-md">
        <CardContent className="pt-6">
          <div className="text-center">
            <p className="text-red-600 font-semibold mb-4">กรุณาเข้าสู่ระบบ</p>
            <p className="text-gray-600 mb-4">
              คุณต้องเข้าสู่ระบบก่อนเข้าใช้งานหน้านี้
            </p>
            <Button onClick={onLogin}>
              ไปหน้าเข้าสู่ระบบ
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function AccessDeniedCard() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <Card className="max-w-md">
        <CardContent className="pt-6">
          <div className="text-center">
            <p className="text-red-600 font-semibold mb-4">การเข้าถึงถูกปฏิเสธ</p>
            <p className="text-gray-600 mb-4">
              คุณไม่มีสิทธิ์เข้าถึงหน้านี้
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function AuthGuard({
  children,
  requireAdmin = false,
  fallbackPath = "/login"
}: AuthGuardProps) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!user) {
    return <UnauthenticatedCard onLogin={() => router.push(fallbackPath)} />;
  }

  if (requireAdmin && user.role !== "admin") {
    return <AccessDeniedCard />;
  }

  return <>{children}</>;
}