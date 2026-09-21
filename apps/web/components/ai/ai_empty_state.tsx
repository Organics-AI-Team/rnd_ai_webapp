'use client';

import React from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/surface';

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
    <div className="flex flex-col items-center justify-center px-5 py-16 sm:px-6 sm:py-24">
      {/* Gradient icon circle */}
      <div className="relative mb-5">
        <IconTile tone="brand" className="size-16 rounded-3xl">
          {icon}
        </IconTile>
        <div className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-brand text-white shadow-sm">
          <Sparkles className="h-2.5 w-2.5" />
        </div>
      </div>

      <p className="mb-7 max-w-sm text-center text-sm leading-relaxed text-muted">{greeting}</p>

      {/* Clickable suggestion chips */}
      <div className="flex flex-wrap justify-center gap-2 max-w-md">
        {suggestions.map((suggestion, index) => (
          <Button
            key={index}
            onClick={() => on_suggestion_click?.(suggestion)}
            variant="outline"
            size="sm"
            className="h-9 px-4 text-xs"
          >
            {suggestion}
          </Button>
        ))}
      </div>
    </div>
  );
}
