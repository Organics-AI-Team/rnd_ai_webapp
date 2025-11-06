#!/usr/bin/env tsx

/**
 * Clean Re-indexing Script
 *
 * This script will:
 * 1. Delete the current polluted index
 * 2. Create clean index with proper namespace separation
 * 3. Index only clean FDA data from raw_materials_console (default)
 * 4. Index stock data separately for stock queries only
 */

import { config } from 'dotenv';
import { PineconeRAGService } from '../ai/services/rag/pinecone-service';
import rawMaterialsClientPromise from '../lib/raw-materials-mongodb';
import { ObjectId } from 'mongodb';

// Load environment variables
config({ path: '.env.local' });

// Batch processing configuration
const BATCH_SIZE = 50;
const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds

/**
 * Clean and prepare document from console collection
 */
function prepareConsoleDocument(doc: any) {
  // Handle field mapping for console collection
  const cleaned = {
    _id: doc._id,
    rm_code: doc.rm_code || 'N/A',
    trade_name: doc.trade_name || doc.name || 'N/A',
    inci_name: doc.INCI_name || doc.inci_name || 'N/A',
    supplier: doc.supplier || 'N/A',
    company_name: doc.company_name || 'N/A',
    rm_cost: doc.rm_cost || 0,
    benefits: Array.isArray(doc.benefits)
      ? doc.benefits.join(', ')
      : (typeof doc.benefits === 'string' ? doc.benefits : 'No benefits information'),
    usecase: Array.isArray(doc.usecase)
      ? doc.usecase.join(', ')
      : (typeof doc.usecase === 'string' ? doc.usecase : 'No use case information'),
    function: doc.Function || doc.function || 'N/A',
    category: doc.category || 'N/A',
    cas_no: doc.cas_no || 'N/A',
    ec_no: doc.ec_no || doc.einecs_no || 'N/A',
    description: doc.Chem_IUPAC_Name_Description || doc.description || 'No description available',
    source: 'raw_materials_console',
    namespace: 'all_fda'
  };

  return cleaned;
}

/**
 * Clean and prepare document from stock collection
 */
function prepareStockDocument(doc: any) {
  // Only include documents with proper material codes
  if (!doc.rm_code || /^[A-Z]+[ก-๙]/.test(doc.rm_code) || /\s/.test(doc.rm_code)) {
    console.log(`⚠️  Skipping malformed material code: ${doc.rm_code}`);
    return null;
  }

  const cleaned = {
    _id: doc._id,
    rm_code: doc.rm_code,
    trade_name: doc.trade_name || 'N/A',
    inci_name: doc.inci_name || 'N/A',
    supplier: doc.supplier || 'N/A',
    company_name: doc.company_name || 'N/A',
    rm_cost: doc.rm_cost || 0,
    benefits: doc.benefits || 'No benefits information',
    usecase: doc.usecase || 'No use case information',
    function: doc.function || 'N/A',
    category: doc.category || 'N/A',
    cas_no: doc.cas_no || 'N/A',
    ec_no: doc.einecs_no || 'N/A',
    description: doc.description || 'No description available',
    source: 'raw_materials_real_stock',
    namespace: 'in_stock'
  };

  return cleaned;
}

/**
 * Delete current index
 */
async function deleteCurrentIndex() {
  console.log('🗑️  DELETING CURRENT POLLUTED INDEX');

  try {
    const ragService = new PineconeRAGService();

    // Get index stats before deletion
    const stats = await ragService.getIndexStats();
    console.log(`📊 Current index has ${stats.totalRecordCount} records`);

    // Delete all vectors from both namespaces
    console.log('🧹 Cleaning in_stock namespace...');
    await ragService.deleteAll({
      namespace: 'in_stock'
    });

    console.log('🧹 Cleaning all_fda namespace...');
    await ragService.deleteAll({
      namespace: 'all_fda'
    });

    console.log('✅ Current index cleaned successfully');

  } catch (error: any) {
    console.log('⚠️  Note: Index may not exist or is already clean');
    console.log(`   Error: ${error.message}`);
  }
}

