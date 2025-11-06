/**
 * Clean Re-indexing Script for raw_materials_console Collection
 * Properly clears existing data then re-indexes from scratch
 */

import { MongoClient } from 'mongodb';
import { Pinecone } from '@pinecone-database/pinecone';
import { createEmbeddingService } from '@/ai/services/embeddings/universal-embedding-service';
import { DynamicChunkingService } from '@/ai/services/rag/dynamic-chunking-service';

// Configuration
const DOCUMENT_BATCH_SIZE = 16; // Process 16 docs at once (96 chunks per batch)
const PINECONE_INDEX = 'raw-materials-stock';
const COLLECTION_NAME = 'raw_materials_console';
const NAMESPACE = 'all_fda';

interface MaterialDocument {
  _id: any;
  rm_code: string;
  trade_name: string;
  supplier: string;
  rm_cost: number;
  benefits: string[];
  usecase: string[];
  benefits_cached: string[];
  usecase_cached: string[];
  createdAt: Date;
  updatedAt: Date;
}

async function cleanReindexRawMaterialsConsole() {
  console.log('🔄 Clean Re-indexing raw_materials_console collection...\n');
  console.log('📊 Collection:', COLLECTION_NAME);
  console.log('🗂️  Pinecone Index:', PINECONE_INDEX);
  console.log('📛 Namespace:', NAMESPACE);
  console.log('');

  // Initialize services
  const mongoClient = new MongoClient(process.env.MONGODB_URI || '');
  const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY || '' });
  const index = pinecone.index(PINECONE_INDEX);

  // Initialize embedding service
  const embeddingService = createEmbeddingService({
    provider: 'gemini',
    apiKey: process.env.GEMINI_API_KEY || ''
  });

  // Initialize chunking service
  const chunkingService = new DynamicChunkingService({
    max_chunk_size: 500,
    min_chunk_size: 50,
    chunk_overlap: 50,
    field_weights: {
      rm_code: 1,
      trade_name: 0.95,
      supplier: 0.8,
      benefits: 0.9,
      usecase: 0.9,
      rm_cost: 0.7
    },
    semantic_chunking: true
  });

  try {
    // Connect to MongoDB
    await mongoClient.connect();
    const db = mongoClient.db('rnd_ai');
    const collection = db.collection(COLLECTION_NAME);

    console.log('✅ Connected to MongoDB');

    // Get total count
    const totalCount = await collection.countDocuments();
    console.log(`📊 Total documents in ${COLLECTION_NAME}: ${totalCount.toLocaleString()}`);

    if (totalCount === 0) {
      console.log('❌ No documents found in collection');
      return;
    }

    // Clear existing data using proper method
    console.log(`\n🧹 Clearing existing data in namespace: ${NAMESPACE}`);

    // First, get all vector IDs in the namespace
    try {
      // Get all existing vectors to delete them properly
      const existingVectors = await index.query({
        vector: new Array(768).fill(0.1), // Dummy vector to get all results
        topK: 10000, // Get up to 10,000 vectors
        includeMetadata: false,
        namespace: NAMESPACE
      });

      if (existingVectors.matches && existingVectors.matches.length > 0) {
        console.log(`🗑️ Found ${existingVectors.matches.length} existing vectors to delete`);

        // Delete all vectors by their IDs
        const vectorIds = existingVectors.matches.map(match => match.id);

        // Delete in batches of 1000
        const DELETE_BATCH_SIZE = 1000;
        for (let i = 0; i < vectorIds.length; i += DELETE_BATCH_SIZE) {
          const batch = vectorIds.slice(i, i + DELETE_BATCH_SIZE);
          await index.deleteMany({
            ids: batch,
            namespace: NAMESPACE
          });
          console.log(`🗑️ Deleted ${Math.min(i + DELETE_BATCH_SIZE, vectorIds.length)}/${vectorIds.length} vectors`);
        }
        console.log('✅ Cleared all existing vectors');
      } else {
        console.log('✅ No existing vectors found');
      }
    } catch (clearError) {
      console.log('⚠️ Could not clear existing vectors (namespace might be empty):', clearError.message);
    }

    // Wait a moment for Pinecone to update
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Process documents in batches
    let processed = 0;
    let totalChunks = 0;

    const cursor = collection.find({}).batchSize(DOCUMENT_BATCH_SIZE);
    let batch: MaterialDocument[] = [];

    console.log(`\n📦 Starting re-indexing with batch size: ${DOCUMENT_BATCH_SIZE}`);
    console.log(`⚡ Expected chunks: ~${totalCount * 6} (6 chunks per document)\n`);

    while (await cursor.hasNext()) {
      const document = await cursor.next();
      if (!document) continue;

      batch.push(document as MaterialDocument);

      if (batch.length >= DOCUMENT_BATCH_SIZE) {
        const chunks = await processBatch(batch, chunkingService);
        const vectors = await generateVectors(chunks, embeddingService);

        // Upload to Pinecone
        if (vectors.length > 0) {
          await index.upsert(vectors);
        }

        processed += batch.length;
        totalChunks += chunks.length;

        const progress = (processed / totalCount * 100).toFixed(1);
        const speed = (processed / ((Date.now() - Date.now()) / 1000)).toFixed(1);
        const eta = ((totalCount - processed) / parseFloat(speed) / 60).toFixed(1);

        console.log(`🚀 Progress: ${processed.toLocaleString()}/${totalCount.toLocaleString()} (${progress}%) | Chunks: ${totalChunks.toLocaleString()} | Speed: ${speed} docs/sec | ETA: ${eta} min`);

        batch = [];
      }
    }

    // Process remaining documents
    if (batch.length > 0) {
      const chunks = await processBatch(batch, chunkingService);
      const vectors = await generateVectors(chunks, embeddingService);

      if (vectors.length > 0) {
        await index.upsert(vectors);
      }

      processed += batch.length;
      totalChunks += chunks.length;
    }

    // Wait for Pinecone to complete indexing
    console.log('\n⏳ Waiting for Pinecone to complete indexing...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Final summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ CLEAN RE-INDEXING COMPLETED!');
    console.log(`📊 Documents processed: ${processed.toLocaleString()}`);
    console.log(`🧩 Total chunks created: ${totalChunks.toLocaleString()}`);
    console.log(`📈 Chunks per document: ${(totalChunks / processed).toFixed(1)}`);
    console.log(`🔍 Namespace: ${NAMESPACE}`);
    console.log(`🗄️  Index: ${PINECONE_INDEX}`);
    console.log('='.repeat(60));

    // Check final stats
    try {
      const finalStats = await index.describeIndexStats();
      console.log(`📈 Final Pinecone stats: ${finalStats.totalVectorCount} total vectors`);

      if (finalStats.namespaces && finalStats.namespaces[NAMESPACE]) {
        console.log(`📈 Namespace ${NAMESPACE}: ${finalStats.namespaces[NAMESPACE].vectorCount} vectors`);
      }
    } catch (err) {
      console.log('⚠️ Could not get final Pinecone stats');
    }

  } catch (error) {
    console.error('❌ Re-indexing failed:', error);
    throw error;
  } finally {
    await mongoClient.close();
  }
}

