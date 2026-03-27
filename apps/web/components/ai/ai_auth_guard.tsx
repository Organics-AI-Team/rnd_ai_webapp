'use client';

import React from 'react';

/**
 * AI Auth Guard - Minimal login prompt for unauthenticated users
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
      <div className="text-center max-w-sm">
        <div className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30 flex items-center justify-center">
          {icon}
        </div>
        <h2 className="text-sm font-semibold text-foreground mb-1">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
