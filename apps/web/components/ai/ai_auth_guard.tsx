'use client';

import React from 'react';
import { IconTile } from '@/components/ui/surface';

/**
 * AI Auth Guard - Login prompt for unauthenticated users
 *
 * @param icon - Display icon
 * @param title - Auth prompt title
 * @param description - Explanation text
 */

interface AIAuthGuardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

export function AIAuthGuard({
  icon,
  title,
  description
}: AIAuthGuardProps) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="max-w-sm text-center">
        <IconTile className="mx-auto mb-3 text-muted">
          {icon}
        </IconTile>
        <h2 className="mb-1 text-base font-semibold text-ink">{title}</h2>
        <p className="text-sm text-muted">{description}</p>
      </div>
    </div>
  );
}
