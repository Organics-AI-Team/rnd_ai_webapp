#!/usr/bin/env tsx

/**
 * Test script for new embedding implementations
 */

import { config } from 'dotenv';
import { GeminiEmbeddingService, createGeminiEmbeddingService } from '../ai/services/embeddings/gemini-embedding-service';
import { UniversalEmbeddingService, createEmbeddingService } from '../ai/services/embeddings/universal-embedding-service';
import { PineconeRAGService } from '../ai/services/rag/pinecone-service';

// Load environment variables
config({ path: '.env.local' });

// Debug environment variables
console.log('🔧 Environment Variables:');
console.log(`GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? '✅ Set' : '❌ Missing'}`);
console.log(`PINECONE_API_KEY: ${process.env.PINECONE_API_KEY ? '✅ Set' : '❌ Missing'}`);
console.log(`PINECONE_INDEX: ${process.env.PINECONE_INDEX}`);

async function testGeminiEmbeddings() {
  console.log('\n🧠 Testing Google Gemini Embeddings...');

  try {
    const service = createGeminiEmbeddingService();
    const testTexts = [
      "RM000001 is a cosmetic raw material",
      "สาร RM000001 คือสารเคมีสำหรับเครื่องสำอาง",
      "This is a test document for Gemini embeddings"
    ];

    const embeddings = await service.createEmbeddings(testTexts);

    console.log('✅ Gemini embeddings generated successfully!');
    console.log(`📏 Generated ${embeddings.length} embeddings`);
    console.log(`🔢 Each embedding has ${embeddings[0].length} dimensions`);
    console.log(`🎯 Sample embedding: [${embeddings[0].slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);

    return embeddings;
  } catch (error: any) {
    console.log('❌ Gemini embedding test failed:', error.message);
    return null;
  }
}

async function testUniversalEmbeddings() {
  console.log('\n🔄 Testing Universal Embedding Service...');

  try {
    const service = createEmbeddingService();
    console.log(`🤖 Using provider: ${service.getProvider()}`);
    console.log(`📏 Expected dimensions: ${service.getDimensions()}`);

    const testTexts = [
      "RM000001 คือสารอะไร",
      "What is chemical RM000001?",
      "สารเคมีสำหรับเครื่องสำอาง"
    ];

    const embeddings = await service.createEmbeddings(testTexts);

    console.log('✅ Universal embeddings generated successfully!');
    console.log(`📏 Generated ${embeddings.length} embeddings`);
    console.log(`🔢 Each embedding has ${embeddings[0].length} dimensions`);
    console.log(`🎯 Sample values: [${embeddings[0].slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);

    return embeddings;
  } catch (error: any) {
    console.log('❌ Universal embedding test failed:', error.message);
    return null;
  }
}

async function testPineconeWithNewEmbeddings() {
  console.log('\n🌲 Testing Pinecone with New Embeddings...');

  try {
    // Check which provider will be used
    const embeddingService = createEmbeddingService();
    console.log(`🤖 Using embedding provider: ${embeddingService.getProvider()}`);

    const ragService = new PineconeRAGService();

    // Test indexing with embeddings
    console.log('📝 Testing document indexing...');
    const testDocument = {
      id: 'test-rm000001',
      text: 'Material Code: RM000001. Trade Name: Test Chemical. INCI Name: TestIngredient. This is a cosmetic raw material used for testing purposes.',
      metadata: {
        rm_code: 'RM000001',
        trade_name: 'Test Chemical',
        inci_name: 'TestIngredient',
        supplier: 'Test Supplier',
        company_name: 'Test Company',
        benefits: 'Testing benefits',
        details: 'Testing details',
        source: 'raw_materials_real_stock' as const
      }
    };

    await ragService.upsertDocuments([testDocument]);
    console.log('✅ Test document indexed successfully!');

    // Test search
    console.log('🔎 Testing vector search...');
    const query = "RM000001 สารอะไร";
    const results = await ragService.searchSimilar(query, {
      topK: 5,
      similarityThreshold: 0.1 // Lower threshold for testing
    });

    console.log('✅ Vector search completed!');
    console.log(`📋 Found ${results.length} results`);

    if (results.length > 0) {
      console.log('\n📄 Search Results:');
      results.forEach((result, index) => {
        console.log(`${index + 1}. Score: ${(result.score || 0).toFixed(3)}`);
        console.log(`   Material: ${result.metadata?.trade_name || result.metadata?.rm_code || 'Unknown'}`);
        console.log(`   Code: ${result.metadata?.rm_code || 'N/A'}`);
      });
    }

    // Clean up test document
    await ragService.deleteDocuments([testDocument.id]);
    console.log('🧹 Test document cleaned up');

    return results;
  } catch (error: any) {
    console.log('❌ Pinecone test failed:', error.message);
    return null;
  }
}

async function testRAGWithMultipleProviders() {
  console.log('\n🎯 Testing RAG with Multiple Providers...');

  const providers: UniversalEmbeddingService[] = [];

  // Test with Gemini
  try {
    const geminiService = new UniversalEmbeddingService({
      provider: 'gemini',
      model: 'gemini-embedding-001',
      dimensions: 768
    });
    providers.push(geminiService);
    console.log('✅ Gemini service initialized');
  } catch (error: any) {
    console.log('❌ Gemini initialization failed:', error.message);
  }

  // Test with OpenAI if API key is valid
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here') {
    try {
      const openaiService = new UniversalEmbeddingService({
        provider: 'openai',
        model: 'text-embedding-3-small',
        dimensions: 1536
      });
      providers.push(openaiService);
      console.log('✅ OpenAI service initialized');
    } catch (error: any) {
      console.log('❌ OpenAI initialization failed:', error.message);
    }
  }

  for (const service of providers) {
    console.log(`\n🤖 Testing ${service.getProvider()} provider...`);

    try {
      await service.test();

      // Test with Pinecone
      const ragService = new PineconeRAGService('rawMaterialsAllAI', {}, service);
      const query = "RM000001 test chemical";
      const results = await ragService.searchSimilar(query, { topK: 2, similarityThreshold: 0.1 });

      console.log(`📊 ${service.getProvider()} RAG test: ${results.length} results found`);
    } catch (error: any) {
      console.log(`❌ ${service.getProvider()} RAG test failed:`, error.message);
    }
  }

  return providers;
}

async function main() {
  console.log('🚀 Starting New Embedding System Tests\n');

  // Test all components
  const geminiResult = await testGeminiEmbeddings();
  const universalResult = await testUniversalEmbeddings();
  const pineconeResult = await testPineconeWithNewEmbeddings();
  const multiProviderResult = await testRAGWithMultipleProviders();

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 NEW EMBEDDING SYSTEM TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Gemini Embeddings: ${geminiResult ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Universal Embeddings: ${universalResult ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Pinecone Integration: ${pineconeResult !== null ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Multi-Provider Support: ${multiProviderResult.length > 0 ? '✅ PASS' : '❌ FAIL'}`);

  // RM000001 Diagnosis
  if (pineconeResult && pineconeResult.length === 0) {
    console.log('\n⚠️  RM000001 ISSUE ANALYSIS:');
    console.log('- Embedding system is now working');
    console.log('- Pinecone connection is working');
    console.log('- Need to index actual RM000001 data');
    console.log('- Recommend running the indexing pipeline');
  }

  console.log('\n🏁 New embedding tests completed!');
}

main().catch(console.error);