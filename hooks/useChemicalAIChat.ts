'use client';

import { useState, useCallback } from 'react';
import type { AgentType, ChatMessage } from '@/lib/ai/types';

export type { AgentType, ChatMessage } from '@/lib/ai/types';

interface UseChemicalAIChatOptions {
  agent_type?: AgentType;
  on_error?: (error: Error) => void;
}

interface UseChemicalAIChatReturn {
  messages: ChatMessage[];
  input: string;
  setInput: (input: string) => void;
  send_message: () => Promise<void>;
  isLoading: boolean;
  conversation_id: string | null;
  agent_type: AgentType;
  switch_agent: (agent_type: AgentType) => void;
  clear_chat: () => void;
  error: Error | null;
}

export const CHEMICAL_AGENTS = [
  {
    type: 'chemical_compound' as AgentType,
    name: 'สารเคมี',
    description: 'เชี่ยวชาญด้านสารเคมีและส่วนผสม',
    capabilities: ['ค้นหาสารเคมี', 'วิเคราะห์คุณสมบัติ', 'แนะนำสารทดแทน']
  },
  {
    type: 'formula_consultant' as AgentType,
    name: 'ที่ปรึกษาสูตร',
    description: 'เชี่ยวชาญด้านสูตรผลิตภัณฑ์',
    capabilities: ['พัฒนาสูตร', 'ปรับสัดส่วน', 'แก้ไขปัญหาสูตร']
  },
  {
    type: 'safety_advisor' as AgentType,
    name: 'ที่ปรึกษาความปลอดภัย',
    description: 'เชี่ยวชาญด้านความปลอดภัยและกฎระเบียบ',
    capabilities: ['ข้อมูลความปลอดภัย', 'กฎระเบียบ', 'มาตรฐาน']
  },
  {
    type: 'general_chemistry' as AgentType,
    name: 'เคมีทั่วไป',
    description: 'ความรู้เคมีทั่วไป',
    capabilities: ['คำถามทั่วไป', 'หลักการเคมี', 'คำอธิบายเบื้องต้น']
  }
];

export function useChemicalAIChat(options: UseChemicalAIChatOptions = {}): UseChemicalAIChatReturn {
  const { agent_type: initial_agent_type = 'general_chemistry', on_error } = options;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversation_id, setConversationId] = useState<string | null>(null);
  const [agent_type, setAgentType] = useState<AgentType>(initial_agent_type);
  const [error, setError] = useState<Error | null>(null);

  const send_message = useCallback(async () => {
    if (!input.trim()) return;

    const user_message: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, user_message]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      // Simulate AI response for now
      // In real implementation, this would call your AI API
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

      const ai_response: ChatMessage = {
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        content: generateChemicalResponse(input, agent_type),
        timestamp: new Date(),
        agent_type,
        tokens_used: Math.floor(Math.random() * 500) + 100,
        model: 'gpt-4',
      };

      setMessages(prev => [...prev, ai_response]);

      // Set conversation ID on first message
      if (!conversation_id) {
        setConversationId(`conv_${Date.now()}`);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to send message');
      setError(error);
      on_error?.(error);
    } finally {
      setIsLoading(false);
    }
  }, [input, agent_type, conversation_id, on_error]);

  const switch_agent = useCallback((new_agent_type: AgentType) => {
    setAgentType(new_agent_type);
  }, []);

  const clear_chat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setError(null);
  }, []);

  return {
    messages,
    input,
    setInput,
    send_message,
    isLoading,
    conversation_id,
    agent_type,
    switch_agent,
    clear_chat,
    error,
  };
}

