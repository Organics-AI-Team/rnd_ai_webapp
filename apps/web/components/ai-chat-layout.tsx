'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Bot,
  Package,
  Settings,
  Info,
  Database,
  Search
} from 'lucide-react';

interface AIChatLayoutProps {
  title: string;
  description?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  features?: {
    title: string;
    description: string;
    icon: React.ReactNode;
  }[];
  badge?: string;
  showHeader?: boolean;
}

export function AIChatLayout({
  title,
  description,
  icon,
  children,
  features,
  badge,
  showHeader = true
}: AIChatLayoutProps) {
  return (
    <div className="w-full h-full">
      <div className="h-full flex flex-col">
        {/* Full Screen Chat Container */}
        <div className="flex-1 bg-white flex flex-col">
          {/* Chat Header - Conditionally shown */}
          {showHeader && (
            <div className="px-6 py-4 border-b bg-gray-50/50 flex-shrink-0">
              <div className="flex items-center justify-between max-w-7xl mx-auto">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <div className="text-blue-600">
                      {icon}
                    </div>
                  </div>
                  <div>
                    <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
                    {description && (
                      <p className="text-sm text-gray-600 mt-1">{description}</p>
                    )}
                  </div>
                </div>
                {badge && (
                  <Badge variant="secondary" className="text-xs">
                    {badge}
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Chat Content - Takes remaining space with proper constraints */}
          <div className="flex-1 flex flex-col p-6 min-h-0">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}