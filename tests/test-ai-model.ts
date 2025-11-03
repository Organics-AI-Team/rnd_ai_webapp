#!/usr/bin/env tsx

/**
 * Test script to verify the Gemini AI model is working
 */

import { config } from 'dotenv';
import { GeminiService } from '../ai/services/providers/gemini-service';

// Load environment variables
config({ path: '.env.local' });

console.log('🔧 Environment Variables:');
console.log(`GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? '✅ Set' : '❌ Missing'}`);
console.log(`NEXT_PUBLIC_GEMINI_API_KEY: ${process.env.NEXT_PUBLIC_GEMINI_API_KEY ? '✅ Set' : '❌ Missing'}`);

async function testGeminiModel() {
  console.log('\n🤖 Testing Gemini AI Model...');

  try {
    const service = new GeminiService(process.env.NEXT_PUBLIC_GEMINI_API_KEY!);

    console.log('✅ Gemini service created successfully');

    // Test 1: Simple question
    console.log('\n📝 Test 1: Simple question');
    const response1 = await service.generateResponse({
      prompt: 'Hello, respond with just "AI working"',
      userId: 'test-user-1'
    });

    console.log('✅ Response 1:', response1.response);
    console.log('📊 Latency:', response1.metadata?.latency, 'ms');
    console.log('🏷️ Model:', response1.model);

    // Test 2: Chemical question (without RAG)
    console.log('\n🧪 Test 2: Chemical question');
    const response2 = await service.generateResponse({
      prompt: 'What is benzothiazine used for in cosmetics?',
      userId: 'test-user-2'
    });

    console.log('✅ Response 2:', response2.response);
    console.log('📊 Latency:', response2.metadata?.latency, 'ms');

    // Test 3: Thai language
    console.log('\n🇹🇭 Test 3: Thai language');
    const response3 = await service.generateResponse({
      prompt: 'สารเคมีคืออะไร? ตอบสั้นๆ',
      userId: 'test-user-3'
    });

    console.log('✅ Response 3:', response3.response);
    console.log('📊 Latency:', response3.metadata?.latency, 'ms');

    return true;

  } catch (error: any) {
    console.log('❌ Gemini model test failed:', error.message);
    console.log('❌ Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });

    // Check for specific error types
    if (error.message.includes('API key')) {
      console.log('\n🚨 DIAGNOSIS: API Key Issue');
      console.log('The Gemini API key is invalid or missing.');
    } else if (error.message.includes('quota')) {
      console.log('\n🚨 DIAGNOSIS: Quota Issue');
      console.log('The Gemini API quota has been exceeded.');
    } else if (error.message.includes('model')) {
      console.log('\n🚨 DIAGNOSIS: Model Issue');
      console.log('The Gemini model may not be available or configured correctly.');
    }

    return false;
  }
}

async function main() {
  console.log('🚀 Starting Gemini AI Model Verification Test\n');

  const result = await testGeminiModel();

  console.log('\n' + '='.repeat(50));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(50));
  console.log(`Gemini AI Model: ${result ? '✅ WORKING' : '❌ FAILED'}`);

  if (result) {
    console.log('\n✅ The AI model is working correctly!');
    console.log('If chemical queries still fail, the issue is likely:');
    console.log('  1. RAG embedding API key (different from chat API key)');
    console.log('  2. Vector database search issues');
    console.log('  3. RAG context not being properly added to responses');
  } else {
    console.log('\n❌ The AI model itself is not working!');
    console.log('This would explain why both normal and chemical queries fail.');
  }

  console.log('\n🏁 Test completed!');
}

main().catch(console.error);