"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Package, LogOut, Menu, X, ChevronLeft, ChevronRight, BoxIcon, Beaker, ChevronDown, Plus, Database, Sparkles, MessageSquare, Users, Shield } from "lucide-react";
import { cn } from "@rnd-ai/shared-utils";
import { useAuth } from "@/lib/app-auth";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/surface";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { OrgSwitcherPanel } from "@/components/org_switcher_panel";

// Clerk components render only when the deployment configures Clerk — the
// sidebar also renders in the legacy flow, where Clerk components throw
// without ClerkProvider (same build-time check as app-auth.tsx).
const clerk_enabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

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
  const [threadTimeReference] = useState(() => new Date().getTime());

  // --- Fetch recent chat threads for sidebar history ---
  const raw_materials_threads = trpc.chatThreads.list.useQuery(
    { agentType: 'raw_materials_ai', limit: 5 },
    { refetchOnWindowFocus: false, enabled: !!user },
  );
  const sales_rnd_threads = trpc.chatThreads.list.useQuery(
    { agentType: 'sales_rnd_ai', limit: 5 },
    { refetchOnWindowFocus: false, enabled: !!user },
  );

  // Display-only role view for link visibility; the server still authorizes
  // every procedure behind these pages (auth.me is never an authz source).
  const me = trpc.auth.me.useQuery(undefined, {
    enabled: !!user,
    refetchOnWindowFocus: false,
  });
  const is_tenant_manager = me.data?.tenant_role === "manager";
  const has_platform_role = Boolean(me.data?.platform_role);

  /**
   * Map agent type to its recent threads.
   *
   * @param href - The AI page href to match
   * @returns Thread array or empty array
   */
  const get_threads_for_href = (href: string) => {
    if (href === '/ai/raw-materials-ai') return raw_materials_threads.data || [];
    if (href === '/ai/sales-rnd-ai') return sales_rnd_threads.data || [];
    return [];
  };

  /**
   * Format relative time against the stable sidebar-mount reference.
   *
   * @param date - Date to format
   * @returns Short time string (for example, "now", "5m", "2h", or "Mar 30")
   */
  const format_thread_time = (date: Date): string => {
    const ms = threadTimeReference - new Date(date).getTime();
    const min = Math.floor(ms / 60000);
    const hr = Math.floor(ms / 3600000);
    const day = Math.floor(ms / 86400000);
    if (min < 1) return 'now';
    if (min < 60) return `${min}m`;
    if (hr < 24) return `${hr}h`;
    if (day < 7) return `${day}d`;
    return new Date(date).toLocaleDateString('en', { month: 'short', day: 'numeric' });
  };

  const navigationItems = [
    { type: "section-title", label: "MANAGE", adminOnly: true },
    { type: "link", href: "/products", label: "Add Ingredient", icon: Plus, adminOnly: true },
    // { type: "link", href: "/stock", label: "Add Stock", icon: Package, adminOnly: true },
    { type: "link", href: "/formulas/create", label: "Add Formula", icon: Plus, adminOnly: true },
    { type: "separator" },
    { type: "section-title", label: "CONSOLE" },
    { type: "link", href: "/ingredients", label: "Ingredients", icon: BoxIcon },
    { type: "link", href: "/formulas", label: "Formulas", icon: Beaker },
    { type: "separator" },
    { type: "section-title", label: "AI ASSISTANT" },
    { type: "link", href: "/ai/raw-materials-ai", label: "Stock Materials AI", icon: Database },
    { type: "link", href: "/ai/sales-rnd-ai", label: "Sales Formulation AI", icon: Sparkles },
    ...(is_tenant_manager || has_platform_role
      ? [{ type: "separator" }, { type: "section-title", label: "ADMINISTRATION" }]
      : []),
    ...(is_tenant_manager
      ? [{ type: "link", href: "/settings/members", label: "Members", icon: Users }]
      : []),
    ...(has_platform_role
      ? [{ type: "link", href: "/platform/tenants", label: "Platform", icon: Shield }]
      : []),
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
      <div className="fixed left-0 right-0 top-0 z-50 border-b border-border bg-surface lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <IconTile tone="brand" className="size-8 rounded-xl"><Package size={14} /></IconTile>
            <h1 className="text-sm font-semibold text-ink">R&D AI</h1>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="rounded-full p-2 text-muted transition-colors hover:bg-subtle hover:text-ink"
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
          "fixed lg:static inset-y-0 left-0 z-40 flex flex-col border-r border-border bg-surface transition-all duration-200 lg:translate-x-0",
          isMobileMenuOpen ? "translate-x-0 w-52" : "-translate-x-full lg:translate-x-0",
          isSidebarCollapsed ? "lg:w-14" : "lg:w-52"
        )}
      >
        {/* Header */}
        <div className={cn(
          "hidden items-center border-b border-border lg:flex",
          isSidebarCollapsed ? "justify-center px-2 py-4" : "justify-between px-4 py-4"
        )}>
          <div className={cn("flex items-center gap-2 overflow-hidden", isSidebarCollapsed && "justify-center")}>
            <IconTile tone="brand" className="size-8 rounded-xl"><Package size={14} className="shrink-0" /></IconTile>
            {!isSidebarCollapsed && (
              <span className="whitespace-nowrap text-sm font-semibold text-ink">R&D AI</span>
            )}
          </div>
          <button
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            className="shrink-0 rounded-full p-1.5 text-muted transition-colors hover:bg-subtle hover:text-ink"
            aria-label="Toggle sidebar"
          >
            {isSidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>

        {/* Nav Links */}
        <nav className={cn("flex-1 overflow-y-auto mt-12 lg:mt-0", isSidebarCollapsed ? "px-1 py-2" : "px-2 py-2")}>
          <div className="space-y-1">
            {navigationItems.map((item: any, index: number) => {
              if (item.adminOnly && user?.role !== "admin") return null;

              if (item.type === "section-title") {
                if (isSidebarCollapsed) return null;
                return (
                  <div key={`section-${index}`} className={`px-2 pb-1 ${index > 0 ? 'pt-3' : 'pt-1'}`}>
                    <h3 className="text-2xs font-semibold uppercase tracking-[0.1em] text-muted">{item.label}</h3>
                  </div>
                );
              }

              if (item.type === "separator") {
                if (isSidebarCollapsed) return null;
                return (
                  <div key={`separator-${index}`} className="my-1.5 mx-2">
                    <div className="border-t border-border" />
                  </div>
                );
              }

              if (item.type === "link") {
                const Icon = item.icon;
                const isActive = pathname === item.href || pathname?.startsWith(item.href + '?');
                const is_ai_link = item.href?.startsWith('/ai/');
                const threads = is_ai_link ? get_threads_for_href(item.href) : [];
                const is_thread_section_open = openDropdowns.includes(`threads-${item.href}`);

                return (
                  <div key={item.href}>
                    <div className="flex items-center">
                      <Link
                        href={item.href}
                        onClick={closeMobileMenu}
                        title={isSidebarCollapsed ? item.label : undefined}
                        className={cn(
                          "flex flex-1 items-center gap-2 rounded-xl text-sm font-medium transition-colors",
                          isSidebarCollapsed ? "justify-center px-2 py-2" : "px-3 py-2.5",
                          isActive
                            ? "bg-brand-soft text-ink"
                            : "text-muted hover:bg-subtle hover:text-ink"
                        )}
                      >
                        <Icon size={15} className="flex-shrink-0" />
                        {!isSidebarCollapsed && <span className="whitespace-nowrap">{item.label}</span>}
                      </Link>
                      {/* Toggle thread history for AI links */}
                      {is_ai_link && !isSidebarCollapsed && threads.length > 0 && (
                        <button
                          onClick={() => toggleDropdown(`threads-${item.href}`)}
                          className="rounded-full p-1.5 text-muted transition-colors hover:bg-subtle hover:text-ink"
                          aria-label="Toggle chat history"
                        >
                          <ChevronDown size={11} className={cn("transition-transform", is_thread_section_open && "rotate-180")} />
                        </button>
                      )}
                    </div>
                    {/* Thread history sub-items */}
                    {is_ai_link && !isSidebarCollapsed && is_thread_section_open && threads.length > 0 && (
                      <div className="mt-0.5 ml-3 space-y-px">
                        {threads.map((thread: any) => (
                          <Link
                            key={thread.id}
                            href={`${item.href}?thread=${thread.id}`}
                            onClick={closeMobileMenu}
                            title={thread.title}
                            className="group flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs text-muted transition-colors hover:bg-subtle hover:text-ink"
                          >
                            <MessageSquare size={11} className="flex-shrink-0 opacity-40 group-hover:opacity-70" />
                            <span className="flex-1 min-w-0 truncate">{thread.title}</span>
                            <span className="shrink-0 text-2xs tabular-nums text-muted">
                              {format_thread_time(thread.lastMessageAt)}
                            </span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
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
                        "flex w-full items-center gap-2 rounded-xl text-sm font-medium transition-colors",
                        isSidebarCollapsed ? "justify-center px-2 py-2" : "px-3 py-2.5",
                        hasActiveChild ? "bg-brand-soft text-ink" : "text-muted hover:bg-subtle hover:text-ink"
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
                                "flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-colors",
                                isActive ? "bg-brand-soft text-ink" : "text-muted hover:bg-subtle hover:text-ink"
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

        {/* Org switcher: Clerk mode only — the sidebar also renders in the
            legacy flow where Clerk components would throw. Collapsed sidebar
            hides it (the popover needs horizontal room). */}
        {clerk_enabled && !isSidebarCollapsed && (
          <div className="border-t border-border px-3 py-3">
            <OrgSwitcherPanel />
          </div>
        )}

        {/* User */}
        {user && organization && (
          <div className="border-t border-border px-3 py-4">
            {!isSidebarCollapsed ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-2">
                  <div className="flex size-8 items-center justify-center rounded-full bg-brand-soft text-2xs font-semibold text-brand">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
                    <p className="truncate text-xs text-muted">{user.email}</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={logout}
                  className="h-8 w-full text-xs hover:text-red-700 hover:bg-red-50"
                >
                  <LogOut size={12} />
                  Sign out
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5">
                <div className="flex size-8 items-center justify-center rounded-full bg-brand-soft text-2xs font-semibold text-brand">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={logout}
                  title="Sign out"
                  className="h-auto p-1 text-muted hover:text-red-700 hover:bg-red-50"
                >
                  <LogOut size={12} />
                </Button>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Main Content */}
      <div className="flex-1 overflow-auto bg-transparent pt-12 lg:pt-0">
        {children}
      </div>
    </div>
  );
}
