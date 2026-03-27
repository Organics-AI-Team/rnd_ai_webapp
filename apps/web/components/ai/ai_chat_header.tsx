'use client';

import React from 'react';
import { CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/**
 * AI Chat Header Component - Compact, Cloudflare-style
 *
 * @param icon - Icon element to display
 * @param title - Chat title text
 * @param iconColor - Tailwind color class for icon
 * @param badgeText - Optional status badge text
 * @param badgeColor - Badge color classes
 */

interface AIChatHeaderProps {
  icon: React.ReactNode;
  title: string;
  iconColor?: string;
  badgeText?: string;
  badgeColor?: string;
}

export function AIChatHeader({
  icon,
  title,
  iconColor = 'text-blue-600',
  badgeText,
  badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200'
}: AIChatHeaderProps) {
  return (
    <CardHeader className="px-4 py-2.5 border-b border-border">
      <CardTitle className="flex items-center gap-2 text-sm">
        <div className={`w-4 h-4 ${iconColor}`}>
          {icon}
        </div>
        <span className="font-medium">{title}</span>
        {badgeText && (
          <Badge variant="outline" className={`text-2xs ${badgeColor}`}>
            {badgeText}
          </Badge>
        )}
      </CardTitle>
    </CardHeader>
  );
}
