"use client";

import { useAuth } from "@/lib/auth-context";
import { FormulaForm } from "@/components/formula-form";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { ConsolePageShell } from "@/components/console_page_shell";

/**
 * CreateFormulaPage — Cloudflare-minimal create formula page.
 * Wraps FormulaForm inside ConsolePageShell for consistent design system.
 *
 * @returns JSX.Element - The create formula page
 */
export default function CreateFormulaPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400 mx-auto"></div>
          <p className="mt-3 text-[12px] text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="border border-gray-200/60 rounded-xl bg-white p-6 max-w-sm text-center">
          <p className="text-[13px] font-medium text-gray-800 mb-2">กรุณาเข้าสู่ระบบ</p>
          <p className="text-[12px] text-gray-400 mb-4">
            คุณต้องเข้าสู่ระบบก่อนเข้าใช้งานหน้านี้
          </p>
          <Button
            onClick={() => router.push("/login")}
            className="bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-[12px] h-8 px-3"
          >
            ไปหน้าเข้าสู่ระบบ
          </Button>
        </div>
      </div>
    );
  }

  // Only allow admin role
  if (user.role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="border border-gray-200/60 rounded-xl bg-white p-6 max-w-sm text-center">
          <p className="text-[13px] font-medium text-gray-800 mb-2">Access Denied</p>
          <p className="text-[12px] text-gray-400 mb-4">
            Only administrators can access this page.
          </p>
          <Button
            onClick={() => router.push("/formulas")}
            className="bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-[12px] h-8 px-3"
          >
            ไปที่สูตรทั้งหมด
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ConsolePageShell
      title="เพิ่มสูตรใหม่"
      subtitle="สร้างสูตรผลิตภัณฑ์เสริมอาหาร/เครื่องสำอาง"
      show_action={false}
    >
      <div className="p-4">
        <FormulaForm />
      </div>
    </ConsolePageShell>
  );
}
