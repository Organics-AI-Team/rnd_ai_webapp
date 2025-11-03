#!/usr/bin/env tsx

/**
 * Test script to verify the new centralized RAG configuration
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import {
  getRAGConfig,
  getRAGServiceNames,
  validateRAGConfig,
  validateEnvironment,
  RAG_CONFIG
} from '../ai/config/rag-config';

async function testRAGConfiguration() {
  console.log('🔧 Testing RAG Configuration...\n');

  // Test environment validation
  console.log('1. Environment Validation:');
  const envValidation = validateEnvironment();
  if (envValidation.isValid) {
    console.log('✅ Environment variables are valid');
  } else {
    console.log('❌ Missing environment variables:', envValidation.missing);
  }

  // Test service names
  console.log('\n2. Available Services:');
  const serviceNames = getRAGServiceNames();
  console.log('📋 Services:', serviceNames);

  // Test each service configuration
  console.log('\n3. Service Configurations:');
  for (const serviceName of serviceNames) {
    const config = getRAGConfig(serviceName);
    const isValid = validateRAGConfig(config);

    console.log(`\n🤖 Service: ${serviceName}`);
    console.log(`   Index: ${config.pineconeIndex}`);
    console.log(`   TopK: ${config.topK}`);
    console.log(`   Similarity Threshold: ${config.similarityThreshold}`);
    console.log(`   Description: ${config.description}`);
    console.log(`   Valid: ${isValid ? '✅' : '❌'}`);
  }

  // Test service instantiation
  console.log('\n4. Service Instantiation Test:');
  try {
    const { PineconeRAGService } = await import('../ai/services/rag/pinecone-service');

    console.log('   Testing Raw Materials All AI Service...');
    const generalService = new PineconeRAGService('rawMaterialsAllAI');
    console.log('   ✅ Raw Materials All AI service created');

    console.log('   Testing Raw Materials AI Service...');
    const rawMaterialsService = new PineconeRAGService('rawMaterialsAI');
    console.log('   ✅ Raw Materials AI service created');

  } catch (error: any) {
    console.log('   ❌ Service creation failed:', error.message);
  }

  console.log('\n🎯 Configuration Summary:');
  console.log('   - Raw Materials All AI uses index:', RAG_CONFIG.rawMaterialsAllAI.pineconeIndex);
  console.log('   - Raw Materials AI uses index:', RAG_CONFIG.rawMaterialsAI.pineconeIndex);
  console.log('   - Both share same MongoDB database');
  console.log('   - Each has specialized vector database');
}

async function main() {
  console.log('🚀 Starting RAG Configuration Test\n');

  await testRAGConfiguration();

  console.log('\n🏁 Configuration test completed!');
}

main().catch(console.error);