'use client';

import React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Surface, SurfaceHeader } from '@/components/ui/surface';

/**
 * Console Page Shell — Shared wrapper for all console/CRUD pages.
 * Provides a consistent minimal header matching the AI chat aesthetic.
 *
 * Layout:
 *   ┌─ title ── subtitle ────────── action button ─┐
 *   │                                               │
 *   │  children (table, form, etc.)                 │
 *   │                                               │
 *   └───────────────────────────────────────────────┘
 *
 * @param title       - Page title (e.g. "Ingredients")
 * @param subtitle    - Optional muted text (e.g. "31,179 items")
 * @param action_label - Optional action button text (e.g. "Add")
 * @param on_action   - Optional action button callback
 * @param show_action - Whether to show the action button (default true)
 * @param children    - Page content
 */

interface ConsolePageShellProps {
  title: string;
  subtitle?: string;
  action_label?: string;
  on_action?: () => void;
  show_action?: boolean;
  children: React.ReactNode;
}

export function ConsolePageShell({
  title,
  subtitle,
  action_label,
  on_action,
  show_action = true,
  children,
}: ConsolePageShellProps) {
  return (
    <div className="h-full flex flex-col p-2 lg:p-3">
      <Surface variant="panel" className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Header toolbar */}
        <SurfaceHeader className="h-16 flex-shrink-0 px-5 py-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <h1 className="text-base font-semibold text-ink truncate">{title}</h1>
            {subtitle && (
              <span className="text-sm text-muted flex-shrink-0">{subtitle}</span>
            )}
          </div>
          {show_action && action_label && on_action && (
            <Button
              size="sm"
              onClick={on_action}
              className="h-9 px-4 text-xs"
            >
              <Plus className="h-3 w-3 mr-1" />
              {action_label}
            </Button>
          )}
        </SurfaceHeader>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-auto">
          {children}
        </div>
      </Surface>
    </div>
  );
}

/**
 * Console Section — Lightweight section divider within a page.
 * Replaces Card/CardHeader for sub-sections.
 *
 * @param title    - Section title
 * @param subtitle - Optional description
 * @param trailing - Optional trailing element (button, count, etc.)
 * @param children - Section content
 */

interface ConsoleSectionProps {
  title?: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function ConsoleSection({
  title,
  subtitle,
  trailing,
  children,
  className = '',
}: ConsoleSectionProps) {
  return (
    <div className={className}>
      {(title || trailing) && (
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
          {trailing}
        </div>
      )}
      {children}
    </div>
  );
}
