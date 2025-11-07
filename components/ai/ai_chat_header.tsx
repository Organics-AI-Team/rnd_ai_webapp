'use client';

import React from 'react';
import { CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/**
 * AI Chat Header Component
 *
 * Displays the chat header with icon, title, and optional badge.
 * No hardcoded HTML - fully component-based.
 *
 * @param icon - Icon element to display
 * @param title - Chat title text
 * @param iconColor - Tailwind color class for icon (default: 'text-blue-600')
 * @param badgeText - Optional badge text to display
 * @param badgeColor - Tailwind color classes for badge background and border
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
  badgeColor = 'bg-green-50 border-green-300'
}: AIChatHeaderProps) {
  return (
    <CardHeader className="pb-4">
      <CardTitle className="flex items-center gap-2">
        <div className={`w-5 h-5 ${iconColor}`}>
          {icon}
        </div>
        {title}
        {badgeText && (
          <Badge variant="outline" className={`text-xs ${badgeColor}`}>
            {badgeText}
          </Badge>
        )}
      </CardTitle>
    </CardHeader>
  );
}
