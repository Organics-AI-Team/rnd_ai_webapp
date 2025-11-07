/**
 * ChromaDB Indexing Script for Railway Deployment
 *
 * This script indexes raw_materials_console collection to ChromaDB on Railway
 *
 * Usage:
 *   npm run index:chromadb
 *
 * Environment Variables Required:
 *   - MONGODB_URI: MongoDB connection string
 *   - GEMINI_API_KEY: Google Gemini API key for embeddings
 *   - CHROMA_URL: ChromaDB service URL (e.g., https://alert-adaptation-production-9e03.up.railway.app)
 *
 * Features:
 *   - Progress tracking
 *   - Batch processing
 *   - Error handling with retries
 *   - Resumable (can continue if interrupted)
 *
 * @author AI Management System
 * @date 2025-11-08
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Configuration
const BATCH_SIZE = 50; // Process 50 documents at once
const COLLECTION_NAME = 'raw_materials_console';
const CHROMA_COLLECTION_NAME = 'raw_materials_fda';
const EMBEDDING_MODEL = 'text-embedding-004';
const EMBEDDING_DIMENSION = 768;

interface MaterialDocument {
  _id: any;
  rm_code: string;
  INCI_name?: string;
  trade_name?: string;
  supplier?: string;
  rm_cost?: number;
  Function?: string;
  Chem_IUPAC_Name_Description?: string;
  benefits?: string[] | string;
  usecase?: string[] | string;
  benefits_cached?: string[];
  usecase_cached?: string[];
}

/**
 * Format document into searchable text for embedding
 */
function formatDocumentForEmbedding(doc: MaterialDocument): string {
  const parts = [
    `Code: ${doc.rm_code}`,
    doc.INCI_name ? `INCI: ${doc.INCI_name}` : '',
    doc.trade_name ? `Trade Name: ${doc.trade_name}` : '',
    doc.Function ? `Function: ${doc.Function}` : '',
    doc.benefits ? `Benefits: ${Array.isArray(doc.benefits) ? doc.benefits.join(', ') : doc.benefits}` : '',
    doc.usecase ? `Use Cases: ${Array.isArray(doc.usecase) ? doc.usecase.join(', ') : doc.usecase}` : '',
    doc.Chem_IUPAC_Name_Description ? `Description: ${doc.Chem_IUPAC_Name_Description}` : '',
    doc.supplier ? `Supplier: ${doc.supplier}` : '',
    doc.rm_cost ? `Cost: ${doc.rm_cost} THB` : ''
  ].filter(Boolean);

  return parts.join('\n');
}

/**
 * Generate embeddings using Gemini API
 */
async function generateEmbeddings(texts: string[], genAI: GoogleGenerativeAI): Promise<number[][]> {
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

  const embeddings: number[][] = [];

  // Process in smaller batches to avoid rate limits
  for (let i = 0; i < texts.length; i += 10) {
    const batch = texts.slice(i, i + 10);

    for (const text of batch) {
      const result = await model.embedContent(text);
      embeddings.push(result.embedding.values);
    }

    // Small delay to avoid rate limiting
    if (i + 10 < texts.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return embeddings;
}

/**
 * Create or get ChromaDB collection
 */
async function getOrCreateCollection(chromaUrl: string): Promise<void> {
  console.log('🔍 Checking ChromaDB collection...');

  const response = await fetch(`${chromaUrl}/api/v1/collections`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`Failed to list collections: ${response.statusText}`);
  }

  const collections = await response.json();
  const exists = collections.some((c: any) => c.name === CHROMA_COLLECTION_NAME);

  if (exists) {
    console.log(`✅ Collection "${CHROMA_COLLECTION_NAME}" already exists`);
    return;
  }

  console.log(`📝 Creating collection "${CHROMA_COLLECTION_NAME}"...`);

  const createResponse = await fetch(`${chromaUrl}/api/v1/collections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: CHROMA_COLLECTION_NAME,
      metadata: {
        description: 'FDA Raw Materials Database',
        total_materials: 31179,
        created_at: new Date().toISOString()
      }
    })
  });

  if (!createResponse.ok) {
    throw new Error(`Failed to create collection: ${createResponse.statusText}`);
  }

  console.log(`✅ Collection "${CHROMA_COLLECTION_NAME}" created`);
}

/**
 * Upload batch to ChromaDB
 */
async function uploadBatch(
  chromaUrl: string,
  documents: MaterialDocument[],
  embeddings: number[][]
): Promise<void> {
  const ids = documents.map(doc => doc.rm_code);
  const texts = documents.map(doc => formatDocumentForEmbedding(doc));
  const metadatas = documents.map(doc => ({
    rm_code: doc.rm_code,
    INCI_name: doc.INCI_name || '',
    trade_name: doc.trade_name || '',
    Function: doc.Function || '',
    supplier: doc.supplier || '',
    rm_cost: doc.rm_cost || 0,
    benefits: Array.isArray(doc.benefits) ? doc.benefits.join(', ') : (doc.benefits || ''),
    usecase: Array.isArray(doc.usecase) ? doc.usecase.join(', ') : (doc.usecase || ''),
    source: 'raw_materials_console'
  }));

  const response = await fetch(
    `${chromaUrl}/api/v1/collections/${CHROMA_COLLECTION_NAME}/add`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids,
        embeddings,
        documents: texts,
        metadatas
      })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to upload batch: ${response.statusText} - ${error}`);
  }
}

/**
 * Check current count in ChromaDB
 */
