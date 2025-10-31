'use client';

import React from 'react';
import { trpc } from '@/lib/trpc-client';
import { RawMaterialsChat } from '@/ai/components/chat/raw-materials-chat';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Package, Settings, Info, Database, Search } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

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
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <div className="flex items-center space-x-2 mb-2">
          <Package className="w-6 h-6 text-blue-500" />
          <h1 className="text-2xl font-bold">ผู้ช่วย AI แนะนำสารใน stock</h1>
        </div>
        <p className="text-gray-600 mb-4">
          พูดคุยกับผู้ช่วย AI ที่เชี่ยวชาญด้านวัตถุดิบใน stock พร้อมการค้นหาจากฐานข้อมูล raw_materials_real_stock เพื่อข้อมูลที่แม่นยำและเป็นปัจจุบัน
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* Main Chat Area - Full Width */}
        <Card className="h-[600px]">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center space-x-2">
              <Package className="w-5 h-5" />
              <span>บทสนทนากับผู้ช่วย AI แนะนำสารใน stock</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 h-[calc(100%-80px)]">
            <RawMaterialsChat
              userId={user.id}
              apiKey={process.env.NEXT_PUBLIC_GEMINI_API_KEY}
              provider="gemini"
              enableRAG={true}
              ragConfig={{
                topK: 5,
                similarityThreshold: 0.7
              }}
              onError={(error) => console.error('Raw materials chat error:', error)}
              onFeedbackSubmit={handleFeedbackSubmit}
            />
          </CardContent>
        </Card>

        {/* Features Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center space-x-2">
              <Settings className="w-5 h-5" />
              <span>คุณสมบัติเด่นของระบบ</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-start space-x-3">
                <Database className="w-5 h-5 text-blue-500 mt-0.5" />
                <div>
                  <h4 className="font-medium text-sm">ค้นหาจากฐานข้อมูล Stock</h4>
                  <p className="text-xs text-gray-600">ค้นหาข้อมูลวัตถุดิบจากฐานข้อมูล raw_materials_real_stock</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <Search className="w-5 h-5 text-blue-500 mt-0.5" />
                <div>
                  <h4 className="font-medium text-sm">RAG Enhancement</h4>
                  <p className="text-xs text-gray-600">ค้นหาข้อมูลที่เกี่ยวข้องจาก vector database อัตโนมัติ</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <Info className="w-5 h-5 text-blue-500 mt-0.5" />
                <div>
                  <h4 className="font-medium text-sm">ข้อมูลทางเทคนิค</h4>
                  <p className="text-xs text-gray-600">รับข้อมูล INCI name และรายละเอียดส่วนผสม</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <Info className="w-5 h-5 text-blue-500 mt-0.5" />
                <div>
                  <h4 className="font-medium text-sm">ข้อมูลซัพพลายเออร์</h4>
                  <p className="text-xs text-gray-600">ข้อมูลผู้ผลิตและต้นทุนวัตถุดิบ</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}