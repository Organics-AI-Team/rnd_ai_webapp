#!/usr/bin/env tsx

/**
 * Test script to verify both AI agents are working with RAG architecture
 */

import { config } from 'dotenv';
import { AgentManager } from '../ai/agents/agent-manager';
import { GeminiService } from '../ai/services/providers/gemini-service';
import { createEmbeddingService } from '../ai/services/embeddings/universal-embedding-service';
import { getEnabledAgentConfigs } from '../ai/agents/configs/agent-configs';

// Load environment variables
config({ path: '.env.local' });

console.log('🤖 AGENT ARCHITECTURE VERIFICATION\n');

// Debug environment variables
console.log('🔧 Environment Variables:');
console.log(`GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? '✅ Set' : '❌ Missing'}`);
console.log(`OPENAI_API_KEY: ${process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here' ? '✅ Set' : '❌ Missing/Invalid'}`);

async function testAgentConfigurations() {
  console.log('\n📋 Checking Agent Configurations...');

  try {
    const agents = getEnabledAgentConfigs();
    console.log(`✅ Found ${agents.length} enabled agents`);

    const providers = new Set();
    const categories = new Set();

    agents.forEach(agent => {
      console.log(`\n🤖 ${agent.name} (${agent.id})`);
      console.log(`   Provider: ${agent.provider}`);
      console.log(`   Category: ${agent.category}`);
      console.log(`   RAG Indices: ${agent.ragIndexIds.join(', ')}`);
      console.log(`   Capabilities: ${agent.capabilities.slice(0, 3).join(', ')}...`);

      providers.add(agent.provider);
      categories.add(agent.category);
    });

    console.log(`\n📊 Architecture Summary:`);
    console.log(`   AI Providers: ${Array.from(providers).join(', ')}`);
    console.log(`   Categories: ${Array.from(categories).join(', ')}`);

    // Identify the two main AI systems
    const geminiAgents = agents.filter(a => a.provider === 'gemini');
    const openaiAgents = agents.filter(a => a.provider === 'openai');

    console.log(`\n🎯 Main AI Systems:`);
    console.log(`   Google Gemini: ${geminiAgents.length} agents`);
    console.log(`   OpenAI: ${openaiAgents.length} agents`);

    return { agents, geminiAgents, openaiAgents };
  } catch (error: any) {
    console.log('❌ Failed to load agent configurations:', error.message);
    return null;
  }
}

