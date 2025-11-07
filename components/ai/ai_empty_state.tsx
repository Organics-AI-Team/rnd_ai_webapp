'use client';

import React from 'react';

/**
 * AI Empty State Component
 *
 * Displays a welcome message and suggested topics when chat is empty.
 * Shows icon, greeting, description, and list of capabilities.
 *
 * @param icon - Icon element to display at top
 * @param greeting - Welcome greeting message
 * @param description - Brief description of AI assistant
 * @param suggestions - Array of capability/suggestion strings
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
      <div className="w-12 h-12 mx-auto mb-4 text-gray-300 flex items-center justify-center">
        {icon}
      </div>
      <p className="text-gray-500">{greeting}</p>
      {description && (
        <p className="text-gray-400 text-sm mt-2">{description}</p>
      )}
      <div className="mt-4 text-sm text-gray-400">
        {suggestions.map((suggestion, index) => (
          <p key={index}>• {suggestion}</p>
        ))}
      </div>
    </div>
  );
}
