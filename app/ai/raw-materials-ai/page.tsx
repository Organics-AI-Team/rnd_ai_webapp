'use client';

import React from 'react';
import { trpc } from '@/lib/trpc-client';
import { RawMaterialsChat } from '@/ai/components/chat/raw-materials-chat';
import { Package, Database, Search, Info, Truck } from 'lucide-react';
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
      title: 'ค้นหาจากฐานข้อมูล Stock',
      description: 'ค้นหาข้อมูลวัตถุดิบจากฐานข้อมูล raw_materials_real_stock',
      icon: <Database className="w-5 h-5 text-blue-500" />
    },
    {
      title: 'RAG Enhancement',
      description: 'ค้นหาข้อมูลที่เกี่ยวข้องจาก vector database อัตโนมัติ',
      icon: <Search className="w-5 h-5 text-green-500" />
    },
    {
      title: 'ข้อมูลทางเทคนิค',
      description: 'รับข้อมูล INCI name และรายละเอียดส่วนผสม',
      icon: <Info className="w-5 h-5 text-purple-500" />
    },
    {
      title: 'ข้อมูลซัพพลายเออร์',
      description: 'ข้อมูลผู้ผลิตและต้นทุนวัตถุดิบ',
      icon: <Truck className="w-5 h-5 text-orange-500" />
    }
  ];

  if (!user) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">
          <Package className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h2 className="text-xl font-semibold mb-2">กรุณาเข้าสู่ระบบเพื่อใช้ผู้ช่วย AI แนะนำสารใน stock</h2>
          <p className="text-gray-600">คุณต้องได้รับการยืนยันตัวตนเพื่อเข้าถึงผู้ช่วย AI ที่เชี่ยวชาญด้านวัตถุดิบใน stock</p>
        </div>
      </div>
    );
  }

  return (
    <AIChatLayout
      title="บทสนทนากับผู้ช่วย AI แนะนำสารใน stock"
      description="ถามคำถามเกี่ยวกับวัตถุดิบใน stock พร้อมข้อมูลจากฐานข้อมูลเฉพาะ"
      icon={<Package className="w-6 h-6" />}
      badge="Stock AI"
      features={features}
      showHeader={false}
    >
      <RawMaterialsChat
        userId={user.id}
        apiKey={process.env.NEXT_PUBLIC_GEMINI_API_KEY}
        provider="gemini"
        serviceName="rawMaterialsAI"
        onError={(error) => console.error('Raw materials chat error:', error)}
        onFeedbackSubmit={handleFeedbackSubmit}
      />
    </AIChatLayout>
  );
}