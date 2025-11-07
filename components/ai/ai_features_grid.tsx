'use client';

import React from 'react';
import { Card } from '@/components/ui/card';

/**
 * AI Features Grid Component
 *
 * Displays a responsive grid of feature cards with icon, title, and description.
 * Used to showcase AI assistant capabilities.
 *
 * @param features - Array of feature objects with title, description, and icon
 */

export interface Feature {
  title: string;
  description: string;
  icon: React.ReactNode;
}

interface AIFeaturesGridProps {
  features: Feature[];
}

export function AIFeaturesGrid({ features }: AIFeaturesGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {features.map((feature, index) => (
        <Card key={index} className="p-4">
          <div className="flex items-center gap-2 mb-2">
            {feature.icon}
            <h3 className="font-semibold text-sm">{feature.title}</h3>
          </div>
          <p className="text-xs text-gray-600">{feature.description}</p>
        </Card>
      ))}
    </div>
  );
}
