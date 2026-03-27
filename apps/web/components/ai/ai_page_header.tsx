'use client';

import React from 'react';

/**
 * AI Page Header - Compact header with icon, title, description
 *
 * @param icon - Icon element
 * @param title - Page title
 * @param description - Page description
 * @param iconColor - Tailwind icon color class
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
    <div className="flex items-center gap-2.5 py-1">
      <div className={`w-5 h-5 ${iconColor}`}>
        {icon}
      </div>
      <div>
        <h1 className="text-sm font-semibold text-gray-900">{title}</h1>
        <p className="text-2xs text-gray-500">{description}</p>
      </div>
    </div>
  );
}
