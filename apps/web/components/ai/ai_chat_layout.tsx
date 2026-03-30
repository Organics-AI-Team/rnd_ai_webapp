/**
 * AI Chat Layout
 *
 * Wraps the sidebar (history panel) + chat area with toggle logic.
 * Provides a responsive layout where the sidebar can be shown/hidden.
 *
 * Default behavior:
 *   - Desktop: sidebar open
 *   - Mobile: sidebar collapsed
 *
 * @param sidebar     - The AIChatSidebar component
 * @param children    - The chat area content
 * @param is_sidebar_open - Whether the sidebar is currently visible
 * @param on_toggle_sidebar - Callback to toggle sidebar visibility
 */

'use client';

import React from 'react';
import { PanelLeftClose, PanelLeft } from 'lucide-react';
import { cn } from '@rnd-ai/shared-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AIChatLayoutProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  is_sidebar_open: boolean;
  on_toggle_sidebar: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Layout component that manages sidebar + chat area arrangement.
 *
 * @param sidebar           - Sidebar React node (AIChatSidebar)
 * @param children          - Chat area content
 * @param is_sidebar_open   - Sidebar visibility state
 * @param on_toggle_sidebar - Toggle callback
 */
export function AIChatLayout({
  sidebar,
  children,
  is_sidebar_open,
  on_toggle_sidebar,
}: AIChatLayoutProps) {
  console.log('[AIChatLayout] render', { is_sidebar_open });

  return (
    <div className="flex h-full overflow-hidden rounded-lg border border-gray-200 bg-white">
      {/* Sidebar */}
      <div
        className={cn(
          'transition-all duration-200 overflow-hidden flex-shrink-0',
          is_sidebar_open ? 'w-60' : 'w-0',
        )}
      >
        {is_sidebar_open && sidebar}
      </div>

      {/* Chat Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle Button (used inside chat header)
// ---------------------------------------------------------------------------

interface SidebarToggleButtonProps {
  is_open: boolean;
  on_toggle: () => void;
}

/**
 * Small toggle button for showing/hiding the sidebar.
 * Placed inside the chat header area.
 *
 * @param is_open   - Current sidebar state
 * @param on_toggle - Toggle callback
 */
export function SidebarToggleButton({ is_open, on_toggle }: SidebarToggleButtonProps) {
  return (
    <button
      onClick={on_toggle}
      className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
      title={is_open ? 'Hide history' : 'Show history'}
      aria-label={is_open ? 'Hide history' : 'Show history'}
    >
      {is_open ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
    </button>
  );
}
