'use client';

import React from 'react';
import { trpc } from '@/lib/trpc-client';
import { RawMaterialsChat } from '@/ai/components/chat/raw-materials-chat';
import { Package, Search, Database, FlaskConical } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { AIChatLayout } from '@/components/ai-chat-layout';

export default function RawMaterialsAIPage() {
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
      title: 'Raw Materials Database',
      description: 'Access comprehensive database of raw materials and ingredients',
      icon: <Database className="w-5 h-5 text-blue-500" />
    },
    {
      title: 'Intelligent Search',
      description: 'AI-powered search with semantic matching and filtering',
      icon: <Search className="w-5 h-5 text-green-500" />
    },
    {
      title: 'Formulation Guidance',
      description: 'Expert advice on ingredient combinations and formulations',
      icon: <FlaskConical className="w-5 h-5 text-purple-500" />
    },
    {
      title: 'Regulatory Information',
      description: 'FDA compliance and regulatory status for materials',
      icon: <Package className="w-5 h-5 text-orange-500" />
    }
  ];

  if (!user) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">
          <Package className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h2 className="text-xl font-semibold mb-2">กรุณาเข้าสู่ระบบเพื่อใช้ผู้ช่วย AI สำหรับวัตถุดิบ</h2>
          <p className="text-gray-600">คุณต้องได้รับการยืนยันตัวตนเพื่อเข้าถึงผู้ช่วย AI ที่เชี่ยวชาญด้านวัตถุดิบและส่วนผสมในอุตสาหกรรมเครื่องสำอาง</p>
        </div>
      </div>
    );
  }

  return (
    <AIChatLayout
      title="บทสนทนากับผู้ช่วย AI สำหรับวัตถุดิบ"
      description="ถามคำถามเกี่ยวกับวัตถุดิบ ส่วนผสม ข้อมูลการผลิต และข้อกำหนดด้าน FDA ในอุตสาหกรรมเครื่องสำอาง"
      icon={<Package className="w-6 h-6" />}
      badge="Raw Materials AI"
      features={features}
      showHeader={false}
    >
      <RawMaterialsChat
        userId={user.id}
        apiKey={process.env.NEXT_PUBLIC_GEMINI_API_KEY}
        provider="agent"
        serviceName="rawMaterialsAI"
        onError={(error) => console.error('Raw Materials AI chat error:', error)}
        onFeedbackSubmit={handleFeedbackSubmit}
      />
    </AIChatLayout>
  );
}