'use client';

import React from 'react';
import { PanelLeftClose, PanelLeft, X } from 'lucide-react';
import { cn } from '@rnd-ai/shared-utils';

/**
 * AI Chat Layout — Responsive container with sidebar.
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
    <div className="relative flex h-full overflow-hidden rounded-xl border border-gray-200/60 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      {/* Desktop sidebar — pushes content */}
      <div
        className={cn(
          'hidden lg:block transition-[width] duration-200 ease-out overflow-hidden flex-shrink-0',
          is_sidebar_open ? 'w-60 border-r border-gray-100/80' : 'w-0',
        )}
      >
        {is_sidebar_open && sidebar}
      </div>

      {/* Mobile sidebar — overlay sheet */}
      {is_sidebar_open && (
        <>
          <div
            className="lg:hidden fixed inset-0 bg-black/20 z-40"
            onClick={on_toggle_sidebar}
          />
          <div className="lg:hidden fixed left-0 top-0 bottom-0 z-50 w-64 bg-white shadow-xl rounded-r-xl overflow-hidden">
            <div className="h-11 flex items-center justify-end px-3 border-b border-gray-100/80">
              <button
                onClick={on_toggle_sidebar}
                className="p-1 rounded-md hover:bg-gray-100 text-gray-400"
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
      onClick={on_toggle}
      className="p-1 rounded-md hover:bg-gray-100/80 text-gray-300 hover:text-gray-500 transition-colors"
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
