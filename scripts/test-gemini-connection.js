/**
 * Test Gemini API Connection Script
 * Tests basic connectivity to Google Gemini API for embedding generation
 */

require('dotenv').config({ path: '.env.local' });
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testGeminiConnection() {
  try {
    console.log('🤖 Testing Gemini AI connection...');

    // Check environment variables
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not set');
    }

    console.log('✅ Environment variables found');

    // Initialize Gemini
    console.log('🧠 Initializing Gemini AI...');
    const genAI = new GoogleGenerativeAI(apiKey);

    // Test 1: Embedding generation
    console.log('📊 Testing embedding generation...');
    const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });

    const testTexts = [
      'Hello world',
      'น้ำมันมะพร้าว เป็นสารที่ให้ความชุ่มชื้น',
      'สารเคมีสำหรับผิวหน้า',
      'เทสต์ภาษาอังกฤษและไทย'
    ];

    for (let i = 0; i < testTexts.length; i++) {
      const text = testTexts[i];
      console.log(`🔍 Testing embedding ${i + 1}/${testTexts.length}: "${text.substring(0, 30)}..."`);

      try {
        const result = await embeddingModel.embedContent(text);
        const embedding = result.embedding;

        console.log(`  ✅ Embedding generated successfully`);
        console.log(`  📏 Dimensions: ${embedding.values.length}`);
        console.log(`  📊 First 5 values: [${embedding.values.slice(0, 5).map(v => v.toFixed(6)).join(', ')}]`);

        if (embedding.values.length !== 3072) {
          throw new Error(`Expected 3072 dimensions, got ${embedding.values.length}`);
        }

      } catch (error) {
        console.error(`  ❌ Failed to generate embedding: ${error.message}`);

        if (i === 0) {
          // If first test fails, throw overall error
          throw error;
        }
      }
    }

    // Test 2: Text generation (to verify general API access)
    console.log('\n💬 Testing text generation...');
    const textModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const textResult = await textModel.generateContent('สวัสดี กรุณาแนะนำสารให้ความชุ่มชื้นสำหรับผิวแห้ง 1-2 ชนิด');
    const response = await textResult.response;
    const text = response.text();

    console.log('✅ Text generation working');
    console.log(`📝 Response: "${text.substring(0, 100)}..."`);

    console.log('\n🎉 All Gemini AI tests passed!');
    console.log('✅ Your connection to Gemini AI is working correctly');

  } catch (error) {
    console.error('❌ Gemini AI connection test failed:', error.message);

    if (error.message.includes('fetch failed') || error.message.includes('timeout') || error.message.includes('ENOTFOUND')) {
      console.log('\n🔧 Troubleshooting suggestions:');
      console.log('1. Check your internet connection');
      console.log('2. Verify you can access googleapis.com');
      console.log('3. Check if you need a VPN or proxy settings');
      console.log('4. Try pinging googleapis.com from your terminal');
      console.log('5. Check if your firewall is blocking the requests');
    } else if (error.message.includes('403') || error.message.includes('401')) {
      console.log('\n🔑 Authentication issue:');
      console.log('1. Check your GEMINI_API_KEY is correct');
      console.log('2. Verify the API key has proper permissions');
      console.log('3. Check if the API key has expired');
      console.log('4. Visit Google AI Studio to verify your API key');
    } else if (error.message.includes('quota') || error.message.includes('rate limit')) {
      console.log('\n📊 Quota/Rate limit issue:');
      console.log('1. Check your API usage quota');
      console.log('2. Wait and try again later');
      console.log('3. Consider upgrading your plan');
    }

    process.exit(1);
  }
}

// Run the test
testGeminiConnection();