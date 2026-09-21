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
  iconColor = 'text-brand'
}: AIPageHeaderProps) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className={`h-5 w-5 ${iconColor}`}>
        {icon}
      </div>
      <div>
        <h1 className="text-base font-semibold text-ink">{title}</h1>
        <p className="text-xs text-muted">{description}</p>
      </div>
    </div>
  );
}
