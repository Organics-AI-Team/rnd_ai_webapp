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
    <div className="flex items-center gap-2 h-11 px-3 border-b border-gray-100/80">
      {leading}
      <span className="text-[13px] font-medium text-gray-800 truncate">{title}</span>
      {badgeText && (
        <span className="text-[10px] text-gray-400 font-normal">
          {badgeText}
        </span>
      )}
    </div>
  );
}
