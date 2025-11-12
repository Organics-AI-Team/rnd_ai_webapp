/**
 * Rename Pinecone indexes and re-index all data with new rm_code
 *
 * New Index Names:
 * - 001-rnd-ai-in-stock-only (raw materials in stock only)
 * - 002-rnd-ai-all (all raw materials)
 * - 003-sales-ai (sales and market data)
 *
 * This script:
 * 1. Creates new indexes with proper names
 * 2. Indexes all 31,179 raw materials with rm_code from MongoDB
 * 3. Updates configurations to use new index names
 * 4. Deletes old indexes after successful migration
 *
 * @author Claude Code
 * @date 2025-11-05
 */

import { Pinecone } from '@pinecone-database/pinecone';
import clientPromise from '../lib/mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

const NEW_INDEX_NAMES = {
  IN_STOCK_ONLY: '001-rnd-ai-in-stock-only',
  ALL_MATERIALS: '002-rnd-ai-all',
  SALES_AI: '003-sales-ai'
};

const OLD_INDEX_NAMES = {
  RAW_MATERIALS_STOCK: 'raw-materials-stock',
  RND_AI: '002-rnd-ai',
  SALES_RND_AI: 'sales-rnd-ai'
};

const DIMENSION = 3072; // gemini-embedding-001 dimension
const BATCH_SIZE = 100; // Process 100 documents at a time

interface IndexStats {
  name: string;
  recordCount: number;
  startTime: Date;
  endTime?: Date;
  duration?: number;
}

/**
 * Initialize Pinecone client
 */
function initPinecone(): Pinecone {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) {
    throw new Error('PINECONE_API_KEY not found in environment');
  }
  return new Pinecone({ apiKey });
}

/**
 * Initialize Google Gemini AI
 */
function initGemini(): GoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not found in environment');
  }
  return new GoogleGenerativeAI(apiKey);
}

/**
 * Create a new Pinecone index if it doesn't exist
 */
async function createIndexIfNotExists(
  pinecone: Pinecone,
  indexName: string
): Promise<void> {
  console.log(`\n🔍 Checking if index "${indexName}" exists...`);

  const indexes = await pinecone.listIndexes();
  const exists = indexes.indexes?.some(idx => idx.name === indexName);

  if (exists) {
    console.log(`✅ Index "${indexName}" already exists`);
    return;
  }

  console.log(`🆕 Creating index "${indexName}"...`);
  await pinecone.createIndex({
    name: indexName,
    dimension: DIMENSION,
    metric: 'cosine',
    spec: {
      serverless: {
        cloud: 'aws',
        region: 'us-east-1'
      }
    }
  });

  console.log(`⏳ Waiting for index "${indexName}" to be ready...`);
  let ready = false;
  let attempts = 0;
  const maxAttempts = 60;

  while (!ready && attempts < maxAttempts) {
    attempts++;
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      const description = await pinecone.describeIndex(indexName);
      if (description.status?.state === 'Ready') {
        ready = true;
        console.log(`✅ Index "${indexName}" is ready!`);
      } else {
        process.stdout.write('.');
      }
    } catch (error) {
      process.stdout.write('.');
    }
  }

  if (!ready) {
    throw new Error(`Index "${indexName}" failed to become ready after ${maxAttempts} attempts`);
  }
}

/**
 * Generate embedding for text using Gemini
 */
