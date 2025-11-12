'use client';

import React from 'react';

/**
 * AI Page Header Component
 *
 * Displays the page header with icon, title, and description.
 * No hardcoded HTML - fully component-based.
 *
 * @param icon - Icon element to display
 * @param title - Page title text
 * @param description - Page description text
 * @param iconColor - Tailwind color class for icon (default: 'text-blue-600')
 */

interface AIPageHeaderProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  iconColor?: string;
}

export function AIPageHeader({
  icon,
  title,
  description,
  iconColor = 'text-blue-600'
}: AIPageHeaderProps) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-8 h-8 ${iconColor}`}>
        {icon}
      </div>
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-gray-600">{description}</p>
      </div>
    </div>
  );
}
