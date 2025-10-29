'use client';

import React from 'react';
import { trpc } from '@/lib/trpc-client';
import { AIChat } from '@/components/ai-chat';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Bot, Settings, Info } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

export default function AIChatPage() {
  const { user } = useAuth();
  const feedbackSubmitMutation = trpc.feedback.submit.useMutation();

  const handleFeedbackSubmit = async (feedbackData: any) => {
    try {
      await feedbackSubmitMutation.mutateAsync(feedbackData);
      console.log('Feedback submitted successfully');
    } catch (error) {
      console.error('Failed to submit feedback:', error);
    }
  };

  if (!user) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">
          <Bot className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h2 className="text-xl font-semibold mb-2">กรุณาเข้าสู่ระบบเพื่อใช้แชท AI</h2>
          <p className="text-gray-600">คุณต้องได้รับการยืนยันตัวตนเพื่อเข้าถึงผู้ช่วย AI</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <div className="flex items-center space-x-2 mb-2">
          <Bot className="w-6 h-6 text-blue-500" />
          <h1 className="text-2xl font-bold">ผู้ช่วย AI</h1>
        </div>
        <p className="text-gray-600">
          พูดคุยกับผู้ช่วย AI ที่เรียนรู้จากคำติชมของคุณเพื่อให้คำตอบที่ดีขึ้นตามเวลา
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* Main Chat Area - Full Width */}
        <Card className="h-[600px]">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">บทสนทนา AI</CardTitle>
          </CardHeader>
          <CardContent className="p-0 h-[calc(100%-80px)]">
            <AIChat
              userId={user.id}
              apiKey={process.env.NEXT_PUBLIC_GEMINI_API_KEY}
              onFeedbackSubmit={handleFeedbackSubmit}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}