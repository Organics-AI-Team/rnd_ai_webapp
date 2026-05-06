'use client';

import React from 'react';
import { Card } from '@/components/ui/card';

/**
 * AI Features Grid - Compact feature showcase cards
 *
 * @param features - Array of feature objects with title, description, icon
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
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
      {features.map((feature, index) => (
        <Card key={index} className="p-3">
          <div className="flex items-center gap-1.5 mb-1">
            {feature.icon}
            <h3 className="font-medium text-xs text-gray-900">{feature.title}</h3>
          </div>
          <p className="text-2xs text-gray-500 leading-relaxed">{feature.description}</p>
        </Card>
      ))}
    </div>
  );
}
