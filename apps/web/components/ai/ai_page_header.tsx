'use client';

import React from 'react';

/**
 * AI Page Header Component - Compact, Cloudflare-style
 *
 * @param icon - Icon element to display
 * @param title - Page title text
 * @param description - Page description text
 * @param iconColor - Tailwind color class for icon
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
        <h1 className="text-sm font-semibold text-foreground">{title}</h1>
        <p className="text-2xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
