"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Package, LogOut, Menu, X, ChevronLeft, ChevronRight, BoxIcon, Beaker, ChevronDown, Plus, Database, Sparkles, Calculator } from "lucide-react";
import { cn } from "@rnd-ai/shared-utils";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { useState } from "react";

/**
 * Main sidebar navigation - light mode, clean Cloudflare-style
 *
 * @param children - Page content rendered alongside the sidebar
 */
export function Navigation({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, organization, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [openDropdowns, setOpenDropdowns] = useState<string[]>([]);

  const navigationItems = [
    { type: "section-title", label: "MANAGE", adminOnly: true },
    { type: "link", href: "/products", label: "Add Ingredient", icon: Plus, adminOnly: true },
    { type: "link", href: "/stock", label: "Add Stock", icon: Package, adminOnly: true },
    { type: "link", href: "/formulas/create", label: "Add Formula", icon: Plus, adminOnly: true },
    { type: "separator" },
    { type: "section-title", label: "CONSOLE" },
    { type: "link", href: "/ingredients", label: "Ingredients", icon: BoxIcon },
    { type: "link", href: "/formulas", label: "Formulas", icon: Beaker },
    { type: "link", href: "/calculation", label: "Price Calculator", icon: Calculator },
    { type: "separator" },
    { type: "section-title", label: "AI ASSISTANT" },
    { type: "link", href: "/ai/raw-materials-ai", label: "Stock Materials AI", icon: Database },
    { type: "link", href: "/ai/sales-rnd-ai", label: "Sales Formulation AI", icon: Sparkles },
  ];

  /**
   * Toggles dropdown menu open/closed state
   *
   * @param id - Dropdown identifier to toggle
   */
  const toggleDropdown = (id: string) => {
    setOpenDropdowns(prev =>
      prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]
    );
  };

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  return (
    <div className="flex h-screen">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Package size={16} className="text-gray-900" />
            <h1 className="text-sm font-semibold text-gray-900">R&D AI</h1>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-1.5 hover:bg-gray-100 rounded transition-colors text-gray-600"
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {/* Overlay */}
      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/40 z-40" onClick={closeMobileMenu} />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed lg:static inset-y-0 left-0 z-40 bg-white border-r border-gray-200 flex flex-col transition-all duration-200 lg:translate-x-0",
          isMobileMenuOpen ? "translate-x-0 w-52" : "-translate-x-full lg:translate-x-0",
          isSidebarCollapsed ? "lg:w-14" : "lg:w-52"
        )}
      >
        {/* Header */}
        <div className={cn(
          "hidden lg:flex items-center border-b border-gray-200",
          isSidebarCollapsed ? "px-2 py-3 justify-center" : "px-3 py-3 justify-between"
        )}>
          <div className={cn("flex items-center gap-2 overflow-hidden", isSidebarCollapsed && "justify-center")}>
            <Package size={16} className="text-gray-900 flex-shrink-0" />
            {!isSidebarCollapsed && (
              <span className="text-sm font-semibold text-gray-900 whitespace-nowrap">R&D AI</span>
            )}
          </div>
          <button
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            className="p-1 hover:bg-gray-100 rounded transition-colors flex-shrink-0 text-gray-400 hover:text-gray-600"
            aria-label="Toggle sidebar"
          >
            {isSidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>

        {/* Nav Links */}
        <nav className={cn("flex-1 overflow-y-auto mt-12 lg:mt-0", isSidebarCollapsed ? "px-1 py-2" : "px-2 py-2")}>
          <div className="space-y-0.5">
            {navigationItems.map((item: any, index: number) => {
              if (item.adminOnly && user?.role !== "admin") return null;

              if (item.type === "section-title") {
                if (isSidebarCollapsed) return null;
                return (
                  <div key={`section-${index}`} className={`px-2 pb-1 ${index > 0 ? 'pt-3' : 'pt-1'}`}>
                    <h3 className="text-2xs font-medium text-gray-400 uppercase tracking-widest">{item.label}</h3>
                  </div>
                );
              }

              if (item.type === "separator") {
                if (isSidebarCollapsed) return null;
                return (
                  <div key={`separator-${index}`} className="my-1.5 mx-2">
                    <div className="border-t border-gray-100" />
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
                      "flex items-center gap-2 rounded-md text-xs font-medium transition-colors",
                      isSidebarCollapsed ? "px-2 py-2 justify-center" : "px-2 py-1.5",
                      isActive
                        ? "bg-gray-100 text-gray-900"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                    )}
                  >
                    <Icon size={15} className="flex-shrink-0" />
                    {!isSidebarCollapsed && <span className="whitespace-nowrap">{item.label}</span>}
                  </Link>
                );
              }

              if (item.type === "dropdown") {
                const Icon = item.icon;
                const isOpen = openDropdowns.includes(item.id);
                const hasActiveChild = item.children?.some((child: any) => pathname === child.href);
                return (
                  <div key={item.id}>
                    <button
                      onClick={() => toggleDropdown(item.id)}
                      title={isSidebarCollapsed ? item.label : undefined}
                      className={cn(
                        "w-full flex items-center gap-2 rounded-md text-xs font-medium transition-colors",
                        isSidebarCollapsed ? "px-2 py-2 justify-center" : "px-2 py-1.5",
                        hasActiveChild ? "bg-gray-100 text-gray-900" : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                      )}
                    >
                      <Icon size={15} className="flex-shrink-0" />
                      {!isSidebarCollapsed && (
                        <>
                          <span className="whitespace-nowrap flex-1 text-left">{item.label}</span>
                          <ChevronDown size={12} className={cn("transition-transform opacity-50", isOpen && "rotate-180")} />
                        </>
                      )}
                    </button>
                    {isOpen && !isSidebarCollapsed && (
                      <div className="mt-0.5 ml-3 space-y-0.5">
                        {item.children?.map((child: any) => {
                          const ChildIcon = child.icon;
                          const isActive = pathname === child.href;
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              onClick={closeMobileMenu}
                              className={cn(
                                "flex items-center gap-2 px-2 py-1.5 rounded-md text-2xs font-medium transition-colors",
                                isActive ? "bg-gray-100 text-gray-900" : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
                              )}
                            >
                              <ChildIcon size={13} className="flex-shrink-0" />
                              <span className="whitespace-nowrap">{child.label}</span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              return null;
            })}
          </div>
        </nav>

        {/* User */}
        {user && organization && (
          <div className="px-2 py-3 border-t border-gray-200">
            {!isSidebarCollapsed ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-2">
                  <div className="w-6 h-6 rounded-full bg-gray-200 text-gray-700 flex items-center justify-center text-2xs font-medium">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-900 truncate">{user.name}</p>
                    <p className="text-2xs text-gray-400 truncate">{user.email}</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={logout}
                  className="w-full flex items-center justify-center gap-1.5 text-2xs text-gray-400 hover:text-red-600 hover:bg-red-50 h-6"
                >
                  <LogOut size={12} />
                  Sign out
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5">
                <div className="w-6 h-6 rounded-full bg-gray-200 text-gray-700 flex items-center justify-center text-2xs font-medium">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={logout}
                  title="Sign out"
                  className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 h-auto"
                >
                  <LogOut size={12} />
                </Button>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Main Content */}
      <div className="flex-1 overflow-auto bg-[#f8f9fa] pt-12 lg:pt-0">
        {children}
      </div>
    </div>
  );
}
