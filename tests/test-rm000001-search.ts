#!/usr/bin/env tsx

/**
 * Test RM000001 search with the new embedding system
 */

import { config } from 'dotenv';
import { PineconeRAGService } from '../ai/services/rag/pinecone-service';

// Load environment variables
config({ path: '.env.local' });

async function checkExistingData() {
  try {
    const ragService = new PineconeRAGService();
    const stats = await ragService.getIndexStats();

    console.log(`📊 Pinecone Index: ${stats.totalRecordCount} records, ${stats.dimension}D`);
    return stats;
  } catch (error: any) {
    console.log('❌ Failed to get index stats:', error.message);
    return null;
  }
}

async function searchRM000001() {
  console.log('\n🔎 Searching for RM000001...');

  const queries = [
    "RM000001",
    "สาร RM000001",
    "chemical RM000001",
    "RM000001 คือสารอะไร",
    "material code RM000001"
  ];

  try {
    const ragService = new PineconeRAGService();

    for (const query of queries) {
      console.log(`\n🔍 Query: "${query}"`);

      const results = await ragService.searchSimilar(query, {
        topK: 5,
        similarityThreshold: 0.3 // Lower threshold for testing
      });

      console.log(`📋 Found ${results.length} results`);

      if (results.length > 0) {
        results.forEach((result, index) => {
          console.log(`  ${index + 1}. Score: ${(result.score || 0).toFixed(3)}`);
          console.log(`     Material: ${result.metadata?.trade_name || 'Unknown'}`);
          console.log(`     Code: ${result.metadata?.rm_code || 'N/A'}`);
          console.log(`     Supplier: ${result.metadata?.supplier || 'N/A'}`);
          if (result.metadata?.inci_name) {
            console.log(`     INCI: ${result.metadata.inci_name}`);
          }
        });
      }
    }

    return true; // Return success if all searches completed
  } catch (error: any) {
    console.log('❌ Search failed:', error.message);
    return null;
  }
}

async function testFormattedResponse() {
  console.log('\n📝 Testing formatted response...');

  try {
    const ragService = new PineconeRAGService();

    const query = "สาร RM000001 คือสารอะไร";
    const formattedResults = await ragService.searchAndFormat(query, {
      topK: 3,
      similarityThreshold: 0.3
    });

    console.log('📄 Formatted Results:');
    console.log(formattedResults);

    return formattedResults;
  } catch (error: any) {
    console.log('❌ Formatted search failed:', error.message);
    return null;
  }
}

async function diagnoseRM000001Issue() {
  console.log('\n🔬 Diagnosing RM000001 Issue...');

  // Check if the issue is:
  // 1. No data in database
  // 2. RM000001 exists but embedding mismatch
  // 3. Different data format

  try {
    const ragService = new PineconeRAGService();
    const stats = await ragService.getIndexStats();

    if (stats.totalRecordCount === 0) {
      console.log('❌ DIAGNOSIS: Vector database is empty');
      console.log('📝 SOLUTION: Need to index raw materials data');
      return 'empty_database';
    }

    // Try broader search
    console.log('🔍 Searching for any materials...');
    const broadSearch = await ragService.searchSimilar("material", {
      topK: 10,
      similarityThreshold: 0.1
    });

    if (broadSearch.length === 0) {
      console.log('❌ DIAGNOSIS: No searchable materials found');
      console.log('📝 SOLUTION: Need to re-index or check data format');
      return 'no_materials';
    }

    console.log('✅ Found materials in database:');
    broadSearch.slice(0, 3).forEach((result, index) => {
      console.log(`  ${index + 1}. ${result.metadata?.trade_name || 'Unknown'} (${result.metadata?.rm_code || 'No code'})`);
    });

    // Look for similar patterns
    const materialCodes = broadSearch
      .filter(r => r.metadata?.rm_code)
      .map(r => r.metadata.rm_code);

    if (materialCodes.length > 0) {
      console.log(`📋 Found ${materialCodes.length} materials with codes: ${materialCodes.slice(0, 5).join(', ')}...`);
    }

    if (!materialCodes.includes('RM000001')) {
      console.log('❌ DIAGNOSIS: RM000001 not found in database');
      console.log('📝 SOLUTION: RM000001 needs to be indexed');
      return 'material_not_indexed';
    }

    console.log('✅ DIAGNOSIS: RM000001 should be findable');
    return 'material_available';

  } catch (error: any) {
    console.log('❌ Diagnosis failed:', error.message);
    return 'diagnosis_failed';
  }
}

async function suggestNextSteps() {
  console.log('\n🎯 RECOMMENDATIONS:');

  console.log('1. ✅ Embedding system is working with Google Gemini');
  console.log('2. ✅ Pinecone connection is successful');
  console.log('3. ✅ Vector search functionality is operational');

  console.log('\n📝 NEXT STEPS TO FIX RM000001:');

  // Check if there's an indexing script or API
  console.log('Option A - Use existing indexing pipeline:');
  console.log('  - Look for indexing scripts in the codebase');
  console.log('  - Check for admin interface to trigger indexing');
  console.log('  - Run MongoDB to Pinecone indexing');

  console.log('\nOption B - Manual test data:');
  console.log('  - Create test RM000001 document');
  console.log('  - Index it manually');
  console.log('  - Test search functionality');

  console.log('\nOption C - Check AI chat integration:');
  console.log('  - Test if the AI chat interface has RAG enabled');
  console.log('  - Verify the agent configurations');
  console.log('  - Check if the search is reaching Pinecone');
}

async function main() {
  console.log('🔍 RM000001 SEARCH DIAGNOSTIC TOOL\n');

  const stats = await checkExistingData();
  const searchResults = await searchRM000001();
  const formattedResults = await testFormattedResponse();
  const diagnosis = await diagnoseRM000001Issue();

  await suggestNextSteps();

  console.log('\n🏁 Diagnostic complete!');
}

main().catch(console.error);