/**
 * Index FDA console data
 */
async function indexConsoleData() {
  console.log('\n📚 INDEXING FDA CONSOLE DATA');

  try {
    const client = await rawMaterialsClientPromise;
    const db = client.db();
    const ragService = new PineconeRAGService();

    // Get total count
    const totalCount = await db.collection("raw_materials_console").countDocuments();
    console.log(`📦 Found ${totalCount} materials in console collection`);

    let processed = 0;
    let skipped = 0;

    // Process in batches
    for (let skip = 0; skip < totalCount; skip += BATCH_SIZE) {
      console.log(`\n📋 Processing batch ${Math.floor(skip / BATCH_SIZE) + 1}/${Math.ceil(totalCount / BATCH_SIZE)} (${skip}-${skip + BATCH_SIZE})`);

      const batch = await db.collection("raw_materials_console")
        .find({})
        .skip(skip)
        .limit(BATCH_SIZE)
        .toArray();

      // Clean and prepare documents
      const cleanDocs = batch.map(prepareConsoleDocument).filter(doc => doc !== null);

      if (cleanDocs.length > 0) {
        // Prepare for Pinecone
        const pineconeDocs = cleanDocs.map(doc =>
          PineconeRAGService.prepareRawMaterialDocument(doc)
        );

        // Index batch
        await ragService.upsertDocuments(pineconeDocs, {
          namespace: 'all_fda'
        });

        console.log(`✅ Indexed ${cleanDocs.length} documents`);
      }

      processed += batch.length;

      // Progress update
      const progress = ((processed / totalCount) * 100).toFixed(1);
      console.log(`📈 Progress: ${progress}% (${processed}/${totalCount})`);

      // Delay to avoid rate limiting
      if (skip + BATCH_SIZE < totalCount) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }

    console.log(`\n🎉 FDA Console indexing completed!`);
    console.log(`   Processed: ${processed} documents`);
    console.log(`   Indexed: ${processed - skipped} clean documents`);
    console.log(`   Skipped: ${skipped} malformed documents`);

  } catch (error: any) {
    console.error('❌ Error indexing console data:', error.message);
    throw error;
  }
}

/**
 * Index clean stock data only
 */
async function indexStockData() {
  console.log('\n📦 INDEXING CLEAN STOCK DATA');

  try {
    const client = await rawMaterialsClientPromise;
    const db = client.db();
    const ragService = new PineconeRAGService();

    // Get total count
    const totalCount = await db.collection("raw_materials_real_stock").countDocuments();
    console.log(`📦 Found ${totalCount} materials in stock collection`);

    let processed = 0;
    let indexed = 0;
    let skipped = 0;

    // Process in batches
    for (let skip = 0; skip < totalCount; skip += BATCH_SIZE) {
      console.log(`\n📋 Processing stock batch ${Math.floor(skip / BATCH_SIZE) + 1}/${Math.ceil(totalCount / BATCH_SIZE)} (${skip}-${skip + BATCH_SIZE})`);

      const batch = await db.collection("raw_materials_real_stock")
        .find({})
        .skip(skip)
        .limit(BATCH_SIZE)
        .toArray();

      // Clean and prepare documents (filter out malformed ones)
      const cleanDocs = batch.map(prepareStockDocument).filter(doc => doc !== null);

      if (cleanDocs.length > 0) {
        // Prepare for Pinecone
        const pineconeDocs = cleanDocs.map(doc =>
          PineconeRAGService.prepareRawMaterialDocument(doc)
        );

        // Index batch
        await ragService.upsertDocuments(pineconeDocs, {
          namespace: 'in_stock'
        });

        indexed += cleanDocs.length;
        console.log(`✅ Indexed ${cleanDocs.length} clean stock documents`);
      }

      processed += batch.length;
      skipped += batch.length - cleanDocs.length;

      // Progress update
      const progress = ((processed / totalCount) * 100).toFixed(1);
      console.log(`📈 Progress: ${progress}% (${processed}/${totalCount})`);

      // Delay to avoid rate limiting
      if (skip + BATCH_SIZE < totalCount) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }

    console.log(`\n🎉 Stock indexing completed!`);
    console.log(`   Processed: ${processed} documents`);
    console.log(`   Indexed: ${indexed} clean documents`);
    console.log(`   Skipped: ${skipped} malformed documents`);

  } catch (error: any) {
    console.error('❌ Error indexing stock data:', error.message);
    throw error;
  }
}

