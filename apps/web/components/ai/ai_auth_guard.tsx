'use client';

import React from 'react';

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
      <div className="text-center max-w-sm">
        <div className="w-10 h-10 mx-auto mb-3 text-gray-300 flex items-center justify-center">
          {icon}
        </div>
        <h2 className="text-sm font-semibold text-gray-900 mb-1">{title}</h2>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
    </div>
  );
}
