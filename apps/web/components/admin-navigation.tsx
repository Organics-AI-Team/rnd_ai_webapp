"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Database, Settings, ChevronLeft, ChevronRight, LogOut } from "lucide-react";
import { cn } from "@rnd-ai/shared-utils";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export function AdminNavigation({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, organization, logout } = useAuth();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Admin-specific navigation items
  const adminNavigationItems = [
    {
      type: "section-title",
      label: "การจัดการระบบ",
      labelEn: "System Management",
    },
    {
      type: "link",
      href: "/admin/vector-indexing",
      label: "จัดการ Vector",
      labelEn: "Vector Management",
      icon: Database,
    },
    {
      type: "link",
      href: "/admin/credits",
      label: "จัดการเครดิต",
      labelEn: "Credit Management",
      icon: Settings,
    },
    {
      type: "separator",
    },
    {
      type: "link",
      href: "/products",
      label: "เพิ่มสาร",
      labelEn: "Add Ingredients",
      icon: Database,
    },
    {
      type: "link",
      href: "/formulas/create",
      label: "เพิ่มสูตร",
      labelEn: "Add Formulas",
      icon: Settings,
    },
  ];

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  return (
    <div className="flex h-screen">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-red-600 border-b">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-2">
            <Settings size={24} className="text-white" />
            <h1 className="text-base font-bold text-white">
              Admin Panel
            </h1>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 hover:bg-red-700 rounded-lg transition-colors"
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? "✕" : "☰"}
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

      {/* Admin Sidebar */}
      <aside
        className={cn(
          "fixed lg:static inset-y-0 left-0 z-40 bg-red-50 border-r border-red-200 flex flex-col transition-all duration-300 lg:translate-x-0",
          isMobileMenuOpen ? "translate-x-0 w-64" : "-translate-x-full lg:translate-x-0",
          isSidebarCollapsed ? "lg:w-20" : "lg:w-64"
        )}
      >
        {/* Header - Desktop only */}
        <div className="hidden lg:block p-6 border-b border-red-200 bg-red-600">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 overflow-hidden">
              <Settings size={28} className="text-white flex-shrink-0" />
              {!isSidebarCollapsed && (
                <h1 className="text-lg font-bold text-white whitespace-nowrap">
                  Admin Panel
                </h1>
              )}
            </div>
            <button
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="p-1.5 hover:bg-red-700 rounded-lg transition-colors flex-shrink-0"
              aria-label="Toggle sidebar"
            >
              {isSidebarCollapsed ? <ChevronRight size={20} className="text-white" /> : <ChevronLeft size={20} className="text-white" />}
            </button>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 p-4 overflow-y-auto mt-16 lg:mt-0">
          <div className="space-y-1">
            {adminNavigationItems.map((item: any, index: number) => {
              // Section Title
              if (item.type === "section-title") {
                if (isSidebarCollapsed) return null;
                return (
                  <div key={`section-${index}`} className={`px-4 pb-2 ${index > 0 ? 'pt-4' : 'pt-0'}`}>
                    <h3 className="text-xs font-semibold text-red-600 uppercase tracking-wider">
                      {item.label}
                    </h3>
                  </div>
                );
              }

              // Separator
              if (item.type === "separator") {
                return (
                  <div key={`separator-${index}`} className="my-2">
                    <div className="border-t border-red-200" />
                  </div>
                );
              }

              // Direct link
              if (item.type === "link") {
                const Icon = item.icon;
                const isActive = pathname === item.href;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={closeMobileMenu}
                    title={isSidebarCollapsed ? item.label : undefined}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors",
                      isActive
                        ? "bg-red-600 text-white"
                        : "text-red-700 hover:bg-red-100",
                      isSidebarCollapsed && "justify-center"
                    )}
                  >
                    <Icon size={20} className="flex-shrink-0" />
                    {!isSidebarCollapsed && <span className="whitespace-nowrap">{item.label}</span>}
                  </Link>
                );
              }

              return null;
            })}
          </div>
        </nav>

        {/* User Section */}
        {user && organization && (
          <div className="p-4 border-t border-red-200 bg-red-100">
            {!isSidebarCollapsed ? (
              <>
                {/* User Info */}
                <div className="mb-3 p-3 bg-white rounded-lg border border-red-200">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-8 h-8 rounded-full bg-red-600 text-white flex items-center justify-center font-semibold">
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{user.name}</p>
                      <p className="text-xs text-gray-500 truncate">{user.email}</p>
                    </div>
                  </div>
                  <div className="mt-2">
                    <span className="inline-block px-2 py-1 text-xs font-medium rounded-full bg-red-600 text-white">
                      ผู้ดูแลระบบ
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
              </>
            ) : (
              <>
                {/* Collapsed User Avatar */}
                <div className="flex flex-col items-center gap-2">
                  <div className="w-10 h-10 rounded-full bg-red-600 text-white flex items-center justify-center font-semibold">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={logout}
                    title="ออกจากระบบ"
                    className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <LogOut size={16} />
                  </Button>
                </div>
              </>
            )}
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