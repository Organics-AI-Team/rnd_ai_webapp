#!/usr/bin/env tsx

/**
 * Test script to verify RAG vector database and embedding functionality
 */

import { config } from 'dotenv';
import { PineconeRAGService } from './ai/services/rag/pinecone-service';

// Load environment variables
config({ path: '.env.local' });

// Debug environment variables
console.log('🔧 Environment Variables:');
console.log(`PINECONE_API_KEY: ${process.env.PINECONE_API_KEY ? '✅ Set' : '❌ Missing'}`);
console.log(`OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Missing'}`);
console.log(`PINECONE_INDEX: ${process.env.PINECONE_INDEX}`);

async function testPineconeConnection() {
  console.log('🔍 Testing Pinecone connection...');

  try {
    const service = new PineconeRAGService();
    const stats = await service.getIndexStats();

    console.log('✅ Pinecone connection successful!');
    console.log('📊 Index Stats:', JSON.stringify(stats, null, 2));

    return stats;
  } catch (error: any) {
    console.log('❌ Pinecone connection failed:', error.message);
    return null;
  }
}

async function testEmbeddings() {
  console.log('\n🧠 Testing embedding generation...');

  try {
    const service = new PineconeRAGService();
    const testTexts = [
      "RM000001 is a cosmetic raw material",
      "สาร RM000001 คือสารเคมีสำหรับเครื่องสำอาง",
      "This is a test document for embeddings"
    ];

    const embeddings = await service.createEmbeddings(testTexts);

    console.log('✅ Embeddings generated successfully!');
    console.log(`📏 Generated ${embeddings.length} embeddings`);
    console.log(`🔢 Each embedding has ${embeddings[0].length} dimensions`);

    return embeddings;
  } catch (error: any) {
    console.log('❌ Embedding generation failed:', error.message);
    return null;
  }
}

async function testVectorSearch() {
  console.log('\n🔎 Testing vector search...');

  try {
    const service = new PineconeRAGService();

    // Test search for RM000001
    const query = "RM000001 สารเคมี";
    const results = await service.searchSimilar(query, {
      topK: 5,
      similarityThreshold: 0.5
    });

    console.log('✅ Vector search completed!');
    console.log(`📋 Found ${results.length} results`);

    if (results.length > 0) {
      console.log('\n📄 Search Results:');
      results.forEach((result, index) => {
        console.log(`${index + 1}. Score: ${(result.score || 0).toFixed(3)}`);
        console.log(`   Material: ${result.metadata?.trade_name || result.metadata?.rm_code || 'Unknown'}`);
        console.log(`   Code: ${result.metadata?.rm_code || 'N/A'}`);
        console.log(`   Supplier: ${result.metadata?.supplier || 'N/A'}`);
      });
    } else {
      console.log('⚠️  No results found for RM000001');
    }

    return results;
  } catch (error: any) {
    console.log('❌ Vector search failed:', error.message);
    return null;
  }
}

async function testFormattedSearch() {
  console.log('\n📝 Testing formatted search...');

  try {
    const service = new PineconeRAGService();

    const query = "What is RM000001?";
    const formattedResults = await service.searchAndFormat(query, {
      topK: 3,
      similarityThreshold: 0.5
    });

    console.log('✅ Formatted search completed!');
    console.log('📄 Formatted Results:');
    console.log(formattedResults);

    return formattedResults;
  } catch (error: any) {
    console.log('❌ Formatted search failed:', error.message);
    return null;
  }
}

async function main() {
  console.log('🚀 Starting RAG System Verification Tests\n');

  // Test all components
  const connectionResult = await testPineconeConnection();
  const embeddingResult = await testEmbeddings();
  const searchResult = await testVectorSearch();
  const formattedResult = await testFormattedSearch();

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(50));
  console.log(`Pinecone Connection: ${connectionResult ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Embedding Generation: ${embeddingResult ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Vector Search: ${searchResult !== null ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Formatted Search: ${formattedResult ? '✅ PASS' : '❌ FAIL'}`);

  // Diagnose RM000001 issue
  if (searchResult && searchResult.length === 0) {
    console.log('\n⚠️  DIAGNOSIS: RM000001 not found in vector database');
    console.log('Possible causes:');
    console.log('  1. RM000001 data has not been indexed yet');
    console.log('  2. The material code is stored differently in the database');
    console.log('  3. Similarity threshold is too high');
    console.log('  4. OpenAI API key may be invalid (affecting embeddings)');
  }

  console.log('\n🏁 Tests completed!');
}

main().catch(console.error);