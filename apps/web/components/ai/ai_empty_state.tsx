'use client';

import React from 'react';

/**
 * AI Empty State - Minimal welcome screen when no messages exist
 *
 * @param icon - Center icon
 * @param greeting - Welcome text
 * @param description - Optional description
 * @param suggestions - Capability hints
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
      <div className="w-8 h-8 mx-auto mb-3 text-gray-300 flex items-center justify-center">
        {icon}
      </div>
      <p className="text-sm text-gray-500">{greeting}</p>
      {description && (
        <p className="text-xs text-gray-400 mt-1">{description}</p>
      )}
      <div className="mt-3 space-y-0.5">
        {suggestions.map((suggestion, index) => (
          <p key={index} className="text-xs text-gray-400">{suggestion}</p>
        ))}
      </div>
    </div>
  );
}
