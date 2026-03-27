"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Database, Settings, ChevronLeft, ChevronRight, LogOut, Menu, X, Package } from "lucide-react";
import { cn } from "@rnd-ai/shared-utils";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { useState } from "react";

/**
 * Admin sidebar navigation component - Cloudflare dashboard style (dark variant)
 *
 * @param children - Page content to render alongside sidebar
 */
export function AdminNavigation({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, organization, logout } = useAuth();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const adminNavigationItems = [
    {
      type: "section-title",
      label: "SYSTEM",
    },
    {
      type: "link",
      href: "/admin/vector-indexing",
      label: "Vector Management",
      icon: Database,
    },
    {
      type: "link",
      href: "/admin/credits",
      label: "Credit Management",
      icon: Settings,
    },
    {
      type: "separator",
    },
    {
      type: "section-title",
      label: "DATA",
    },
    {
      type: "link",
      href: "/products",
      label: "Add Ingredients",
      icon: Package,
    },
    {
      type: "link",
      href: "/formulas/create",
      label: "Add Formulas",
      icon: Settings,
    },
  ];

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  return (
    <div className="flex h-screen">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-sidebar-bg border-b border-sidebar-border">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-red-500 flex items-center justify-center">
              <Settings size={14} className="text-white" />
            </div>
            <h1 className="text-sm font-semibold text-white">
              Admin
            </h1>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-1.5 hover:bg-sidebar-muted rounded transition-colors text-sidebar-fg"
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {/* Overlay for mobile menu */}
      {isMobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 z-40"
          onClick={closeMobileMenu}
        />
      )}

      {/* Admin Sidebar */}
      <aside
        className={cn(
          "fixed lg:static inset-y-0 left-0 z-40 bg-sidebar-bg flex flex-col transition-all duration-200 lg:translate-x-0",
          isMobileMenuOpen ? "translate-x-0 w-52" : "-translate-x-full lg:translate-x-0",
          isSidebarCollapsed ? "lg:w-16" : "lg:w-52"
        )}
      >
        {/* Header - Desktop only */}
        <div className={cn(
          "hidden lg:flex items-center border-b border-sidebar-border",
          isSidebarCollapsed ? "px-3 py-3 justify-center" : "px-4 py-3 justify-between"
        )}>
          <div className={cn(
            "flex items-center gap-2.5 overflow-hidden",
            isSidebarCollapsed && "justify-center"
          )}>
            <div className="w-6 h-6 rounded bg-red-500 flex items-center justify-center flex-shrink-0">
              <Settings size={14} className="text-white" />
            </div>
            {!isSidebarCollapsed && (
              <span className="text-sm font-semibold text-white whitespace-nowrap">
                Admin Panel
              </span>
            )}
          </div>
          {!isSidebarCollapsed && (
            <button
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="p-1 hover:bg-sidebar-muted rounded transition-colors flex-shrink-0 text-sidebar-fg/60 hover:text-sidebar-fg"
              aria-label="Toggle sidebar"
            >
              <ChevronLeft size={14} />
            </button>
          )}
          {isSidebarCollapsed && (
            <button
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="p-1 hover:bg-sidebar-muted rounded transition-colors flex-shrink-0 text-sidebar-fg/60 hover:text-sidebar-fg"
              aria-label="Toggle sidebar"
            >
              <ChevronRight size={14} />
            </button>
          )}
        </div>

        {/* Navigation Links */}
        <nav className={cn(
          "flex-1 overflow-y-auto mt-14 lg:mt-0 px-2 py-2"
        )}>
          <div className="space-y-0.5">
            {adminNavigationItems.map((item: any, index: number) => {
              if (item.type === "section-title") {
                if (isSidebarCollapsed) return null;
                return (
                  <div key={`section-${index}`} className={`px-2 pb-1 ${index > 0 ? 'pt-3' : 'pt-1'}`}>
                    <h3 className="text-2xs font-medium text-sidebar-fg/40 uppercase tracking-widest">
                      {item.label}
                    </h3>
                  </div>
                );
              }

              if (item.type === "separator") {
                if (isSidebarCollapsed) return null;
                return (
                  <div key={`separator-${index}`} className="my-1.5 mx-2">
                    <div className="border-t border-sidebar-border" />
                  </div>
                );
              }

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
                      "flex items-center gap-2.5 rounded-md text-xs font-medium transition-colors",
                      isSidebarCollapsed ? "px-2 py-2 justify-center" : "px-2.5 py-1.5",
                      isActive
                        ? "bg-sidebar-muted text-white"
                        : "text-sidebar-fg/70 hover:text-sidebar-fg hover:bg-sidebar-muted/50"
                    )}
                  >
                    <Icon size={15} className="flex-shrink-0" />
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
          <div className="px-2 py-3 border-t border-sidebar-border">
            {!isSidebarCollapsed ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-2">
                  <div className="w-6 h-6 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center text-2xs font-medium">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-sidebar-fg truncate">{user.name}</p>
                    <p className="text-2xs text-sidebar-fg/50 truncate">{user.email}</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={logout}
                  className="w-full flex items-center justify-center gap-1.5 text-2xs text-sidebar-fg/50 hover:text-red-400 hover:bg-sidebar-muted h-6"
                >
                  <LogOut size={12} />
                  Sign out
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5">
                <div className="w-7 h-7 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center text-2xs font-medium">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={logout}
                  title="Sign out"
                  className="p-1 text-sidebar-fg/50 hover:text-red-400 hover:bg-sidebar-muted h-auto"
                >
                  <LogOut size={12} />
                </Button>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto bg-muted pt-14 lg:pt-0">
        {children}
      </div>
    </div>
  );
}
