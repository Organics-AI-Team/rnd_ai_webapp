'use client';

import React from 'react';
import { trpc } from '@/lib/trpc-client';
import { AIChat } from '@/ai/components/chat/ai-chat';
import { TrendingUp, Users, Target, DollarSign, BarChart3, Handshake } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { AIChatLayout } from '@/components/ai-chat-layout';
import { getSalesRndAIAgent } from '@/ai/agents/core/agent-usage-example';

export default function SalesRndAIPage() {
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
      title: 'Sales Strategy',
      description: 'AI-powered sales tactics and customer relationship management',
      icon: <Target className="w-5 h-5 text-purple-500" />
    },
    {
      title: 'Market Intelligence',
      description: 'Real-time market trends and competitive analysis',
      icon: <BarChart3 className="w-5 h-5 text-blue-500" />
    },
    {
      title: 'Business Development',
      description: 'Partnership opportunities and growth strategies',
      icon: <Handshake className="w-5 h-5 text-green-500" />
    },
    {
      title: 'Revenue Growth',
      description: 'Pricing strategies and revenue optimization',
      icon: <DollarSign className="w-5 h-5 text-yellow-500" />
    }
  ];

  if (!user) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">
          <TrendingUp className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h2 className="text-xl font-semibold mb-2">กรุณาเข้าสู่ระบบเพื่อใช้ผู้ช่วย AI สำหรับ Sales และ Marketing</h2>
          <p className="text-gray-600">คุณต้องได้รับการยืนยันตัวตนเพื่อเข้าถึงผู้ช่วย AI ที่เชี่ยวชาญด้านการขายและการตลาดตลายในอุตสาหกรรมวัตถุดิบ</p>
        </div>
      </div>
    );
  }

  return (
    <AIChatLayout
      title="บทสนทนากับผู้ช่วย AI สำหรับ Sales และ Marketing"
      description="ถามคำถามเกี่ยวกับกลยุทธศาสตร์การขาย ข้อมูลตลาดตลาย และการพัฒนาธุรกิจในอุตสาหกรรมวัตถุดิบและเครื่องสำอาง"
      icon={<TrendingUp className="w-6 h-6" />}
      badge="Sales RND AI"
      features={features}
      showHeader={false}
    >
      <AIChat
        userId={user.id}
        apiKey={process.env.NEXT_PUBLIC_GEMINI_API_KEY}
        provider="gemini"
        onError={(error) => console.error('Sales RND AI chat error:', error)}
        onFeedbackSubmit={handleFeedbackSubmit}
      />
    </AIChatLayout>
  );
}