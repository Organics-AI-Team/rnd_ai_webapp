'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Redirect old AI chat route to new location
 */
export default function OldAIChatRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/ai/ai-chat');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Redirecting to new AI Chat...</p>
      </div>
    </div>
  );
}