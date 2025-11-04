'use client';

import React from 'react';
import { trpc } from '@/lib/trpc-client';
import { AIChat } from '@/ai/components/chat/ai-chat';
import { Bot, MessageSquare, Zap, Shield } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { AIChatLayout } from '@/components/ai-chat-layout';

export default function RawMaterialsAllAIPage() {
  const { user } = useAuth();
  const feedbackSubmitMutation = trpc.feedback.submit.useMutation();

  const handleFeedbackSubmit = async (feedbackData: any) => {
    try {
      await feedbackSubmitMutation.mutateAsync(feedbackData);
    } catch (error) {
      console.error('Failed to submit feedback:', error);
    }
  };

  const features = [
    {
      title: 'Raw Materials Knowledge',
      description: 'AI-powered assistance for all raw materials inquiries and general knowledge',
      icon: <MessageSquare className="w-5 h-5 text-blue-500" />
    },
    {
      title: 'Fast Response',
      description: 'Quick and accurate answers to your raw materials questions',
      icon: <Zap className="w-5 h-5 text-yellow-500" />
    },
    {
      title: 'Multi-language',
      description: 'Support for both Thai and English conversations',
      icon: <Shield className="w-5 h-5 text-green-500" />
    }
  ];

  if (!user) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">
          <Bot className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h2 className="text-xl font-semibold mb-2">กรุณาเข้าสู่ระบบเพื่อใช้ผู้ช่วย AI สำหรับวัตถุดิบทั้งหมด</h2>
          <p className="text-gray-600">คุณต้องได้รับการยืนยันตัวตนเพื่อเข้าถึงผู้ช่วย AI ที่มีความรู้ครอบคลุมด้านวัตถุดิบและความรู้ทั่วไป</p>
        </div>
      </div>
    );
  }

  
  return (
    <AIChatLayout
      title="บทสนทนากับผู้ช่วย AI สำหรับวัตถุดิบทั้งหมด"
      description="ถามคำถามเกี่ยวกับวัตถุดิบ ความรู้ทั่วไป และข้อมูลสารเคมีได้ทั่วไป"
      icon={<Bot className="w-6 h-6" />}
      badge="Raw Materials All AI"
      features={features}
      showHeader={false}
    >
      <AIChat
        userId={user.id}
        apiKey={process.env.NEXT_PUBLIC_GEMINI_API_KEY}
        provider="gemini"
        onFeedbackSubmit={handleFeedbackSubmit}
      />
    </AIChatLayout>
  );
}