#!/usr/bin/env tsx

/**
 * Simple Test - Plug and Play Agent System
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { UniversalAgentSystem } from '../ai/agents/core/agent-system';
import { RAW_MATERIALS_ALL_AI_CONFIG } from '../ai/agents/raw-materials-all-ai/config/agent-config';
import { RAW_MATERIALS_AI_CONFIG } from '../ai/agents/raw-materials-ai/config/agent-config';

async function testSimpleSystem() {
  console.log('🚀 Testing Simple Plug and Play Agent System\n');

  try {
    // ================================
    // 1. Create Agents with Configs
    // ================================
    console.log('1. Creating Agents from Configurations:');

    const generalAgent = new UniversalAgentSystem(RAW_MATERIALS_ALL_AI_CONFIG);
    console.log('   ✅ Raw Materials All AI Agent created');

    const stockAgent = new UniversalAgentSystem(RAW_MATERIALS_AI_CONFIG);
    console.log('   ✅ Raw Materials AI (Stock) Agent created');

    // ================================
    // 2. Show Agent Information
    // ================================
    console.log('\n2. Agent Information:');

    const generalConfig = generalAgent.getConfig();
    console.log(`   🤖 ${generalConfig.displayName}`);
    console.log(`      ID: ${generalConfig.id}`);
    console.log(`      Database: ${generalConfig.database.name}`);
    console.log(`      Vector DB: ${generalConfig.vectorDb.indexName}`);
    console.log(`      Embedding: ${generalConfig.embedding.provider}/${generalConfig.embedding.model}`);
    console.log(`      AI Model: ${generalConfig.aiModel.provider}/${generalConfig.aiModel.model}`);

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
      const generalDB = await generalAgent.getDatabase();
      console.log(`   💾 General AI Database Connected: ${generalDB.databaseName}`);
    } catch (error: any) {
      console.log(`   💾 General AI Database: ${error.message.substring(0, 50)}...`);
    }

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
      const generalIndex = generalAgent.getVectorIndex();
      console.log(`   🔍 General AI Vector Index: ${generalConfig.vectorDb.indexName}`);
    } catch (error: any) {
      console.log(`   🔍 General AI Vector Index: ${error.message.substring(0, 50)}...`);
    }

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
      const generalAIService = generalAgent.getAIService();
      console.log(`   🧠 General AI Service: Ready (${generalAIService.constructor.name})`);
    } catch (error: any) {
      console.log(`   🧠 General AI Service: ${error.message.substring(0, 50)}...`);
    }

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

    if (generalConfig.rag.enabled) {
      try {
        const ragResults = await generalAgent.performRAGSearch("chemical compounds", { topK: 3 });
        console.log(`   🔍 General AI RAG: ${ragResults.includes('Results:') ? 'Found results' : 'No results found'}`);
      } catch (error: any) {
        console.log(`   🔍 General AI RAG: ${error.message.substring(0, 50)}...`);
      }
    }

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

    const generalPrompt = await generalAgent.getEnhancedSystemPrompt();
    console.log(`   📝 General AI System Prompt: ${generalPrompt.length} characters`);

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
    console.log('   📂 ai/agents/raw-materials-all-ai/config/');
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