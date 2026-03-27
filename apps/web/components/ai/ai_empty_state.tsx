'use client';

import React from 'react';

/**
 * AI Empty State Component - Clean, minimal welcome screen
 *
 * @param icon - Icon element at center
 * @param greeting - Welcome greeting text
 * @param description - Optional description text
 * @param suggestions - Array of capability hints
 */

interface AIEmptyStateProps {
  icon: React.ReactNode;
  greeting: string;
  description?: string;
  suggestions: string[];
}

export function AIEmptyState({
  icon,
  greeting,
  description,
  suggestions
}: AIEmptyStateProps) {
  return (
    <div className="text-center py-8">
      <div className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40 flex items-center justify-center">
        {icon}
      </div>
      <p className="text-sm text-muted-foreground">{greeting}</p>
      {description && (
        <p className="text-xs text-muted-foreground/70 mt-1">{description}</p>
      )}
      <div className="mt-3 space-y-0.5">
        {suggestions.map((suggestion, index) => (
          <p key={index} className="text-xs text-muted-foreground/60">{suggestion}</p>
        ))}
      </div>
    </div>
  );
}
