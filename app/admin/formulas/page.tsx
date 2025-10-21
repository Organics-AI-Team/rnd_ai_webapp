"use client";

import { useAuth } from "@/lib/auth-context";
import { FormulaForm } from "@/components/formula-form";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { Beaker, ArrowLeft } from "lucide-react";

export default function AdminFormulasPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Card className="max-w-md">
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-red-600 font-semibold mb-4">กรุณาเข้าสู่ระบบ</p>
              <p className="text-gray-600 mb-4">
                คุณต้องเข้าสู่ระบบก่อนเข้าใช้งานหน้านี้
              </p>
              <Button onClick={() => router.push("/login")}>
                ไปหน้าเข้าสู่ระบบ
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Only allow admin role
  if (user.role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Card className="max-w-md">
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-red-600 font-semibold mb-4">Access Denied</p>
              <p className="text-gray-600 mb-4">
                Only administrators can access this page.
              </p>
              <Button onClick={() => router.push("/formulas")}>
                ไปที่สูตรทั้งหมด
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Button
            variant="ghost"
            onClick={() => router.back()}
            className="mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            ย้อนกลับ
          </Button>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-600 rounded-lg">
                <Beaker className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">
                  เพิ่มสูตรใหม่
                </h1>
                <p className="text-gray-600">
                  สร้างสูตรผลิตภัณฑ์เสริมอาหาร/เครื่องสำอาง
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Formula Form */}
        <FormulaForm />
      </div>
    </div>
  );
}
