'use client';

import React from 'react';

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
    <div className="flex h-12 items-center gap-2 border-b border-emerald-100/80 bg-gradient-to-r from-emerald-50/80 via-white to-green-50/70 px-3">
      {leading}
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-emerald-950">{title}</span>
      {badgeText && (
        <span className="max-w-28 shrink-0 truncate rounded-full border border-emerald-200 bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 sm:max-w-none">
          {badgeText}
        </span>
      )}
    </div>
  );
}
