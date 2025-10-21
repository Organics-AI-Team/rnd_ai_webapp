"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Package, ClipboardList, Truck, LogOut, Settings, Menu, X, ChevronLeft, ChevronRight, BoxIcon, Beaker, ChevronDown, Star, Eye, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export function Navigation({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, organization, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [openDropdowns, setOpenDropdowns] = useState<string[]>([]);

  const navigationItems = [
    // Admin section
    {
      type: "section-title",
      label: "ADDING",
      adminOnly: true,
    },
    {
      type: "link",
      href: "/admin/products",
      label: "เพิ่มสาร",
      labelEn: "Add Ingredient",
      icon: Plus,
      adminOnly: true,
    },
    {
      type: "link",
      href: "/admin/formulas",
      label: "เพิ่มสูตร",
      labelEn: "Add Formula",
      icon: Plus,
      adminOnly: true,
    },
    // Separator
    {
      type: "separator",
    },
    // Dashboard section
    {
      type: "section-title",
      label: "CONSOLE",
    },
    {
      type: "link",
      href: "/ingredients",
      label: "สาร",
      labelEn: "Ingredients",
      icon: BoxIcon,
    },
    {
      type: "link",
      href: "/formulas",
      label: "สูตร",
      labelEn: "Formulas",
      icon: Beaker,
    },
    // Separator
    {
      type: "separator",
      adminOnly: true,
    },
    // Settings section
    {
      type: "section-title",
      label: "SETTINGS",
      adminOnly: true,
    },
    {
      type: "link",
      href: "/admin/credits",
      label: "จัดการเครดิต",
      labelEn: "Manage Credits",
      icon: Settings,
      adminOnly: true,
    },
  ];

  const toggleDropdown = (id: string) => {
    setOpenDropdowns(prev =>
      prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]
    );
  };

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  return (
    <div className="flex h-screen">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-2">
            <Package size={24} className="text-line" />
            <h1 className="text-base font-bold text-gray-900">
              R&D AI
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
          "fixed lg:static inset-y-0 left-0 z-40 bg-white border-r flex flex-col transition-all duration-300 lg:translate-x-0",
          isMobileMenuOpen ? "translate-x-0 w-64" : "-translate-x-full lg:translate-x-0",
          isSidebarCollapsed ? "lg:w-20" : "lg:w-64"
        )}
      >
        {/* Header - Desktop only */}
        <div className="hidden lg:block p-6 border-b">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 overflow-hidden">
              <Package size={28} className="text-line flex-shrink-0" />
              {!isSidebarCollapsed && (
                <h1 className="text-lg font-bold text-gray-900 whitespace-nowrap">
                  R&D AI
                </h1>
              )}
            </div>
            <button
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
              aria-label="Toggle sidebar"
            >
              {isSidebarCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
            </button>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 p-4 overflow-y-auto mt-16 lg:mt-0">
          <div className="space-y-1">
            {navigationItems.map((item: any, index: number) => {
              // Skip admin-only items if user is not admin
              if (item.adminOnly && user?.role !== "admin") {
                return null;
              }

              // Section Title
              if (item.type === "section-title") {
                if (isSidebarCollapsed) return null; // Hide section titles when collapsed
                return (
                  <div key={`section-${index}`} className={`px-4 pb-2 ${index > 0 ? 'pt-4' : 'pt-0'}`}>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      {item.label}
                    </h3>
                  </div>
                );
              }

              // Separator
              if (item.type === "separator") {
                return (
                  <div key={`separator-${index}`} className="my-2">
                    <div className="border-t border-gray-200" />
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
                        ? "bg-line text-white"
                        : "text-gray-600 hover:bg-gray-100",
                      isSidebarCollapsed && "justify-center"
                    )}
                  >
                    <Icon size={20} className="flex-shrink-0" />
                    {!isSidebarCollapsed && <span className="whitespace-nowrap">{item.label}</span>}
                  </Link>
                );
              }

              // Dropdown
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
                        "w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors",
                        hasActiveChild
                          ? "bg-line/10 text-line"
                          : "text-gray-600 hover:bg-gray-100",
                        isSidebarCollapsed && "justify-center"
                      )}
                    >
                      <Icon size={20} className="flex-shrink-0" />
                      {!isSidebarCollapsed && (
                        <>
                          <span className="whitespace-nowrap flex-1 text-left">{item.label}</span>
                          <ChevronDown
                            size={16}
                            className={cn(
                              "transition-transform flex-shrink-0",
                              isOpen && "rotate-180"
                            )}
                          />
                        </>
                      )}
                    </button>

                    {/* Dropdown Children */}
                    {isOpen && !isSidebarCollapsed && (
                      <div className="mt-1 ml-4 space-y-1">
                        {item.children?.map((child: any) => {
                          const ChildIcon = child.icon;
                          const isActive = pathname === child.href;

                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              onClick={closeMobileMenu}
                              className={cn(
                                "flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                                isActive
                                  ? "bg-line text-white"
                                  : "text-gray-600 hover:bg-gray-100"
                              )}
                            >
                              <ChildIcon size={18} className="flex-shrink-0" />
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

        {/* User Section */}
        {user && organization && (
          <div className="p-4 border-t bg-gray-50">
            {!isSidebarCollapsed ? (
              <>
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
                    <span className={cn(
                      "inline-block px-2 py-1 text-xs font-medium rounded-full",
                      user.role === "admin" ? "bg-blue-100 text-blue-800" :
                      user.role === "shipper" ? "bg-green-100 text-green-800" :
                      "bg-purple-100 text-purple-800"
                    )}>
                      {user.role === "admin" ? "ผู้ดูแลระบบ" :
                       user.role === "shipper" ? "พนักงานจัดส่ง" :
                       "พนักงานจัดซื้อ"}
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
                  <div className="w-10 h-10 rounded-full bg-line text-white flex items-center justify-center font-semibold">
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