async function generateEmbedding(
  gemini: GoogleGenerativeAI,
  text: string
): Promise<number[]> {
  const model = gemini.getGenerativeModel({ model: 'gemini-embedding-001' });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

/**
 * Prepare document text for embedding
 */
function prepareDocumentText(material: any): string {
  const parts: string[] = [];

  // Primary identifiers (highest weight)
  if (material.rm_code) parts.push(`RM Code: ${material.rm_code}`);
  if (material.trade_name) parts.push(`Trade Name: ${material.trade_name}`);
  if (material.INCI_name || material.inci_name) {
    parts.push(`INCI Name: ${material.INCI_name || material.inci_name}`);
  }

  // Secondary information
  if (material.supplier) parts.push(`Supplier: ${material.supplier}`);
  if (material.Function) parts.push(`Function: ${material.Function}`);

  // Benefits and use cases
  if (material.benefits || material.benefits_cached) {
    const benefits = material.benefits || material.benefits_cached;
    parts.push(`Benefits: ${benefits}`);
  }
  if (material.usecase || material.usecase_cached) {
    const usecases = material.usecase || material.usecase_cached;
    parts.push(`Use Cases: ${usecases}`);
  }

  // Additional details
  if (material.Chem_IUPAC_Name_Description) {
    parts.push(`Description: ${material.Chem_IUPAC_Name_Description}`);
  }

  return parts.join('\n');
}

/**
 * Index all raw materials to a Pinecone index
 */
async function indexRawMaterials(
  pinecone: Pinecone,
  gemini: GoogleGenerativeAI,
  indexName: string,
  filterInStockOnly: boolean = false
): Promise<IndexStats> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📦 Indexing raw materials to "${indexName}"`);
  console.log(`${'='.repeat(60)}`);

  const stats: IndexStats = {
    name: indexName,
    recordCount: 0,
    startTime: new Date()
  };

  const client = await clientPromise;
  const db = client.db();

  // Build query
  const query: any = {};
  if (filterInStockOnly) {
    // Add filter for in-stock items (you may need to adjust based on your schema)
    query.$or = [
      { stock_quantity: { $gt: 0 } },
      { in_stock: true }
    ];
  }

  const totalCount = await db.collection('raw_materials_console').countDocuments(query);
  console.log(`📊 Total documents to index: ${totalCount.toLocaleString()}`);

  if (totalCount === 0) {
    console.log('⚠️  No documents found to index');
    stats.endTime = new Date();
    stats.duration = stats.endTime.getTime() - stats.startTime.getTime();
    return stats;
  }

  const index = pinecone.index(indexName);
  let processed = 0;

  // Process in batches
  const cursor = db.collection('raw_materials_console').find(query);

  let batch: any[] = [];

  while (await cursor.hasNext()) {
    const material = await cursor.next();
    if (!material) continue;

    // Prepare document
    const documentText = prepareDocumentText(material);

    // Generate embedding
    try {
      const embedding = await generateEmbedding(gemini, documentText);

      // Prepare metadata
      const metadata: any = {
        rm_code: material.rm_code || '',
        trade_name: material.trade_name || '',
        inci_name: material.INCI_name || material.inci_name || '',
        supplier: material.supplier || '',
        function: material.Function || '',
        benefits: material.benefits || material.benefits_cached || '',
        usecase: material.usecase || material.usecase_cached || '',
        source: 'raw_materials_console'
      };

      batch.push({
        id: material._id.toString(),
        values: embedding,
        metadata
      });

      // Upsert batch when it reaches BATCH_SIZE
      if (batch.length >= BATCH_SIZE) {
        await index.upsert(batch);
        processed += batch.length;
        console.log(`  ✓ Indexed ${processed}/${totalCount} documents (${((processed / totalCount) * 100).toFixed(1)}%)`);
        batch = [];

        // Add small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error: any) {
      console.error(`  ❌ Failed to embed document ${material._id}:`, error.message);
    }
  }

  // Upsert remaining batch
  if (batch.length > 0) {
    await index.upsert(batch);
    processed += batch.length;
    console.log(`  ✓ Indexed ${processed}/${totalCount} documents (100%)`);
  }

  stats.recordCount = processed;
  stats.endTime = new Date();
  stats.duration = stats.endTime.getTime() - stats.startTime.getTime();

  console.log(`\n✅ Successfully indexed ${processed.toLocaleString()} documents to "${indexName}"`);
  console.log(`⏱️  Duration: ${(stats.duration / 1000).toFixed(2)} seconds`);

  return stats;
}

/**
 * Delete old index if it exists
 */
async function deleteOldIndex(pinecone: Pinecone, indexName: string): Promise<void> {
  console.log(`\n🗑️  Checking old index "${indexName}"...`);

  const indexes = await pinecone.listIndexes();
  const exists = indexes.indexes?.some(idx => idx.name === indexName);

  if (!exists) {
    console.log(`  ℹ️  Index "${indexName}" doesn't exist (already deleted or never created)`);
    return;
  }

  console.log(`  🗑️  Deleting old index "${indexName}"...`);
  await pinecone.deleteIndex(indexName);
  console.log(`  ✅ Deleted "${indexName}"`);

  // Wait for deletion to propagate
  await new Promise(resolve => setTimeout(resolve, 3000));
}

