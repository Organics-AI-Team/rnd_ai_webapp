"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Package, ClipboardList, Truck, LogOut, Settings, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export function Navigation({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, organization, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const links = [
    {
      href: "/",
      label: "รับออเดอร์",
      icon: Package,
    },
    {
      href: "/dashboard",
      label: "แดชบอร์ด",
      icon: ClipboardList,
    },
    {
      href: "/shipping",
      label: "จัดส่ง",
      icon: Truck,
    },
    {
      href: "/admin/credits",
      label: "จัดการ Credits",
      icon: Settings,
      adminOnly: true,
    },
  ];

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  return (
    <div className="flex h-screen">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-2">
            <Package size={24} className="text-line" />
            <h1 className="text-base font-bold text-gray-900">
              ระบบจัดการสินค้าเสริม
            </h1>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Overlay for mobile menu */}
      {isMobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-40"
          onClick={closeMobileMenu}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed lg:static inset-y-0 left-0 z-40 w-64 bg-white border-r flex flex-col transition-transform duration-300 lg:translate-x-0",
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Header - Desktop only */}
        <div className="hidden lg:block p-6 border-b">
          <div className="flex items-center gap-3">
            <Package size={28} className="text-line" />
            <h1 className="text-lg font-bold text-gray-900">
              ระบบจัดการสินค้าเสริม
            </h1>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 p-4 overflow-y-auto mt-16 lg:mt-0">
          <div className="space-y-1">
            {links.map((link: any) => {
              // Skip admin-only links if user is not admin/owner
              if (link.adminOnly && user?.role !== "owner" && user?.role !== "admin") {
                return null;
              }

              const Icon = link.icon;
              const isActive = pathname === link.href;

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={closeMobileMenu}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors",
                    isActive
                      ? "bg-line text-white"
                      : "text-gray-600 hover:bg-gray-100"
                  )}
                >
                  <Icon size={20} />
                  {link.label}
                </Link>
              );
            })}
          </div>
        </nav>

        {/* User Section */}
        {user && organization && (
          <div className="p-4 border-t bg-gray-50">
            {/* Credits Card */}
            <div className="mb-3 p-3 bg-gradient-to-r from-line to-line-dark rounded-lg text-white">
              <p className="text-xs opacity-90">Credits คงเหลือ</p>
              <p className="text-2xl font-bold">฿{organization.credits.toFixed(2)}</p>
              <p className="text-xs opacity-90 mt-1">{organization.name}</p>
            </div>

            {/* User Info */}
            <div className="mb-3 p-3 bg-white rounded-lg border">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-full bg-line text-white flex items-center justify-center font-semibold">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{user.name}</p>
                  <p className="text-xs text-gray-500 truncate">{user.email}</p>
                </div>
              </div>
              <div className="mt-2">
                <span className="inline-block px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                  {user.role === "owner" ? "เจ้าของ" : user.role === "admin" ? "ผู้ดูแล" : "สมาชิก"}
                </span>
              </div>
            </div>

            {/* Logout Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              className="w-full flex items-center justify-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <LogOut size={16} />
              ออกจากระบบ
            </Button>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto bg-gray-50 pt-16 lg:pt-0">
        {children}
      </div>
    </div>
  );
}
