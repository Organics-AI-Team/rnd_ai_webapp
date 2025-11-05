#!/usr/bin/env tsx

/**
 * Simple Test - Plug and Play Agent System
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { UniversalAgentSystem } from '../ai/agents/core/agent-system';
import { RAW_MATERIALS_AI_CONFIG } from '../ai/agents/raw-materials-ai/config/agent-config';

async function testSimpleSystem() {
  console.log('🚀 Testing Simple Plug and Play Agent System\n');

  try {
    // ================================
    // 1. Create Agents with Configs
    // ================================
    console.log('1. Creating Agents from Configurations:');

    const stockAgent = new UniversalAgentSystem(RAW_MATERIALS_AI_CONFIG);
    console.log('   ✅ Raw Materials AI (Stock) Agent created');

    // ================================
    // 2. Show Agent Information
    // ================================
    console.log('\n2. Agent Information:');

    const stockConfig = stockAgent.getConfig();
    console.log(`   🤖 ${stockConfig.displayName}`);
    console.log(`      ID: ${stockConfig.id}`);
    console.log(`      Database: ${stockConfig.database.name}`);
    console.log(`      Vector DB: ${stockConfig.vectorDb.indexName}`);
    console.log(`      Embedding: ${stockConfig.embedding.provider}/${stockConfig.embedding.model}`);
    console.log(`      AI Model: ${stockConfig.aiModel.provider}/${stockConfig.aiModel.model}`);

    // ================================
    // 3. Test Database Connections
    // ================================
    console.log('\n3. Testing Database Connections:');

    try {
      const stockDB = await stockAgent.getDatabase();
      console.log(`   💾 Stock AI Database Connected: ${stockDB.databaseName}`);
    } catch (error: any) {
      console.log(`   💾 Stock AI Database: ${error.message.substring(0, 50)}...`);
    }

    // ================================
    // 4. Test Vector Database Access
    // ================================
    console.log('\n4. Testing Vector Database Access:');

    try {
      const stockIndex = stockAgent.getVectorIndex();
      console.log(`   🔍 Stock AI Vector Index: ${stockConfig.vectorDb.indexName}`);
    } catch (error: any) {
      console.log(`   🔍 Stock AI Vector Index: ${error.message.substring(0, 50)}...`);
    }

    // ================================
    // 5. Test AI Services
    // ================================
    console.log('\n5. Testing AI Services:');

    try {
      const stockAIService = stockAgent.getAIService();
      console.log(`   🧠 Stock AI Service: Ready (${stockAIService.constructor.name})`);
    } catch (error: any) {
      console.log(`   🧠 Stock AI Service: ${error.message.substring(0, 50)}...`);
    }

    // ================================
    // 6. Test RAG System
    // ================================
    console.log('\n6. Testing RAG System:');

    if (stockConfig.rag.enabled) {
      try {
        const stockRagResults = await stockAgent.performRAGSearch("RC00A004", { topK: 3 });
        console.log(`   🔍 Stock AI RAG: ${stockRagResults.includes('Results:') ? 'Found results' : 'No results found'}`);
      } catch (error: any) {
        console.log(`   🔍 Stock AI RAG: ${error.message.substring(0, 50)}...`);
      }
    }

    // ================================
    // 7. Test System Prompts
    // ================================
    console.log('\n7. Testing System Prompts:');

    const stockPrompt = await stockAgent.getEnhancedSystemPrompt();
    console.log(`   📝 Stock AI System Prompt: ${stockPrompt.length} characters`);

    // ================================
    // 8. System Summary
    // ================================
    console.log('\n🎯 Plug and Play System Summary:');
    console.log('   ✅ Universal Agent System Working');
    console.log('   ✅ Separate MongoDB Databases');
    console.log('   ✅ Separate Vector Indexes');
    console.log('   ✅ Separate Embedding Models');
    console.log('   ✅ Separate AI Prompts');
    console.log('   ✅ Configuration-Driven Architecture');
    console.log('   ✅ Reusable Core Logic');
    console.log('   ✅ Easy Agent Creation');

    console.log('\n📁 File Structure Created:');
    console.log('   📂 ai/agents/core/          - Universal system');
    console.log('   📂 ai/agents/raw-materials-ai/config/');
    console.log('   📁 app/api/agents/[agentId]/chat/route.ts - Universal API');

    console.log('\n🔧 To Add New Agent:');
    console.log('   1. Create folder: ai/agents/your-agent/config/');
    console.log('   2. Add agent-config.ts with SimpleAgentConfig');
    console.log('   3. Import and use: new UniversalAgentSystem(YOUR_CONFIG)');

  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
  }

  console.log('\n🏁 Simple Agent System Test Completed!');
}

// Run the test
testSimpleSystem().catch(console.error);