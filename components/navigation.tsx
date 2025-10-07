"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Package, ClipboardList, Truck, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export function Navigation({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();

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
  ];

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r flex flex-col">
        {/* Header */}
        <div className="p-6 border-b">
          <div className="flex items-center gap-3">
            <Package size={28} className="text-line" />
            <h1 className="text-lg font-bold text-gray-900">
              ระบบจัดการสินค้าเสริม
            </h1>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 p-4">
          <div className="space-y-1">
            {links.map((link) => {
              const Icon = link.icon;
              const isActive = pathname === link.href;

              return (
                <Link
                  key={link.href}
                  href={link.href}
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
        {user && (
          <div className="p-4 border-t">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600 font-medium">{user.name}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              className="w-full flex items-center justify-start gap-2"
            >
              <LogOut size={16} />
              ออกจากระบบ
            </Button>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto bg-gray-50">
        {children}
      </div>
    </div>
  );
}