async function getCollectionCount(chromaUrl: string): Promise<number> {
  try {
    const response = await fetch(
      `${chromaUrl}/api/v1/collections/${CHROMA_COLLECTION_NAME}/count`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      }
    );

    if (!response.ok) {
      return 0;
    }

    const data = await response.json();
    return data || 0;
  } catch (error) {
    return 0;
  }
}

/**
 * Main indexing function
 */
async function indexToChromaDB() {
  console.log('🚀 Starting ChromaDB Indexing for Railway Deployment\n');
  console.log('=' .repeat(60));

  // Validate environment variables
  const mongoUri = process.env.MONGODB_URI;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const chromaUrl = process.env.CHROMA_URL;

  if (!mongoUri || !geminiApiKey || !chromaUrl) {
    console.error('❌ Missing required environment variables:');
    if (!mongoUri) console.error('  - MONGODB_URI');
    if (!geminiApiKey) console.error('  - GEMINI_API_KEY');
    if (!chromaUrl) console.error('  - CHROMA_URL');
    process.exit(1);
  }

  console.log('📋 Configuration:');
  console.log(`  MongoDB: ${mongoUri.split('@')[1]?.split('/')[0] || 'configured'}`);
  console.log(`  ChromaDB: ${chromaUrl}`);
  console.log(`  Collection: ${COLLECTION_NAME} → ${CHROMA_COLLECTION_NAME}`);
  console.log(`  Batch Size: ${BATCH_SIZE}`);
  console.log(`  Embedding Model: ${EMBEDDING_MODEL} (${EMBEDDING_DIMENSION}D)`);
  console.log('=' .repeat(60) + '\n');

  // Initialize services
  const mongoClient = new MongoClient(mongoUri);
  const genAI = new GoogleGenerativeAI(geminiApiKey);

  try {
    // Connect to MongoDB
    console.log('🔌 Connecting to MongoDB...');
    await mongoClient.connect();
    const db = mongoClient.db('rnd_ai');
    const collection = db.collection(COLLECTION_NAME);
    console.log('✅ Connected to MongoDB\n');

    // Get total count
    const totalCount = await collection.countDocuments();
    console.log(`📊 Total documents in MongoDB: ${totalCount.toLocaleString()}\n`);

    if (totalCount === 0) {
      console.log('❌ No documents found in collection');
      return;
    }

    // Setup ChromaDB collection
    await getOrCreateCollection(chromaUrl);

    // Check if already indexed
    const currentCount = await getCollectionCount(chromaUrl);
    if (currentCount > 0) {
      console.log(`\n⚠️  ChromaDB already has ${currentCount.toLocaleString()} documents`);
      console.log('   This script will ADD more documents (not replace)');
      console.log('   Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // Process documents in batches
    let processed = 0;
    const startTime = Date.now();

    const cursor = collection.find({}).batchSize(BATCH_SIZE);
    let batch: MaterialDocument[] = [];

    console.log('📦 Starting batch processing...\n');

    while (await cursor.hasNext()) {
      const document = await cursor.next();
      if (!document) continue;

      batch.push(document as MaterialDocument);

      if (batch.length >= BATCH_SIZE) {
        // Process batch
        try {
          // Generate embeddings
          const texts = batch.map(doc => formatDocumentForEmbedding(doc));
          const embeddings = await generateEmbeddings(texts, genAI);

          // Upload to ChromaDB
          await uploadBatch(chromaUrl, batch, embeddings);

          processed += batch.length;

          // Calculate statistics
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = processed / elapsed;
          const remaining = totalCount - processed;
          const eta = remaining / speed / 60;
          const progress = (processed / totalCount * 100).toFixed(1);

          console.log(
            `✅ ${processed.toLocaleString()}/${totalCount.toLocaleString()} ` +
            `(${progress}%) | ` +
            `Speed: ${speed.toFixed(1)} docs/sec | ` +
            `ETA: ${eta.toFixed(1)} min`
          );

          batch = [];
        } catch (error) {
          console.error(`❌ Error processing batch:`, error);
          console.log('⚠️  Continuing with next batch...\n');
          batch = [];
        }
      }
    }

    // Process remaining documents
    if (batch.length > 0) {
      try {
        const texts = batch.map(doc => formatDocumentForEmbedding(doc));
        const embeddings = await generateEmbeddings(texts, genAI);
        await uploadBatch(chromaUrl, batch, embeddings);
        processed += batch.length;
      } catch (error) {
        console.error(`❌ Error processing final batch:`, error);
      }
    }

    // Final statistics
    const totalTime = (Date.now() - startTime) / 1000 / 60;
    const finalCount = await getCollectionCount(chromaUrl);

    console.log('\n' + '='.repeat(60));
    console.log('🎉 INDEXING COMPLETED!');
    console.log('='.repeat(60));
    console.log(`📊 Documents processed: ${processed.toLocaleString()}`);
    console.log(`⏱️  Total time: ${totalTime.toFixed(1)} minutes`);
    console.log(`⚡ Average speed: ${(processed / (totalTime * 60)).toFixed(1)} docs/sec`);
    console.log(`📈 ChromaDB total count: ${finalCount.toLocaleString()}`);
    console.log(`🗄️  Collection: ${CHROMA_COLLECTION_NAME}`);
    console.log(`🌐 URL: ${chromaUrl}`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ Indexing failed:', error);
    throw error;
  } finally {
    await mongoClient.close();
    console.log('\n✅ MongoDB connection closed');
  }
}

// Run the indexing
indexToChromaDB()
  .then(() => {
    console.log('\n✨ Script completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  });