async function testEmbeddingServiceForAgents() {
  console.log('\n🧠 Testing Embedding Service for Agents...');

  try {
    const embeddingService = createEmbeddingService();
    console.log(`✅ Embedding service initialized with ${embeddingService.getProvider()}`);

    // Test with RM000001 query (agent use case)
    const testQuery = "What is RM000001 and what are its benefits for cosmetic formulations?";
    const embedding = await embeddingService.createEmbedding(testQuery);

    console.log(`✅ Generated ${embedding.length}-dimensional embedding for agent query`);
    console.log(`🎯 Sample values: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);

    return embeddingService;
  } catch (error: any) {
    console.log('❌ Embedding service test failed:', error.message);
    return null;
  }
}

async function testRAGIntegration() {
  console.log('\n🔗 Testing RAG Integration...');

  try {
    const embeddingService = createEmbeddingService();
    const ragService = new (await import('../ai/services/rag/pinecone-service')).PineconeRAGService('rawMaterialsAllAI', {}, embeddingService);

    // Test queries that agents would typically handle
    const agentQueries = [
      {
        agent: 'Raw Materials Specialist',
        query: 'Tell me about RM000001 and its cosmetic applications'
      },
      {
        agent: 'Formulation Advisor',
        query: 'How can I use RM000001 in a moisturizing cream?'
      },
      {
        agent: 'Regulatory Expert',
        query: 'What are the safety considerations for RM000001?'
      }
    ];

    for (const { agent, query } of agentQueries) {
      console.log(`\n🤖 ${agent} Query: "${query}"`);

      const results = await ragService.searchSimilar(query, {
        topK: 3,
        similarityThreshold: 0.3
      });

      console.log(`📋 Found ${results.length} relevant documents`);

      if (results.length > 0) {
        results.forEach((result, index) => {
          console.log(`  ${index + 1}. ${result.metadata?.trade_name || result.metadata?.rm_code} (Score: ${(result.score || 0).toFixed(3)})`);
        });
      }
    }

    return true;
  } catch (error: any) {
    console.log('❌ RAG integration test failed:', error.message);
    return false;
  }
}

async function testAgentManager() {
  console.log('\n👥 Testing Agent Manager...');

  try {
    // Create AI services
    const geminiService = new GeminiService(process.env.GEMINI_API_KEY!);

    // Create agent manager
    const agentManager = new (await import('../ai/agents/agent-manager')).AgentManager(geminiService as any);

    console.log('✅ Agent manager initialized with Gemini service');

    // Get available agents
    const availableAgents = agentManager.getAvailableAgents();
    console.log(`✅ Found ${availableAgents.length} available agents`);

    // Test a specific agent execution
    console.log('\n🎯 Testing Raw Materials Specialist Agent...');

    try {
      const result = await agentManager.executeAgent({
        agentId: 'raw-materials-specialist',
        userId: 'test-user',
        request: 'สาร RM000001 คือสารอะไร และมีประโยชน์อย่างไรสำหรับเครื่องสำอาง',
        options: {
          forceRAG: true,
          ragOptions: {
            topK: 5,
            similarityThreshold: 0.3
          }
        }
      });

      console.log('✅ Agent execution successful!');
      console.log(`📊 Execution time: ${result.executionTime}ms`);
      console.log(`🧠 Model used: ${result.response.model}`);
      console.log(`📝 Response preview: ${result.response.response.substring(0, 200)}...`);
      console.log(`🔗 RAG sources: ${result.ragResults?.sources.length || 0}`);

      return result;
    } catch (agentError: any) {
      console.log('⚠️  Agent execution failed:', agentError.message);
      console.log('   This might be due to missing dependencies or configuration issues');
      return null;
    }

  } catch (error: any) {
    console.log('❌ Agent manager test failed:', error.message);
    return null;
  }
}

async function testDirectAgentServices() {
  console.log('\n🔄 Testing Direct AI Services...');

  const results = [];

  // Test Google Gemini
  try {
    const geminiService = new GeminiService(process.env.GEMINI_API_KEY!);

    const geminiResponse = await geminiService.generateResponse({
      prompt: 'สาร RM000001 คือสารอะไร กรุณาอธิบายโดยละเอียด',
      userId: 'test-user',
      context: {
        category: 'raw-materials'
      }
    });

    console.log('✅ Google Gemini Service Working');
    console.log(`📝 Response: ${geminiResponse.response.substring(0, 200)}...`);
    console.log(`🧊 Model: ${geminiResponse.model}`);
    console.log(`⚡ Latency: ${geminiResponse.metadata?.latency || 'N/A'}ms`);

    results.push({ provider: 'gemini', status: 'working', response: geminiResponse });
  } catch (error: any) {
    console.log('❌ Google Gemini Service Failed:', error.message);
    results.push({ provider: 'gemini', status: 'failed', error: error.message });
  }

  // Test OpenAI (if API key is valid)
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here') {
    try {
      const openaiService = new (await import('../ai/services/providers/openai-service')).OpenAIService(process.env.OPENAI_API_KEY);

      const openaiResponse = await openaiService.generateResponse({
        prompt: 'What is RM000001 and its cosmetic applications?',
        userId: 'test-user',
        context: {
          category: 'raw-materials'
        }
      });

      console.log('✅ OpenAI Service Working');
      console.log(`📝 Response: ${openaiResponse.response.substring(0, 200)}...`);
      console.log(`🧊 Model: ${openaiResponse.model}`);

      results.push({ provider: 'openai', status: 'working', response: openaiResponse });
    } catch (error: any) {
      console.log('❌ OpenAI Service Failed:', error.message);
      results.push({ provider: 'openai', status: 'failed', error: error.message });
    }
  } else {
    console.log('⚠️  OpenAI API key not configured - skipping OpenAI test');
    results.push({ provider: 'openai', status: 'skipped', reason: 'API key not configured' });
  }

  return results;
}

async function generateArchitectureReport() {
  console.log('\n' + '='.repeat(70));
  console.log('🏗️  COMPLETE AI ARCHITECTURE REPORT');
  console.log('='.repeat(70));

  const agentConfig = await testAgentConfigurations();
  const embeddingService = await testEmbeddingServiceForAgents();
  const ragIntegration = await testRAGIntegration();
  const agentManager = await testAgentManager();
  const directServices = await testDirectAgentServices();

  console.log('\n📊 ARCHITECTURE STATUS:');
  console.log(`🤖 Agent Configurations: ${agentConfig ? '✅ WORKING' : '❌ BROKEN'}`);
  console.log(`🧠 Embedding Service: ${embeddingService ? '✅ WORKING' : '❌ BROKEN'}`);
  console.log(`🔗 RAG Integration: ${ragIntegration ? '✅ WORKING' : '❌ BROKEN'}`);
  console.log(`👥 Agent Manager: ${agentManager ? '✅ WORKING' : '⚠️  PARTIAL'}`);
  console.log(`🔄 Direct AI Services: ${directServices?.filter(s => s.status === 'working').length || 0} working`);

  const workingServices = directServices?.filter(s => s.status === 'working') || [];
  console.log(`\n🎯 ACTIVE AI PROVIDERS:`);
  workingServices.forEach(service => {
    console.log(`   ✅ ${service.provider.toUpperCase()}: ${service.response.model}`);
  });

  if (agentConfig) {
    console.log(`\n🤖 ENABLED AGENTS (${agentConfig.agents.length}):`);
    agentConfig.agents.forEach(agent => {
      const ragStatus = agent.ragIndexIds.length > 0 ? '🔗' : '📄';
      console.log(`   ${ragStatus} ${agent.name} (${agent.provider})`);
    });
  }

  console.log('\n🔍 RM000001 ARCHITECTURE FLOW:');
  console.log('1. User Query (Thai/English)');
  console.log('2. Agent Selection (Raw Materials Specialist)');
  console.log('3. RAG Search (Pinecone + Gemini Embeddings)');
  console.log('4. Context Enhancement');
  console.log('5. AI Response Generation (Gemini/OpenAI)');
  console.log('6. Knowledge-Enhanced Answer');

  console.log('\n🏁 Architecture verification complete!');
}

async function main() {
  await generateArchitectureReport();
}

main().catch(console.error);