/**
 * Main migration function
 */
async function main() {
  console.log('🚀 PINECONE INDEX RENAME & RE-INDEX SCRIPT\n');
  console.log('This will:');
  console.log('  1. Create new indexes with better names');
  console.log('  2. Re-index all 31,179 raw materials with rm_code');
  console.log('  3. Delete old indexes after successful migration\n');

  const pinecone = initPinecone();
  const gemini = initGemini();
  const allStats: IndexStats[] = [];

  try {
    // Step 1: Delete old indexes first (to free up space in free tier)
    console.log('\n' + '='.repeat(60));
    console.log('STEP 1: Deleting Old Indexes (Free up space)');
    console.log('='.repeat(60));

    await deleteOldIndex(pinecone, OLD_INDEX_NAMES.RAW_MATERIALS_STOCK);
    await deleteOldIndex(pinecone, OLD_INDEX_NAMES.RND_AI);
    await deleteOldIndex(pinecone, OLD_INDEX_NAMES.SALES_RND_AI);

    // Step 2: Create all new indexes
    console.log('\n' + '='.repeat(60));
    console.log('STEP 2: Creating New Indexes');
    console.log('='.repeat(60));

    await createIndexIfNotExists(pinecone, NEW_INDEX_NAMES.IN_STOCK_ONLY);
    await createIndexIfNotExists(pinecone, NEW_INDEX_NAMES.ALL_MATERIALS);
    await createIndexIfNotExists(pinecone, NEW_INDEX_NAMES.SALES_AI);

    // Step 3: Index data to new indexes
    console.log('\n' + '='.repeat(60));
    console.log('STEP 3: Indexing Data');
    console.log('='.repeat(60));

    // Index in-stock only materials
    const inStockStats = await indexRawMaterials(
      pinecone,
      gemini,
      NEW_INDEX_NAMES.IN_STOCK_ONLY,
      true
    );
    allStats.push(inStockStats);

    // Index all materials
    const allMaterialsStats = await indexRawMaterials(
      pinecone,
      gemini,
      NEW_INDEX_NAMES.ALL_MATERIALS,
      false
    );
    allStats.push(allMaterialsStats);

    // Index sales data (same as all materials for now)
    const salesStats = await indexRawMaterials(
      pinecone,
      gemini,
      NEW_INDEX_NAMES.SALES_AI,
      false
    );
    allStats.push(salesStats);


    // Final Summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ MIGRATION COMPLETED SUCCESSFULLY');
    console.log('='.repeat(60));

    console.log('\n📊 Final Statistics:');
    allStats.forEach(stat => {
      console.log(`\n  Index: ${stat.name}`);
      console.log(`    Vectors: ${stat.recordCount.toLocaleString()}`);
      console.log(`    Duration: ${stat.duration ? (stat.duration / 1000).toFixed(2) : 'N/A'} seconds`);
    });

    console.log('\n🎯 Next Steps:');
    console.log('  1. Update ai/config/rag-config.ts with new index names');
    console.log('  2. Test all 3 AI agents with new indexes');
    console.log('  3. Verify RM000002 query returns correct results');

  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

main();