async function processBatch(documents: MaterialDocument[], chunkingService: DynamicChunkingService): Promise<any[]> {
  const chunks = [];

  for (const doc of documents) {
    const documentText = formatDocumentForChunking(doc);
    const docChunks = await chunkingService.chunkDocument(documentText, {
      documentId: doc.rm_code,
      metadata: {
        rm_code: doc.rm_code,
        trade_name: doc.trade_name,
        supplier: doc.supplier,
        rm_cost: doc.rm_cost,
        source: 'raw_materials_console',
        namespace: NAMESPACE
      }
    });

    chunks.push(...docChunks);
  }

  return chunks;
}

function formatDocumentForChunking(doc: MaterialDocument): string {
  const parts = [
    `RM Code: ${doc.rm_code}`,
    `Trade Name: ${doc.trade_name}`,
    `Supplier: ${doc.supplier}`,
    `Cost: ${doc.rm_cost}`,
    doc.benefits && doc.benefits.length > 0 ? `Benefits: ${doc.benefits.join(', ')}` : '',
    doc.usecase && doc.usecase.length > 0 ? `Use Cases: ${doc.usecase.join(', ')}` : ''
  ].filter(Boolean);

  return parts.join('\n');
}

async function generateVectors(chunks: any[], embeddingService: any): Promise<any[]> {
  const vectors = [];

  // Generate embeddings in batches of 96 (optimal for Gemini)
  const EMBEDDING_BATCH_SIZE = 96;

  for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
    const texts = batch.map(chunk => chunk.text);

    try {
      const embeddings = await embeddingService.generateEmbeddings(texts);

      for (let j = 0; j < batch.length; j++) {
        vectors.push({
          id: `${batch[j].metadata.documentId}_chunk_${i + j}`,
          values: embeddings[j],
          metadata: {
            ...batch[j].metadata,
            chunkIndex: i + j,
            text: batch[j].text.substring(0, 1000) // Truncate for metadata
          }
        });
      }
    } catch (error) {
      console.error(`❌ Error generating embeddings for batch ${i}-${i + batch.length}:`, error);
      // Continue with next batch instead of failing completely
      continue;
    }
  }

  return vectors;
}

// Run the clean re-indexing
cleanReindexRawMaterialsConsole()
  .then(() => {
    console.log('\n🎉 Clean re-indexing completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Clean re-indexing failed:', error);
    process.exit(1);
  });