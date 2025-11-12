#!/usr/bin/env tsx

/**
 * Script to index raw materials data into Sales RND AI Pinecone index
 *
 * This script:
 * 1. Connects to MongoDB raw_materials_real_stock collection
 * 2. Fetches all materials
 * 3. Vectorizes them using Gemini embeddings
 * 4. Uploads to 'sales-rnd-ai' Pinecone index
 *
 * Note: Uses raw_materials_real_stock as it contains the actual data
 *
 * Usage: npm run index-sales-data
 */

import { config } from 'dotenv';
import { PineconeRAGService } from '../ai/services/rag/pinecone-service-stub';
import rawMaterialsClientPromise from '../lib/raw-materials-mongodb';

// Load environment variables
config({ path: '.env.local' });

/**
 * Log entry for a function with timestamp
 */
function logStart(functionName: string, ...args: any[]) {
  console.log(`\n🔵 [${new Date().toISOString()}] ${functionName}:`, ...args);
}

/**
 * Log success with timestamp
 */
function logSuccess(message: string, ...args: any[]) {
  console.log(`✅ [${new Date().toISOString()}] ${message}`, ...args);
}

/**
 * Log error with timestamp
 */
function logError(message: string, error?: any) {
  console.error(`❌ [${new Date().toISOString()}] ${message}`, error?.message || error);
}

/**
 * Check MongoDB connection and count documents
 */
async function checkMongoDBConnection() {
  logStart('checkMongoDBConnection', 'Checking MongoDB connection...');

  try {
    const client = await rawMaterialsClientPromise;
    const db = client.db();

    const count = await db.collection("raw_materials_real_stock").countDocuments();
    logSuccess(`MongoDB connected! Found ${count} materials in raw_materials_real_stock`);

    return { success: true, count };
  } catch (error: any) {
    logError('MongoDB connection failed', error);
    return { success: false, count: 0, error: error.message };
  }
}

/**
 * Fetch all materials from raw_materials_real_stock collection
 */
async function fetchMaterialsFromStock(limit?: number) {
  logStart('fetchMaterialsFromStock', `Fetching materials (limit: ${limit || 'none'})`);

  try {
    const client = await rawMaterialsClientPromise;
    const db = client.db();

    const query = limit
      ? db.collection("raw_materials_real_stock").find({}).limit(limit)
      : db.collection("raw_materials_real_stock").find({});

    const materials = await query.toArray();

    logSuccess(`Fetched ${materials.length} materials from raw_materials_real_stock`);

    if (materials.length > 0) {
      console.log('\n📋 Sample materials:');
      materials.slice(0, 3).forEach((material, index) => {
        console.log(`  ${index + 1}. ${material.rm_code || 'NO_CODE'} - ${material.trade_name || 'NO_NAME'}`);
      });
    }

    return { success: true, materials };
  } catch (error: any) {
    logError('Failed to fetch materials', error);
    return { success: false, materials: [], error: error.message };
  }
}

/**
 * Index materials into sales-rnd-ai Pinecone index
 */
async function indexMaterialsToSalesAI(materials: any[], batchSize: number = 50) {
  logStart('indexMaterialsToSalesAI', `Indexing ${materials.length} materials (batch size: ${batchSize})`);

  try {
    // Initialize RAG service with salesRndAI configuration
    const ragService = new PineconeRAGService('salesRndAI');

    // Prepare documents with raw_materials_real_stock source
    // This ensures they are compatible with the sales AI filter
    const documents = materials.map(material => {
      const doc = PineconeRAGService.prepareRawMaterialDocument(material);
      // Ensure source matches the salesRndAI filter
      doc.metadata.source = 'raw_materials_real_stock';
      return doc;
    });

    console.log(`\n📦 Prepared ${documents.length} documents for indexing`);

    // Batch process documents
    await ragService.batchProcessDocuments(materials, batchSize);

    logSuccess(`Successfully indexed ${documents.length} materials to sales-rnd-ai index!`);

    return { success: true, count: documents.length };
  } catch (error: any) {
    logError('Failed to index materials', error);
    return { success: false, count: 0, error: error.message };
  }
}

/**
 * Test search functionality
 */
