'use client';

import React from 'react';
import { PanelLeftClose, PanelLeft, X } from 'lucide-react';
import { cn } from '@rnd-ai/shared-utils';
import { Surface } from '@/components/ui/surface';

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
    <Surface variant="panel" className="relative flex h-full overflow-hidden">
      {/* Desktop sidebar — pushes content */}
      <div
        className={cn(
          'hidden lg:block transition-[width] duration-200 ease-out overflow-hidden flex-shrink-0',
          is_sidebar_open ? 'w-72 border-r border-border' : 'w-0',
        )}
      >
        {is_sidebar_open && sidebar}
      </div>

      {/* Mobile sidebar — overlay sheet */}
      {is_sidebar_open && (
        <>
          <div
            className="lg:hidden fixed inset-0 z-40 bg-overlay"
            onClick={on_toggle_sidebar}
          />
          <Surface variant="panel" className="lg:hidden fixed left-0 top-0 bottom-0 z-50 w-80 rounded-l-none overflow-hidden">
            <div className="flex h-16 items-center justify-end border-b border-border px-4">
              <button
                onClick={on_toggle_sidebar}
                className="rounded-full p-2 text-muted hover:bg-subtle hover:text-ink"
                aria-label="Close sidebar"
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>
            <div className="h-[calc(100%-4rem)] overflow-hidden">
              {sidebar}
            </div>
          </Surface>
        </>
      )}

      {/* Chat Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {children}
      </div>
    </Surface>
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
      className="rounded-full p-2 text-muted hover:bg-subtle hover:text-ink transition-colors"
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
