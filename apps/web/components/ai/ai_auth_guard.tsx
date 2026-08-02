'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

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
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
          {icon}
        </div>
        <h2 className="mb-1 text-sm font-semibold text-emerald-950">{title}</h2>
        <p className="text-xs text-emerald-800/60">{description}</p>
        <Button asChild size="sm" className="mt-4">
          <Link href="/login">เข้าสู่ระบบ</Link>
        </Button>
      </div>
    </div>
  );
}
