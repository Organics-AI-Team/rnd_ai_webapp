/**
 * Unified Collection Migration Script
 * Migrates both MongoDB collections to single Pinecone index with namespaces
 *
 * Collections:
 * 1. raw_materials_real_stock (3,111) → namespace: 'in_stock'
 * 2. raw_materials_console (31,179) → namespace: 'all_fda'
 *
 * Total: 34,290 documents → ~205,740 chunks (6 per document)
 */

import { MongoClient } from 'mongodb';
import { Pinecone } from '@pinecone-database/pinecone';
import { createEmbeddingService } from '@/ai/services/embeddings/universal-embedding-service';
import { DynamicChunkingService } from '@/ai/services/rag/dynamic-chunking-service';

const BATCH_SIZE = 50; // Chunks per batch
const PINECONE_INDEX = 'raw-materials-stock';

interface CollectionConfig {
  name: string;
  namespace: string;
  description: string;
  source_tag: string;
}

const COLLECTIONS: CollectionConfig[] = [
  {
    name: 'raw_materials_real_stock',
    namespace: 'in_stock',
    description: 'Materials currently in stock',
    source_tag: 'raw_materials_real_stock'
  },
  {
    name: 'raw_materials_console',
    namespace: 'all_fda',
    description: 'All FDA-registered ingredients',
    source_tag: 'raw_materials_console'
  }
];

async function migrate_collection(
  collection_config: CollectionConfig,
  mongo_db: any,
  pinecone_index: any,
  embedding_service: any
): Promise<{ docs: number; chunks: number }> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📦 Migrating: ${collection_config.name}`);
  console.log(`   Namespace: ${collection_config.namespace}`);
  console.log(`   ${collection_config.description}`);
  console.log(`${'='.repeat(80)}\n`);

  const collection = mongo_db.collection(collection_config.name);
  const total_docs = await collection.countDocuments();

  console.log(`📊 Total documents: ${total_docs.toLocaleString()}`);
  console.log(`🎯 Expected chunks: ~${(total_docs * 6).toLocaleString()}\n`);

  const cursor = collection.find({});
  let processed_docs = 0;
  let total_chunks = 0;
  let batch: any[] = [];

  const start_time = Date.now();

  const chunking_service = new DynamicChunkingService();

  for await (const doc of cursor) {
    processed_docs++;

    // Create dynamic chunks
    const chunks = chunking_service.chunk_raw_material_document(doc);
    total_chunks += chunks.length;

    // Batch generate embeddings for all chunks of this document (6x faster!)
    const chunk_texts = chunks.map(c => c.text);
    const embeddings = await embedding_service.createEmbeddingsBatch(chunk_texts);

    // Convert chunks to Pinecone vectors
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddings[i];

      batch.push({
        id: `${doc._id}_${chunk.chunk_type}`,
        values: embedding,
        metadata: {
          ...chunk.metadata,
          source: collection_config.source_tag,
          namespace: collection_config.namespace,
          collection: collection_config.name,
          availability: collection_config.namespace === 'in_stock' ? 'in_stock' : 'fda_only'
        }
      });

      // Upload batch when full
      if (batch.length >= BATCH_SIZE) {
        await pinecone_index.namespace(collection_config.namespace).upsert(batch);
        console.log(
          `✅ Uploaded batch (${batch.length} vectors) | ` +
          `Progress: ${processed_docs.toLocaleString()}/${total_docs.toLocaleString()} docs ` +
          `(${((processed_docs / total_docs) * 100).toFixed(1)}%) | ` +
          `Total chunks: ${total_chunks.toLocaleString()}`
        );
        batch = [];
      }
    }
  }

  // Upload remaining batch
  if (batch.length > 0) {
    await pinecone_index.namespace(collection_config.namespace).upsert(batch);
    console.log(`✅ Uploaded final batch (${batch.length} vectors)`);
  }

  const duration = ((Date.now() - start_time) / 1000 / 60).toFixed(2);
  console.log(`\n✅ ${collection_config.name} migration completed!`);
  console.log(`   Documents: ${processed_docs.toLocaleString()}`);
  console.log(`   Chunks: ${total_chunks.toLocaleString()}`);
  console.log(`   Duration: ${duration} minutes\n`);

  return { docs: processed_docs, chunks: total_chunks };
}

async function run_unified_migration(): Promise<void> {
  console.log('🚀 Unified Collection Migration\n');
  console.log('='.repeat(80));
  console.log('📋 Configuration:');
  console.log(`   Pinecone Index: ${PINECONE_INDEX}`);
  console.log(`   Collections: ${COLLECTIONS.length}`);
  console.log(`   Namespaces: ${COLLECTIONS.map(c => c.namespace).join(', ')}`);
  console.log('='.repeat(80));

  // Initialize services
  const mongo_client = new MongoClient(process.env.MONGODB_URI || '');
  await mongo_client.connect();
  const db = mongo_client.db('rnd_ai');

  const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY || '' });
  const pinecone_index = pinecone.index(PINECONE_INDEX);

  const embedding_service = createEmbeddingService();

  console.log('\n✅ Services initialized');
  console.log(`   Embedding provider: ${embedding_service.getProvider()}`);
  console.log(`   Embedding dimensions: ${embedding_service.getDimensions()}`);

  // Migrate each collection
  const results: { [key: string]: { docs: number; chunks: number } } = {};

  for (const collection_config of COLLECTIONS) {
    const result = await migrate_collection(
      collection_config,
      db,
      pinecone_index,
      embedding_service
    );
    results[collection_config.name] = result;
  }

  // Close connections
  await mongo_client.close();

  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 MIGRATION SUMMARY');
  console.log('='.repeat(80));

  let total_docs = 0;
  let total_chunks = 0;

  for (const [collection_name, result] of Object.entries(results)) {
    const config = COLLECTIONS.find(c => c.name === collection_name);
    console.log(`\n${config?.description || collection_name}:`);
    console.log(`  Collection: ${collection_name}`);
    console.log(`  Namespace: ${config?.namespace}`);
    console.log(`  Documents: ${result.docs.toLocaleString()}`);
    console.log(`  Chunks: ${result.chunks.toLocaleString()}`);

    total_docs += result.docs;
    total_chunks += result.chunks;
  }

  console.log('\n' + '-'.repeat(80));
  console.log(`TOTAL DOCUMENTS: ${total_docs.toLocaleString()}`);
  console.log(`TOTAL CHUNKS: ${total_chunks.toLocaleString()}`);
  console.log(`PINECONE INDEX: ${PINECONE_INDEX}`);
  console.log(`NAMESPACES: ${COLLECTIONS.map(c => c.namespace).join(', ')}`);
  console.log('='.repeat(80));
}

// Run migration
run_unified_migration()
  .then(() => {
    console.log('\n✅ Unified migration completed successfully!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration failed:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  });
