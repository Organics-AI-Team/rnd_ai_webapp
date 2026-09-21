'use client';

import React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
      <div className="flex-1 min-h-0 flex flex-col rounded-2xl border border-emerald-100/90 bg-white/80 shadow-[0_14px_36px_rgba(16,185,129,0.10)] backdrop-blur-sm overflow-hidden">
        {/* Header toolbar */}
        <div className="flex items-center justify-between h-12 px-4 border-b border-emerald-100/80 bg-gradient-to-r from-emerald-50/80 via-white to-green-50/70 flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <h1 className="text-[13px] font-semibold text-emerald-950 truncate">{title}</h1>
            {subtitle && (
              <span className="text-[11px] text-emerald-800/55 flex-shrink-0">{subtitle}</span>
            )}
          </div>
          {show_action && action_label && on_action && (
            <Button
              size="sm"
              onClick={on_action}
              className="h-7 text-[11px] px-2.5"
            >
              <Plus className="h-3 w-3 mr-1" />
              {action_label}
            </Button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-auto">
          {children}
        </div>
      </div>
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
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-emerald-50">
          <div>
            {title && <h2 className="text-[12px] font-medium text-emerald-900">{title}</h2>}
            {subtitle && <p className="text-[11px] text-emerald-800/55">{subtitle}</p>}
          </div>
          {trailing}
        </div>
      )}
      {children}
    </div>
  );
}
