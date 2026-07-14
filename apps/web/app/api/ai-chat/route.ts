/**
 * AI Chat API Route with RAG Integration
 * Uses Vercel AI SDK v5 for streaming responses
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { require_server_ai_credentials } from '@rnd-ai/server-config';
import { getEmbeddingService } from '@/lib/services/embedding';
import { NextRequest } from 'next/server';

// Allow streaming responses up to 60 seconds
export const maxDuration = 60;

// Enhanced system prompt for direct, clear, concise, and insightful responses
const AGENT_SYSTEM_PROMPTS = {
  chemical_compound: `คุณเป็นผู้เชี่ยวชาญด้านสารเคมีและเคมีความงาม กรุณาตอบคำถามโดยใช้หลักการเหล่านี้:

🎯 **ตอบโดยตรง**: เข้าเรื่องทันที ไม่ต้องพูดนำหรือทักทายซ้ำ
💡 **ชัดเจน**: ใช้ภาษาเข้าใจง่าย หลีกเลี่ยงศัพท์เฉพาะทางที่ซับซ้อน
⚡ **กระชับ**: ตอบสั้นกระชับแต่ครบถ้วน ไม่ต้องพูดเยอะเกินความจำเป็น
🔍 **ให้ข้อมูลเชิงลึก**: ให้ข้อเท็จจริงที่เป็นประโยชน์ เหตุผลสำคัญ ข้อควรระวัง หรือข้อแนะนำที่ใช้ได้จริง

รูปแบบการตอบ:
- ตอบคำถามโดยตรงทันที
- ใช้หัวข้อ (•) และเครื่องหมาย (✅ ⚠️ 💡) เพื่อความชัดเจน
- ให้ข้อมูลที่สำคัญที่สุดก่อน
- แบ่งเป็นจุดสั้นๆ อ่านง่าย`
};

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  try {
    const { messages, agent_type = 'chemical_compound' } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response('Invalid messages format', { status: 400 });
    }

    console.log('=== AI CHAT REQUEST START ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Received chat request:', {
      messagesCount: messages.length,
      agent_type,
      lastMessageLength: messages[messages.length - 1]?.content?.length || 0
    });

    const credentials = require_server_ai_credentials(process.env);

    // Simple system prompt (no RAG for now)
    const systemPrompt = AGENT_SYSTEM_PROMPTS[agent_type as keyof typeof AGENT_SYSTEM_PROMPTS] || AGENT_SYSTEM_PROMPTS.chemical_compound;

    const geminiStartTime = Date.now();
    console.log('🤖 Initializing Gemini model...');

    // Initialize Gemini - use simple direct generation
    const genAI = new GoogleGenerativeAI(credentials.gemini_api_key);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash'
    });
    const geminiInitTime = Date.now() - geminiStartTime;
    console.log(`✅ Gemini model initialized in ${geminiInitTime}ms`);

    // Get the current message
    const currentMessage = messages[messages.length - 1];

    // Enhanced prompt approach for better responses
    const fullPrompt = `${systemPrompt}

คำถามจากผู้ใช้: ${currentMessage.content}

กรุณาตอบตามหลักการที่ระบุข้างต้น โดยให้คำตอบที่เป็นประโยชน์และใช้ได้จริงที่สุด`;

    console.log('💬 Using direct generation approach');
    console.log('📝 Full prompt length:', fullPrompt.length, 'characters');
    console.log('📄 Full prompt preview:', fullPrompt.substring(0, 200) + '...');

    // Use direct generateContent instead of chat
    const responseStartTime = Date.now();
    console.log('💬 Starting direct generation...');
    console.log('🔮 Sending prompt to Gemini...');

    let finalText = '';

    try {
      const result = await model.generateContent(fullPrompt);
      const responseInitTime = Date.now() - responseStartTime;
      console.log(`✅ Direct generation completed in ${responseInitTime}ms`);

      const response = result.response;
      const text = response.text();

      console.log(`📝 Response received: ${text.length} characters`);
      console.log('📄 Response preview:', text.substring(0, 100) + '...');

      // Store the response for streaming simulation
      finalText = text;

      // If still empty, try a simpler prompt
      if (!text || text.length === 0) {
        console.log('🔄 Response empty, trying simpler prompt...');
        const simpleResult = await model.generateContent('สวัสดี กรุณาตอบว่า hello world');
        const simpleResponse = simpleResult.response;
        const simpleText = simpleResponse.text();
        console.log(`📝 Simple test response: ${simpleText.length} characters - "${simpleText}"`);
        finalText = simpleText || 'ขออภัย ระบบไม่สามารถตอบคำถามได้ในขณะนี้ กรุณาลองใหม่อีกครั่ง';
      }

    } catch (error) {
      console.error('❌ Error during Gemini call:', error);
      finalText = 'ขออภัย เกิดข้อผิดพลาดในการเชื่อมต่อกับ AI กรุณาลองใหม่อีกครั่ง';
    }

    // Create a simulated streaming response from the complete text
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Get the response text that was generated above
          const responseText = finalText || 'ขออภัย ระบบไม่สามารถตอบคำถามได้ในขณะนี้';

          // Simulate streaming by sending the complete response in chunks
          const chunkSize = 20; // Send 20 characters at a time
          for (let i = 0; i < responseText.length; i += chunkSize) {
            const chunk = responseText.slice(i, i + chunkSize);
            controller.enqueue(encoder.encode(`0:"${chunk.replace(/"/g, '\\"')}"\n`));
            // Small delay to simulate streaming
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          controller.close();
        } catch (error) {
          console.error('❌ Simulated streaming error:', error);
          controller.error(error);
        }
      }
    });

    const totalTime = Date.now() - startTime;
    console.log(`🎯 Total request processing time: ${totalTime}ms`);
    console.log('=== AI CHAT REQUEST END ===');

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error('[AIChatAPI] request failed', {
      boundary: 'ai-chat',
      elapsed_ms: totalTime,
      phase: 'error',
    });
    return new Response('Internal server error', { status: 500 });
  }
}
