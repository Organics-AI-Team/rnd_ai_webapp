'use client';

import React from 'react';
import { SurfaceHeader } from '@/components/ui/surface';

/**
 * AI Chat Header — Ultra-minimal toolbar. Cloudflare/ChatGPT-inspired.
 * Just the sidebar toggle, a model/thread name, and optional subtle label.
 *
 * @param title    - Thread title or agent name
 * @param subtitle - Optional subtle secondary text (e.g. "RAG", "Market")
 * @param leading  - Optional leading element (sidebar toggle)
 */

interface AIChatHeaderProps {
  icon?: React.ReactNode;
  title: string;
  iconColor?: string;
  badgeText?: string;
  badgeColor?: string;
  leading?: React.ReactNode;
}

export function AIChatHeader({
  title,
  badgeText,
  leading,
}: AIChatHeaderProps) {
  return (
    <SurfaceHeader className="h-16 justify-start gap-3 px-5 py-0">
      {leading}
      <span className="truncate text-base font-semibold text-ink">{title}</span>
      {badgeText && (
        <span className="rounded-full border border-border bg-subtle px-2.5 py-1 text-xs font-medium text-muted">
          {badgeText}
        </span>
      )}
    </SurfaceHeader>
  );
}
