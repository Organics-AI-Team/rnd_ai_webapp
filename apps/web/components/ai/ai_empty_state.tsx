'use client';

import React from 'react';
import { Sparkles } from 'lucide-react';

/**
 * AI Empty State — ChatGPT/Gemini-inspired centered welcome.
 * Features a gradient-backed icon and clickable suggestion chips.
 *
 * @param icon        - Center icon (rendered inside gradient circle)
 * @param greeting    - Subtitle text
 * @param suggestions - Clickable suggestion chips
 * @param on_suggestion_click - Optional callback when a chip is clicked
 */

interface AIEmptyStateProps {
  icon: React.ReactNode;
  greeting: string;
  description?: string;
  suggestions: string[];
  on_suggestion_click?: (suggestion: string) => void;
}

export function AIEmptyState({
  icon,
  greeting,
  suggestions,
  on_suggestion_click,
}: AIEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 sm:py-20 px-4 sm:px-6">
      {/* Gradient icon circle */}
      <div className="relative mb-5">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-gray-100 to-gray-50 border border-gray-100/80 flex items-center justify-center shadow-sm">
          <div className="text-gray-300">
            {icon}
          </div>
        </div>
        <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-sm">
          <Sparkles className="w-2.5 h-2.5 text-white" />
        </div>
      </div>

      <p className="text-[13px] text-gray-400 mb-6 text-center max-w-sm leading-relaxed">{greeting}</p>

      {/* Clickable suggestion chips */}
      <div className="flex flex-wrap justify-center gap-2 max-w-md">
        {suggestions.map((suggestion, index) => (
          <button
            key={index}
            onClick={() => on_suggestion_click?.(suggestion)}
            className="text-[11px] sm:text-[12px] text-gray-500 bg-white border border-gray-200/80 rounded-lg px-2.5 sm:px-3 py-1.5 hover:border-gray-300 hover:text-gray-700 hover:shadow-sm transition-all cursor-pointer"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
