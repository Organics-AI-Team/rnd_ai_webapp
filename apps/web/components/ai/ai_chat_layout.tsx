'use client';

import React from 'react';
import { PanelLeftClose, PanelLeft, X } from 'lucide-react';
import { cn } from '@rnd-ai/shared-utils';

/**
 * AI Chat Layout — Full-bleed responsive workspace with sidebar.
 *
 * Desktop (>=1024px): sidebar pushes chat area.
 * Mobile (<1024px): sidebar overlays as a sheet with backdrop.
 *
 * @param sidebar           - AIChatSidebar component
 * @param children          - Chat area content
 * @param is_sidebar_open   - Sidebar visibility state
 * @param on_toggle_sidebar - Toggle callback
 */

interface AIChatLayoutProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  is_sidebar_open: boolean;
  on_toggle_sidebar: () => void;
}

export function AIChatLayout({
  sidebar,
  children,
  is_sidebar_open,
  on_toggle_sidebar,
}: AIChatLayoutProps) {
  return (
    <div className="relative flex h-full min-h-0 overflow-hidden bg-white">
      {/* Desktop sidebar — pushes content */}
      <div
        className={cn(
          'hidden lg:block transition-[width] duration-200 ease-out overflow-hidden flex-shrink-0',
          is_sidebar_open ? 'w-60 border-r border-emerald-100/80' : 'w-0',
        )}
      >
        {is_sidebar_open && sidebar}
      </div>

      {/* Mobile sidebar — overlay sheet */}
      {is_sidebar_open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 border-0 bg-emerald-950/20 p-0 lg:hidden"
            onClick={on_toggle_sidebar}
            aria-label="Close chat history"
          />
          <div className="lg:hidden fixed left-0 top-0 bottom-0 z-50 w-64 bg-white/95 shadow-xl rounded-r-2xl overflow-hidden backdrop-blur-xl">
            <div className="h-11 flex items-center justify-end px-3 border-b border-emerald-100/80">
              <button
                type="button"
                onClick={on_toggle_sidebar}
                className="rounded-lg p-1 text-emerald-800/50 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                aria-label="Close sidebar"
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>
            <div className="h-[calc(100%-2.75rem)] overflow-hidden">
              {sidebar}
            </div>
          </div>
        </>
      )}

      {/* Chat Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle Button
// ---------------------------------------------------------------------------

interface SidebarToggleButtonProps {
  is_open: boolean;
  on_toggle: () => void;
}

/**
 * Minimal sidebar toggle button.
 *
 * @param is_open   - Sidebar state
 * @param on_toggle - Toggle callback
 */
export function SidebarToggleButton({ is_open, on_toggle }: SidebarToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={on_toggle}
      className="rounded-lg p-1 text-emerald-800/40 transition-colors hover:bg-emerald-50 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      title={is_open ? 'Hide history' : 'Show history'}
      aria-label={is_open ? 'Hide history' : 'Show history'}
    >
      {is_open ? (
        <PanelLeftClose size={15} strokeWidth={1.5} className="hidden lg:block" />
      ) : (
        <PanelLeft size={15} strokeWidth={1.5} />
      )}
      {is_open && <PanelLeftClose size={15} strokeWidth={1.5} className="lg:hidden" />}
    </button>
  );
}
