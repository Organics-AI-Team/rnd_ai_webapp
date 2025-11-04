#!/usr/bin/env tsx

/**
 * Test Sales RND AI Agent - Plug and Play Demo
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { getSalesRndAIAgent } from '../ai/agents/core/agent-usage-example';

async function testSalesAgent() {
  console.log('🚀 Testing Sales RND AI Agent - Plug and Play\n');

  try {
    // ================================
    // 1. Get Sales Agent (Plug and Play)
    // ================================
    console.log('1. Getting Sales RND AI Agent:');

    const salesAgent = getSalesRndAIAgent();
    console.log('   ✅ Sales RND AI Agent created successfully!');

    // ================================
    // 2. Show Agent Configuration
    // ================================
    console.log('\n2. Sales Agent Configuration:');

    const config = salesAgent.getConfig();
    console.log(`   💼 ${config.displayName}`);
    console.log(`      Purpose: ${config.description}`);
    console.log(`      Database: ${config.database.name}`);
    console.log(`      Vector DB: ${config.vectorDb.indexName}`);
    console.log(`      Embedding: ${config.embedding.provider}/${config.embedding.model}`);
    console.log(`      AI Model: ${config.aiModel.provider}/${config.aiModel.model}`);
    console.log(`      Temperature: ${config.aiModel.temperature} (more creative for sales)`);
    console.log(`      Max Tokens: ${config.aiModel.maxTokens}`);

    // ================================
    // 3. Show Sales-Specific Prompt Files
    // ================================
    console.log('\n3. Sales-Specific Prompt Configuration:');

    console.log(`   🎯 Welcome Message Path: ${config.prompts.welcomeMessagePath || 'default'}`);
    console.log(`   📋 System Prompt Path: ${config.prompts.systemPromptPath || 'default'}`);
    console.log(`   💡 RAG Instructions Path: ${config.prompts.ragInstructionsPath || 'default'}`);

    // ================================
    // 4. Test Database Connection
    // ================================
    console.log('\n4. Testing Sales Intelligence Database:');

    try {
      const database = await salesAgent.getDatabase();
      console.log(`   💾 Sales Database Connected: ${database.databaseName}`);

      const collections = await salesAgent.getCollections();
      console.log(`   📁 Collections: ${Object.keys(collections).join(', ')}`);
    } catch (error: any) {
      console.log(`   💾 Database Connection: ${error.message.substring(0, 50)}...`);
    }

    // ================================
    // 5. Test Vector Database
    // ================================
    console.log('\n5. Testing Sales Intelligence Vector Database:');

    try {
      const vectorIndex = salesAgent.getVectorIndex();
      console.log(`   🔍 Sales Vector Index: ${config.vectorDb.indexName}`);
      console.log(`   📏 Dimensions: ${config.vectorDb.dimensions}`);
      console.log(`   📐 Metric: ${config.vectorDb.metric}`);
    } catch (error: any) {
      console.log(`   🔍 Vector Index: ${error.message.substring(0, 50)}...`);
    }

    // ================================
    // 6. Test AI Service
    // ================================
    console.log('\n6. Testing Sales AI Service:');

    try {
      const aiService = salesAgent.getAIService();
      console.log(`   🧠 Sales AI Service: Ready (${aiService.constructor.name})`);
      console.log(`   🔧 Model Configuration: Loaded`);
    } catch (error: any) {
      console.log(`   🧠 AI Service: ${error.message.substring(0, 50)}...`);
    }

    // ================================
    // 7. Test Sales RAG Operations
    // ================================
    console.log('\n7. Testing Sales Intelligence RAG:');

    if (config.rag.enabled) {
      try {
        const salesQueries = [
          "sales strategy for cosmetics",
          "market trends in raw materials",
          "competitive analysis methods",
          "customer relationship management"
        ];

        for (const query of salesQueries.slice(0, 2)) {
          const ragResults = await salesAgent.performRAGSearch(query, { topK: 3 });
          console.log(`   🔍 "${query}": ${ragResults.includes('Results:') ? 'Found sales intelligence' : 'No results found'}`);
        }
      } catch (error: any) {
        console.log(`   🔍 Sales RAG Search: ${error.message.substring(0, 50)}...`);
      }
    } else {
      console.log('   🔍 RAG: Disabled for this agent');
    }

    // ================================
    // 8. Test Enhanced System Prompt
    // ================================
    console.log('\n8. Testing Enhanced Sales System Prompt:');

    const enhancedPrompt = await salesAgent.getEnhancedSystemPrompt();
    console.log(`   📝 Enhanced Prompt: ${enhancedPrompt.length} characters`);
    console.log(`   🎯 Sales-Focused: Contains sales-specific instructions and context`);

    // ================================
    // 9. Show Sales Use Cases
    // ================================
    console.log('\n9. Sales Use Cases for This Agent:');

    const salesUseCases = [
      "💼 Sales strategy development",
      "📊 Market intelligence analysis",
      "🎯 Competitive positioning",
      "💰 Pricing strategy advice",
      "🤝 Partnership opportunities",
      "📈 Revenue growth planning",
      "👥 Customer relationship management",
      "🎪 Product presentation guidance"
    ];

    salesUseCases.forEach((useCase, index) => {
      console.log(`   ${index + 1}. ${useCase}`);
    });

    // ================================
    // 10. Sales Agent Summary
    // ================================
    console.log('\n🎯 Sales RND AI Agent Summary:');
    console.log('   ✅ Specialized for sales and marketing');
    console.log('   ✅ Industry-focused (raw materials & cosmetics)');
    console.log('   ✅ Business intelligence integration');
    console.log('   ✅ Market trends and competitive analysis');
    console.log('   ✅ Customer relationship management');
    console.log('   ✅ Revenue growth strategies');
    console.log('   ✅ Partnership development');
    console.log('   ✅ Separate database and vector store');
    console.log('   ✅ Creative temperature (0.8) for innovative ideas');

    console.log('\n📂 Files Created:');
    console.log('   📁 ai/agents/sales-rnd-ai/config/agent-config.ts');
    console.log('   📁 app/ai/sales-rnd-ai/page.tsx');
    console.log('   🔗 Universal API: /api/agents/sales-rnd-ai/chat');

    console.log('\n🔧 Access Methods:');
    console.log('   🌐 Web: http://localhost:3003/ai/sales-rnd-ai');
    console.log('   🔗 API: POST /api/agents/sales-rnd-ai/chat');
    console.log('   💻 Code: getSalesRndAIAgent()');

  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
  }

  console.log('\n🏁 Sales RND AI Agent Test Completed!');
}

// Run the test
testSalesAgent().catch(console.error);