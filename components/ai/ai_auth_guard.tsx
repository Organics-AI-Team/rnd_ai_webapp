'use client';

import React from 'react';

/**
 * AI Auth Guard Component
 *
 * Displays a login prompt when user is not authenticated.
 * Shows icon, title, and description encouraging user to sign in.
 *
 * @param icon - Icon element to display
 * @param title - Main title text
 * @param description - Description text explaining why auth is needed
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
    <div className="container mx-auto p-6">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 text-gray-300 flex items-center justify-center">
          {icon}
        </div>
        <h2 className="text-xl font-semibold mb-2">{title}</h2>
        <p className="text-gray-600">{description}</p>
      </div>
    </div>
  );
}
