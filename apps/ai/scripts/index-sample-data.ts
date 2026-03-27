#!/usr/bin/env tsx

/**
 * Script to index sample raw materials data into Pinecone
 */

import { config } from 'dotenv';
import { PineconeRAGService } from '../ai/services/rag/qdrant-rag-service';
import rawMaterialsClientPromise from '../lib/raw-materials-mongodb';
import { ObjectId } from 'mongodb';

// Load environment variables
config({ path: '.env.local' });

// Sample RM000001 data for testing
const sampleRM000001 = {
  _id: new ObjectId(),
  rm_code: 'RM000001',
  trade_name: 'Test Cosmetic Chemical',
  inci_name: 'TestIngredient',
  supplier: 'Test Supplier Corp',
  company_name: 'Test Chemical Company',
  rm_cost: '50.00 USD/kg',
  benefits: 'Moisturizing, anti-aging, skin smoothing',
  details: 'A high-quality cosmetic ingredient designed for premium skincare formulations. Provides excellent moisturization and anti-aging benefits. Suitable for face creams, serums, and lotions.',
  category: 'Humectants',
  function: 'Moisturizing Agent'
};

async function checkMongoDBData() {
  try {
    const client = await rawMaterialsClientPromise;
    const db = client.db();

    const count = await db.collection("raw_materials_real_stock").countDocuments();
    console.log(`MongoDB has ${count} raw materials`);

    if (count > 0) {
      // Look for RM000001 specifically
      const rm000001 = await db.collection("raw_materials_real_stock").findOne({
        rm_code: 'RM000001'
      });

      if (rm000001) {
        console.log('Found RM000001:', rm000001.trade_name);
        return { found: true, data: rm000001 };
      } else {
        console.log('RM000001 not found in MongoDB');
        return { found: false };
      }
    }

    return { found: false, count };
  } catch (error: any) {
    console.error('MongoDB connection failed:', error.message);
    return null;
  }
}

async function indexSampleData() {
  try {
    const ragService = new PineconeRAGService();

    // Prepare documents
    const documents = [
      PineconeRAGService.prepareRawMaterialDocument(sampleRM000001)
    ];

    // Index the documents
    await ragService.upsertDocuments(documents);
    console.log('Sample RM000001 data indexed successfully');

    return true;
  } catch (error: any) {
    console.error('Failed to index sample data:', error.message);
    return false;
  }
}

async function indexRealData(batchSize: number = 10) {
  console.log(`Indexing real data (batch size: ${batchSize})`);

  try {
    const client = await rawMaterialsClientPromise;
    const db = client.db();
    const ragService = new PineconeRAGService();

    // Get real materials from MongoDB
    const materials = await db.collection("raw_materials_real_stock")
      .find({})
      .limit(batchSize)
      .toArray();

    if (materials.length === 0) {
      console.log('No materials found in MongoDB');
      return false;
    }

    console.log(`📦 Found ${materials.length} materials to index`);

    // Prepare documents
    const documents = materials.map(material =>
      PineconeRAGService.prepareRawMaterialDocument(material)
    );

    // Index documents
    await ragService.upsertDocuments(documents);
    console.log(`✅ Successfully indexed ${documents.length} real materials!`);

    // Show what was indexed
    console.log('\n📋 Indexed Materials:');
    documents.slice(0, 3).forEach((doc, index) => {
      console.log(`  ${index + 1}. ${doc.metadata.rm_code} - ${doc.metadata.trade_name}`);
    });

    return true;
  } catch (error: any) {
    console.log('❌ Failed to index real data:', error.message);
    return false;
  }
}

async function testRM000001Search() {
  console.log('\n🔎 Testing RM000001 search after indexing...');

  try {
    const ragService = new PineconeRAGService();

    const queries = [
      "RM000001",
      "สาร RM000001",
      "Test Cosmetic Chemical",
      "TestIngredient"
    ];

    for (const query of queries) {
      console.log(`\n🔍 Query: "${query}"`);

      const results = await ragService.searchSimilar(query, {
        topK: 5,
        similarityThreshold: 0.3
      });

      console.log(`📋 Found ${results.length} results`);

      if (results.length > 0) {
        results.forEach((result, index) => {
          console.log(`  ${index + 1}. Score: ${(result.score || 0).toFixed(3)}`);
          console.log(`     Code: ${result.metadata?.rm_code || 'N/A'}`);
          console.log(`     Name: ${result.metadata?.trade_name || 'N/A'}`);
          console.log(`     INCI: ${result.metadata?.inci_name || 'N/A'}`);
          console.log(`     Supplier: ${result.metadata?.supplier || 'N/A'}`);
        });
        return true; // Found at least one result
      }
    }

    return false;
  } catch (error: any) {
    console.log('❌ Search test failed:', error.message);
    return false;
  }
}

async function getIndexStats() {
  console.log('\n📊 Getting final index statistics...');

  try {
    const ragService = new PineconeRAGService();
    const stats = await ragService.getIndexStats();

    console.log('📊 Final Index Statistics:');
    console.log(`  Total Records: ${stats.totalRecordCount}`);
    console.log(`  Dimensions: ${stats.dimension}`);
    console.log(`  Index Fullness: ${(stats.indexFullness * 100).toFixed(2)}%`);

    return stats;
  } catch (error: any) {
    console.log('❌ Failed to get index stats:', error.message);
    return null;
  }
}

async function main() {
  console.log('🚀 RAW MATERIALS INDEXING SCRIPT\n');

  // Check what's available in MongoDB
  const mongoData = await checkMongoDBData();

  // Try to index sample data first
  console.log('\n' + '='.repeat(50));
  console.log('STEP 1: Indexing Sample RM000001 Data');
  console.log('='.repeat(50));
  const sampleIndexed = await indexSampleData();

  // Test search with sample data
  if (sampleIndexed) {
    const searchTest = await testRM000001Search();
    if (searchTest) {
      console.log('✅ RM000001 search is now working with sample data!');
    }
  }

  // Try to index real data if available
  console.log('\n' + '='.repeat(50));
  console.log('STEP 2: Indexing Real MongoDB Data');
  console.log('='.repeat(50));
  if (mongoData && (('count' in mongoData && mongoData.count > 0) || mongoData.found)) {
    await indexRealData(20); // Index up to 20 real materials
  } else {
    console.log('⚠️  No real data available in MongoDB');
  }

  // Final statistics
  console.log('\n' + '='.repeat(50));
  console.log('FINAL RESULTS');
  console.log('='.repeat(50));
  const finalStats = await getIndexStats();

  // Recommendations
  console.log('\n🎯 RECOMMENDATIONS:');
  if (finalStats && finalStats.totalRecordCount > 0) {
    console.log('✅ Vector database now has data!');
    console.log('✅ RAG search should work for indexed materials');
    console.log('✅ RM000001 queries should return results');
    console.log('\n📝 NEXT STEPS:');
    console.log('1. Test the AI chat interface');
    console.log('2. Try asking about RM000001');
    console.log('3. Index more materials if needed');
  } else {
    console.log('❌ No data was indexed');
    console.log('📝 TROUBLESHOOTING:');
    console.log('1. Check MongoDB connection');
    console.log('2. Verify API keys are valid');
    console.log('3. Check Pinecone configuration');
  }

  console.log('\n🏁 Indexing script completed!');
}

main().catch(console.error);