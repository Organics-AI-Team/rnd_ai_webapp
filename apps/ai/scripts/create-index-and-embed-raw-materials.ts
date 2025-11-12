/**
 * Create Pinecone Index and Embed raw_materials_console Data
 * Fresh start with new index and clean data
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
const DIMENSIONS = 768; // Gemini embedding dimensions

interface MaterialDocument {
  _id: any;
  rm_code: string;
  trade_name: string;
  supplier: string;
  rm_cost: number;
  benefits: string[] | string;
  usecase: string[] | string;
  benefits_cached: string[] | string;
  usecase_cached: string[] | string;
  createdAt: Date;
  updatedAt: Date;
}

async function createIndexAndEmbed() {
  console.log('🚀 Creating fresh Pinecone index and embedding raw_materials_console data...\n');
  console.log('📊 Collection:', COLLECTION_NAME);
  console.log('🗂️  New Pinecone Index:', PINECONE_INDEX);
  console.log('📛 Namespace:', NAMESPACE);
  console.log(`📏 Dimensions: ${DIMENSIONS}`);
  console.log('');

  // Initialize services
  const mongoClient = new MongoClient(process.env.MONGODB_URI || '');
  const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY || '' });

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

    // Check if index exists, create if not
    console.log(`\n🔍 Checking Pinecone index: ${PINECONE_INDEX}`);
    const indexList = await pinecone.listIndexes();
    const indexExists = indexList.indexes?.some(idx => idx.name === PINECONE_INDEX);

    if (!indexExists) {
      console.log(`📝 Creating new Pinecone index: ${PINECONE_INDEX}`);
      await pinecone.createIndex({
        name: PINECONE_INDEX,
        dimension: DIMENSIONS,
        metric: 'cosine',
        spec: {
          serverless: {
            cloud: 'aws',
            region: 'us-east-1'
          }
        }
      });
      console.log('✅ Index created');
    } else {
      console.log('✅ Index already exists');
    }

    // Get the index instance
    const index = pinecone.index(PINECONE_INDEX);

    // Wait for index to be ready
    console.log('⏳ Waiting for index to be ready...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Process documents in batches
    let processed = 0;
    let totalChunks = 0;

    const cursor = collection.find({}).batchSize(DOCUMENT_BATCH_SIZE);
    let batch: MaterialDocument[] = [];

    console.log(`\n📦 Starting embedding process with batch size: ${DOCUMENT_BATCH_SIZE}`);
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

    // Wait for final indexing to complete
    console.log('\n⏳ Waiting for Pinecone to complete indexing...');
    await new Promise(resolve => setTimeout(resolve, 10000));

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

      if (finalStats.namespaces && finalStats.namespaces[NAMESPACE]) {
        console.log(`📈 Namespace ${NAMESPACE}: ${finalStats.namespaces[NAMESPACE].recordCount} vectors`);
      }
    } catch (err) {
      console.log('⚠️ Could not get final Pinecone stats');
    }

    console.log('\n🎉 Ready for AI search! Your raw materials data is now indexed in Pinecone.');

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
    const docChunks = chunkingService.chunk_raw_material_document({
      ...doc,
      text: documentText
    });

    // Convert chunks to expected format with proper metadata
    const formattedChunks = docChunks.map(chunk => ({
      text: chunk.text,
      metadata: {
        ...chunk.metadata,
        documentId: doc.rm_code,
        source: 'raw_materials_console',
        namespace: NAMESPACE
      }
    }));

    chunks.push(...formattedChunks);
  }

  return chunks;
}

function formatDocumentForChunking(doc: MaterialDocument): string {
  const parts = [
    `RM Code: ${doc.rm_code}`,
    `Trade Name: ${doc.trade_name}`,
    `Supplier: ${doc.supplier}`,
    `Cost: ${doc.rm_cost}`,
    formatArrayField(doc.benefits, 'Benefits'),
    formatArrayField(doc.usecase, 'Use Cases')
  ].filter(Boolean);

  return parts.join('\n');
}

function formatArrayField(field: string[] | string, label: string): string {
  if (!field) return '';

  const benefits = Array.isArray(field) ? field :
                (typeof field === 'string' ? field : String(field));

  if (benefits && benefits.length > 0) {
    const cleanBenefits = Array.isArray(benefits) ? benefits : [benefits];
    return `${label}: ${cleanBenefits.join(', ')}`;
  }

  return '';
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
createIndexAndEmbed()
  .then(() => {
    console.log('\n🎉 Indexing completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Indexing failed:', error);
    process.exit(1);
  });