/**
 * Verify clean indexing
 */
async function verifyIndexing() {
  console.log('\n🔍 VERIFYING CLEAN INDEXING');

  try {
    const ragService = new PineconeRAGService();

    // Get final stats
    const stats = await ragService.getIndexStats();
    console.log(`📊 Final index statistics:`);
    console.log(`   Total Records: ${stats.totalRecordCount}`);
    console.log(`   Dimensions: ${stats.dimension}`);
    console.log(`   Index Fullness: ${(stats.indexFullness * 100).toFixed(2)}%`);

    // Test search in all_fda namespace
    console.log('\n🧪 Testing all_fda namespace search...');
    try {
      const fdaResults = await ragService.searchSimilar("Vitamin C", {
        topK: 3,
        similarityThreshold: 0.5,
        pinecone_namespace: 'all_fda'
      });

      console.log(`✅ Found ${fdaResults.length} results in all_fda namespace`);
      if (fdaResults.length > 0) {
        console.log('Sample result:');
        console.log(`   RM Code: ${fdaResults[0].metadata?.rm_code}`);
        console.log(`   Name: ${fdaResults[0].metadata?.trade_name}`);
        console.log(`   Source: ${fdaResults[0].metadata?.source}`);
      }
    } catch (error: any) {
      console.log(`⚠️  Error testing all_fda: ${error.message}`);
    }

    // Test search in in_stock namespace
    console.log('\n🧪 Testing in_stock namespace search...');
    try {
      const stockResults = await ragService.searchSimilar("moisturizing", {
        topK: 3,
        similarityThreshold: 0.5,
        pinecone_namespace: 'in_stock'
      });

      console.log(`✅ Found ${stockResults.length} results in in_stock namespace`);
      if (stockResults.length > 0) {
        console.log('Sample result:');
        console.log(`   RM Code: ${stockResults[0].metadata?.rm_code}`);
        console.log(`   Name: ${stockResults[0].metadata?.trade_name}`);
        console.log(`   Source: ${stockResults[0].metadata?.source}`);
      }
    } catch (error: any) {
      console.log(`⚠️  Error testing in_stock: ${error.message}`);
    }

  } catch (error: any) {
    console.error('❌ Error verifying indexing:', error.message);
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 CLEAN RE-INDEXING SCRIPT');
  console.log('This will create a clean index with proper separation:\n');

  try {
    // Step 1: Delete current polluted index
    await deleteCurrentIndex();

    // Step 2: Index clean FDA console data (default)
    await indexConsoleData();

    // Step 3: Index clean stock data (for stock queries only)
    await indexStockData();

    // Step 4: Verify the clean indexing
    await verifyIndexing();

    console.log('\n🎉 CLEAN RE-INDEXING COMPLETED SUCCESSFULLY!');
    console.log('\n📝 NEXT STEPS:');
    console.log('1. Test the AI chat interface');
    console.log('2. Try general queries (should use FDA data)');
    console.log('3. Try stock-specific queries like "สารที่เรามี"');
    console.log('4. Verify no more malformed material codes appear');

  } catch (error: any) {
    console.error('\n❌ CLEAN RE-INDEXING FAILED:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run the script
main().catch(console.error);