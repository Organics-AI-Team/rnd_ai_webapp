/**
 * Test Gemini 2.5 Flash Streaming API
 * Debug script to test streaming responses directly
 */

require('dotenv').config({ path: '.env.local' });
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testGeminiStreaming() {
  try {
    console.log('🤖 Testing Gemini 2.5 Flash Streaming API...');

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not found');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    console.log('✅ Model initialized');

    // Test 1: Simple generation without streaming
    console.log('\n📝 Testing simple generation...');
    const simplePrompt = "สวัสดี กรุณาแนะนำสารให้ความชุ่มชื้นสำหรับผิวแห้ง 1-2 ชนิด";

    const simpleResult = await model.generateContent(simplePrompt);
    const simpleResponse = await simpleResult.response;
    const simpleText = simpleResponse.text();

    console.log('✅ Simple generation works!');
    console.log('📄 Response:', simpleText.substring(0, 200) + '...');

    // Test 2: Chat without streaming
    console.log('\n💬 Testing chat without streaming...');
    const chat = model.startChat({
      history: [],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 500,
      }
    });

    const chatResult = await chat.sendMessage("สารเคมีใดที่ให้ความชุ่มชื้นที่ดีที่สุด?");
    const chatResponse = await chatResult.response;
    const chatText = chatResponse.text();

    console.log('✅ Chat without streaming works!');
    console.log('📄 Response:', chatText.substring(0, 200) + '...');

    // Test 3: Streaming (the problematic one)
    console.log('\n🌊 Testing streaming...');
    const streamChat = model.startChat({
      history: [],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 500,
      }
    });

    console.log('🔮 Sending streaming request...');
    const streamResult = await streamChat.sendMessageStream("สารเคมีใดที่ให้ความชุ่มชื้นที่ดีที่สุด?");

    let chunkCount = 0;
    let totalText = '';

    for await (const chunk of streamResult.stream) {
      const text = chunk.text();
      chunkCount++;
      totalText += text;

      if (chunkCount === 1) {
        console.log('📨 First chunk received:', text);
      }
    }

    console.log(`✅ Streaming completed: ${chunkCount} chunks, ${totalText.length} characters`);
    console.log('📄 Full response:', totalText.substring(0, 200) + '...');

    // Test 4: Streaming with system instruction in message
    console.log('\n🔧 Testing streaming with system instruction in message...');
    const systemPrompt = `คุณเป็นผู้เชี่ยวชาญด้านสารเคมีและส่วนผสมในอุตสาหกรรมเคมีความงาม คุณมีความรู้เชิงลึกเกี่ยวกับ:
- สารเคมีต่างๆ และคุณสมบัติของสาร
- ส่วนผสมในผลิตภัณฑ์เคมีความงาม
- ชื่อ INCI และการตั้งชื่อสารเคมี

ตอบคำถามเป็นภาษาไทยที่เป็นธรรมชาติ เชี่ยวชาญ และให้ข้อมูลที่ถูกต้อง`;

    const fullPrompt = `${systemPrompt}\n\nคำถาม: สารให้ความชุ่มชื้นที่ดีที่สุดคืออะไร?`;

    const systemChat = model.startChat({
      history: [],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 500,
      }
    });

    console.log('🔮 Sending streaming request with system prompt...');
    const systemResult = await systemChat.sendMessageStream(fullPrompt);

    let systemChunkCount = 0;
    let systemTotalText = '';

    for await (const chunk of systemResult.stream) {
      const text = chunk.text();
      systemChunkCount++;
      systemTotalText += text;

      if (systemChunkCount === 1) {
        console.log('📨 First system chunk received:', text);
      }
    }

    console.log(`✅ System streaming completed: ${systemChunkCount} chunks, ${systemTotalText.length} characters`);
    console.log('📄 System response:', systemTotalText.substring(0, 200) + '...');

    console.log('\n🎉 All Gemini streaming tests completed!');

  } catch (error) {
    console.error('❌ Gemini streaming test failed:', error);
    console.error('Stack:', error.stack);
  }
}

testGeminiStreaming();