// Helper function to generate chemical-specific responses
function generateChemicalResponse(user_input: string, agent_type: AgentType): string {
  const input_lower = user_input.toLowerCase();

  // Chemical compound identification
  if (agent_type === 'chemical_compound') {
    if (input_lower.includes('น้ำหอม') || input_lower.includes('fragrance')) {
      return `ฉันพบสารเคมีที่เกี่ยวข้องกับน้ำหอมหลายชนิดในฐานข้อมูล:

**สารที่พบ:**
- **Fragrance (Parfum)** - ส่วนผสมของน้ำหอม
- **Linalool** - สารกลิ่นหอมจากธรรมชาติ
- **Limonene** - สารกลิ่น citrus
- **Geraniol** - สารกลิ่นดอกไม้

**คุณสมบัติ:**
- ให้กลิ่นหอมที่เป็นเอกลักษณ์
- ช่วยเพิ่มประสบการณ์การใช้ผลิตภัณฑ์
- บางชนิดอาจก่อให้เกิดภูมิแพ้ได้

**ข้อควรระวัง:**
- ควรทดสอบภูมิแพ้ก่อนใช้งาน
- หลีกเลี่ยงในผลิตภัณฑ์สำหรับผิวบอบบาง

ต้องการข้อมูลเพิ่มเติมเกี่ยวกับสารใดหรือไม่?`;
    }

    if (input_lower.includes('กรด') || input_lower.includes('acid')) {
      return `สารที่เกี่ยวข้องกับกรดในเคมีความงาม:

**กรดที่พบบ่อย:**
- **Hyaluronic Acid** - กรดไฮยาลูรอนิก (ช่วยให้ความชุ่มชื้น)
- **Salicylic Acid** - กรดซาลิไซลิก (ช่วยรักษาสิว)
- **Glycolic Acid** - กรดไกลคอลิก (สลายเซลล์ผิว)
- **Lactic Acid** - กรดแลกติก (ผิวกระจ่างใส)

**คุณสมบัติหลัก:**
- ปรับสมดุล pH ของผิว
- ช่วยสลายเซลล์ผิวเก่า
- กระตุ้นการสร้างคอลลาเจน

**ข้อควรระวัง:**
- ควรเริ่มจากความเข้มข้นต่ำ
- หลีกเลี่ยงการใช้กับผิวแพ้ง่าย
- ใช้ครีมกันแดดเสมอ

สนใจศึกษาเกี่ยวกับกรดชนิดใดเป็นพิเศษหรือไม่?`;
    }
  }

  // Formula consultant responses
  if (agent_type === 'formula_consultant') {
    if (input_lower.includes('สูตร') || input_lower.includes('formula')) {
      return `ฉันสามารถช่วยเกี่ยวกับการพัฒนาสูตรได้:

**การพัฒนาสูตรพื้นฐาน:**
1. **กำหนดวัตถุประสงค์** - ผิวมัน, ผิวแห้ง,  anti-aging
2. **เลือกฐานสูตร** - cream, lotion, gel, serum
3. **เพิ่มสารออกฤทธิ์** - ตามคุณสมบัติที่ต้องการ
4. **ปรับสัดส่วน** - ให้ได้คุณสมบัติที่ต้องการ
5. **ทดสอบเสถียรภาพ** - texture, pH, stability

**สูตรแนะนำสำหรับมือใหม่:**
- **Moisturizing Cream**: 70-80% ฐานครีม, 15-20% น้ำมัน, 3-5% สารออกฤทธิ์
- **Serum**: 80-90% ฐานน้ำ, 5-10% สารออกฤทธิ์, 1-3% preservative

ต้องการคำแนะนำเกี่ยวกับสูตรแบบใดเป็นพิเศษหรือไม่?`;
    }
  }

  // Safety advisor responses
  if (agent_type === 'safety_advisor') {
    if (input_lower.includes('ปลอดภัย') || input_lower.includes('safety')) {
      return `หลักการความปลอดภัยในอุตสาหกรรมเคมีความงาม:

**มาตรฐานความปลอดภัย:**
- **GMP (Good Manufacturing Practice)** - มาตรฐานการผลิตที่ดี
- **ISO 22716** - มาตรฐานการผลิตเครื่องสำอาง
- **COSING** - ฐานข้อมูลสารเคมีของยุโรป

**การทดสอบความปลอดภัย:**
- **Patch Test** - ทดสอบภูมิแพ้
- **Stability Test** - ทดสอบเสถียรภาพ
- **Microbial Test** - ทดสอบจุลินทรีย์
- **Heavy Metal Test** - ทดสอบโลหะหนัก

**ข้อควรระวังทั่วไป:**
- ใช้อุปกรณ์ป้องกันอันตรายส่วนบุคคล
- ทำงานในพื้นที่มีระบบระบายอากาศดี
- เก็บข้อมูล Safety Data Sheet (SDS)
- มีทางออกฉุกเฉินพร้อม

มีคำถามเกี่ยวกับความปลอดภัยเฉพาะเจาะจงหรือไม่?`;
    }
  }

  // Default general chemistry response
  return `ฉันเป็นผู้ช่วยทางด้านเคมีที่สามารถช่วยคุณได้ในหลายเรื่อง:

**สิ่งที่ฉันช่วยได้:**
🔬 **ค้นหาสารเคมี** - ค้นหาและวิเคราะห์คุณสมบัติสารเคมี
📝 **ที่ปรึกษาสูตร** - ช่วยพัฒนาและปรับปรุงสูตรผลิตภัณฑ์
🛡️ **ความปลอดภัย** - ให้ข้อมูลด้านความปลอดภัยและกฎระเบียบ
📚 **ความรู้ทั่วไป** - ตอบคำถามเกี่ยวกับเคมีพื้นฐาน

**คำถามของคุณ:** "${user_input}"

ลองถามคำถามที่เจาะจงมากขึ้น เช่น:
- "สารให้ความชุ่มชื้นที่ดีที่สุดคืออะไร?"
- "อยากทำครีมกันแดดต้องใช้สารอะไรบ้าง?"
- "pH ที่เหมาะสมสำหรับผิวหน้าคือเท่าไหร่?"
- "วิธีการทดสอบเสถียรภาพของสูตร"

มีอะไรให้ช่วยเพิ่มเติมหรือไม่?`;
}