async function testSalesAISearch() {
  logStart('testSalesAISearch', 'Testing sales AI search...');

  try {
    const ragService = new PineconeRAGService('salesRndAI');

    const testQueries = [
      "moisturizing ingredients",
      "anti-aging chemicals",
      "sunscreen materials",
      "emulsifier"
    ];

    console.log('\n🔍 Running test queries:');

    for (const query of testQueries) {
      console.log(`\n  Query: "${query}"`);

      const results = await ragService.searchSimilar(query, {
        topK: 3,
        similarityThreshold: 0.6
      });

      console.log(`  📋 Found ${results.length} results`);

      if (results.length > 0) {
        results.forEach((result, index) => {
          console.log(`    ${index + 1}. Score: ${(result.score || 0).toFixed(3)} - ${result.metadata?.rm_code || 'N/A'}: ${result.metadata?.trade_name || 'N/A'}`);
        });
      }
    }

    logSuccess('Search test completed!');
    return { success: true };
  } catch (error: any) {
    logError('Search test failed', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get index statistics
 */
async function getIndexStats() {
  logStart('getIndexStats', 'Getting index statistics...');

  try {
    const ragService = new PineconeRAGService('salesRndAI');
    const stats = await ragService.getIndexStats();

    console.log('\n📊 Sales RND AI Index Statistics:');
    console.log(`  Total Records: ${stats.totalRecordCount}`);
    console.log(`  Dimensions: ${stats.dimension}`);
    console.log(`  Index Fullness: ${(stats.indexFullness * 100).toFixed(2)}%`);

    logSuccess('Successfully retrieved index statistics');

    return { success: true, stats };
  } catch (error: any) {
    logError('Failed to get index stats', error);
    return { success: false, error: error.message };
  }
}

/**
 * Main execution function
 */
async function main() {
  console.log('🚀 SALES RND AI DATA INDEXING SCRIPT');
  console.log('=' .repeat(70));
  console.log('Purpose: Index raw_materials_real_stock data into sales-rnd-ai Pinecone index');
  console.log('=' .repeat(70));

  // Step 1: Check MongoDB connection
  console.log('\n📝 STEP 1: Checking MongoDB Connection');
  console.log('-'.repeat(70));
  const mongoCheck = await checkMongoDBConnection();

  if (!mongoCheck.success || mongoCheck.count === 0) {
    console.log('\n❌ Cannot proceed without MongoDB data');
    console.log('📝 Troubleshooting:');
    console.log('  1. Check MongoDB connection string in .env.local');
    console.log('  2. Verify raw_materials_real_stock collection exists');
    console.log('  3. Ensure collection has data');
    process.exit(1);
  }

  // Step 2: Fetch materials from stock
  console.log('\n📝 STEP 2: Fetching Materials from raw_materials_real_stock');
  console.log('-'.repeat(70));
  const fetchResult = await fetchMaterialsFromStock();

  if (!fetchResult.success || fetchResult.materials.length === 0) {
    console.log('\n❌ No materials to index');
    process.exit(1);
  }

  // Step 3: Index materials to Sales AI
  console.log('\n📝 STEP 3: Indexing Materials to sales-rnd-ai Pinecone Index');
  console.log('-'.repeat(70));
  const indexResult = await indexMaterialsToSalesAI(fetchResult.materials, 50);

  if (!indexResult.success) {
    console.log('\n❌ Indexing failed');
    console.log('📝 Troubleshooting:');
    console.log('  1. Check PINECONE_API_KEY in .env.local');
    console.log('  2. Verify sales-rnd-ai index exists (run: npm run create-sales-index)');
    console.log('  3. Check Gemini API key for embeddings');
    process.exit(1);
  }

  // Step 4: Test search functionality
  console.log('\n📝 STEP 4: Testing Sales AI Search Functionality');
  console.log('-'.repeat(70));
  await testSalesAISearch();

  // Step 5: Get final statistics
  console.log('\n📝 STEP 5: Final Index Statistics');
  console.log('-'.repeat(70));
  const statsResult = await getIndexStats();

  // Final summary
  console.log('\n' + '='.repeat(70));
  console.log('✅ SALES RND AI INDEXING COMPLETE!');
  console.log('='.repeat(70));

  if (statsResult.success && statsResult.stats) {
    console.log('\n📊 Summary:');
    console.log(`  ✅ ${statsResult.stats.totalRecordCount} materials indexed`);
    console.log(`  ✅ Vector search enabled for Sales RND AI`);
    console.log(`  ✅ Index: sales-rnd-ai`);
    console.log(`  ✅ Source: raw_materials_real_stock collection`);
  }

  console.log('\n🎯 Next Steps:');
  console.log('  1. Deploy to staging/production');
  console.log('  2. Test Sales RND AI chat interface');
  console.log('  3. Sales AI will now have RAG capabilities!');
  console.log('  4. To finetune: Update defaultFilters.source in ai/config/rag-config.ts');

  console.log('\n🏁 Script completed successfully!');
}

// Run the main function
main().catch((error) => {
  logError('Script failed with fatal error', error);
  process.exit(1);
});
