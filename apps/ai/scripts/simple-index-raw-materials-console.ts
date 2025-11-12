/**
 * Simple Indexing Script for raw_materials_console Collection
 * Just indexes data without clearing existing data
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
  INCI_name?: string; // Added: INCI standardized name
  trade_name?: string;
  supplier?: string;
  rm_cost?: number;
  Function?: string; // Added: Primary function (e.g., "ANTI-SEBUM, ANTIOXIDANT")
  Chem_IUPAC_Name_Description?: string; // Added: Full chemical description
  benefits?: string[] | string;
  usecase?: string[] | string;
  benefits_cached?: string[];
  usecase_cached?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

async function indexRawMaterialsConsole() {
  console.log('🔄 Indexing raw_materials_console collection...\n');
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

    // Check current Pinecone stats
    try {
      const stats = await index.describeIndexStats();
      console.log(`📈 Current Pinecone stats: ${stats.totalRecordCount} total vectors`);
    } catch (err) {
      console.log('⚠️ Could not get Pinecone stats, continuing anyway');
    }

    // Process documents in batches
    let processed = 0;
    let totalChunks = 0;

    const cursor = collection.find({}).batchSize(DOCUMENT_BATCH_SIZE);
    let batch: MaterialDocument[] = [];

    console.log(`\n📦 Starting indexing with batch size: ${DOCUMENT_BATCH_SIZE}`);
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

    // Final summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ INDEXING COMPLETED!');
    console.log(`📊 Documents processed: ${processed.toLocaleString()}`);
    console.log(`🧩 Total chunks created: ${totalChunks.toLocaleString()}`);
    console.log(`📈 Chunks per document: ${(totalChunks / processed).toFixed(1)}`);
    console.log(`🔍 Namespace: ${NAMESPACE}`);
    console.log(`🗄️  Index: ${PINECONE_INDEX}`);
    console.log('='.repeat(60));

    // Check final stats
    try {
      const finalStats = await index.describeIndexStats();
      console.log(`📈 Final Pinecone stats: ${finalStats.totalRecordCount} total vectors`);
    } catch (err) {
      console.log('⚠️ Could not get final Pinecone stats');
    }

  } catch (error) {
    console.error('❌ Indexing failed:', error);
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
        // Core identifiers
        rm_code: doc.rm_code,
        INCI_name: doc.INCI_name || '',
        trade_name: doc.trade_name || '',

        // Functional fields (CRITICAL for filtering and display)
        Function: doc.Function || '',

        // Benefits and use cases
        benefits: Array.isArray(doc.benefits) ? doc.benefits.join(', ') : (doc.benefits || ''),
        usecase: Array.isArray(doc.usecase) ? doc.usecase.join(', ') : (doc.usecase || ''),

        // Supplier info
        supplier: doc.supplier || '',
        rm_cost: doc.rm_cost || 0,

        // Source tracking
        source: 'raw_materials_console',
        namespace: NAMESPACE
      }
    });

    chunks.push(...docChunks);
  }

  return chunks;
}

/**
 * Format document for chunking with ALL relevant fields
 * Updated: 2025-11-08 - Include INCI_name, Function, and Chem_IUPAC_Name_Description
 *
 * These fields are critical for semantic search to work properly:
 * - INCI_name: The standardized ingredient name
 * - Function: PRIMARY functionality (e.g., "ANTI-SEBUM, ANTIOXIDANT")
 * - benefits: Thai language benefits (e.g., "ลดสิว", "ความชุ่มชื้น")
 * - usecase: Product types (e.g., "เซรั่ม", "ครีม")
 * - Chem_IUPAC_Name_Description: Full chemical description
 */
function formatDocumentForChunking(doc: any): string {
  const parts = [
    // Primary identifiers
    `RM Code: ${doc.rm_code || 'N/A'}`,
    doc.INCI_name ? `INCI Name: ${doc.INCI_name}` : '',
    doc.trade_name ? `Trade Name: ${doc.trade_name}` : '',

    // Functional information (CRITICAL for search)
    doc.Function ? `Function: ${doc.Function}` : '',

    // Benefits and use cases (Thai + English)
    doc.benefits && doc.benefits.length > 0 ? `Benefits: ${Array.isArray(doc.benefits) ? doc.benefits.join(', ') : doc.benefits}` : '',
    doc.usecase && doc.usecase.length > 0 ? `Use Cases: ${Array.isArray(doc.usecase) ? doc.usecase.join(', ') : doc.usecase}` : '',

    // Chemical description
    doc.Chem_IUPAC_Name_Description ? `Description: ${doc.Chem_IUPAC_Name_Description}` : '',

    // Supplier and cost info
    doc.supplier ? `Supplier: ${doc.supplier}` : '',
    doc.rm_cost ? `Cost: ${doc.rm_cost}` : ''
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

// Run the indexing
indexRawMaterialsConsole()
  .then(() => {
    console.log('\n🎉 Indexing completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Indexing failed:', error);
    process.exit(1);
  });