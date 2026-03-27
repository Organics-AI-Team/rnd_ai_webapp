/**
 * Migration Script: Re-index Database with Dynamic Chunking
 *
 * This script re-indexes all raw materials using the new dynamic chunking strategy
 * for improved search accuracy and flexibility.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/migrate-to-dynamic-chunking.ts
 *
 * Features:
 * - Fetches all documents from MongoDB
 * - Creates optimized chunks using DynamicChunkingService
 * - Indexes chunks to Pinecone with improved metadata
 * - Progress tracking and error handling
 * - Dry-run mode for testing
 */

import client_promise from '@rnd-ai/shared-database';
import { PineconeRAGService } from '@/ai/services/rag/qdrant-rag-service';
import { DynamicChunkingService } from '@/ai/services/rag/dynamic-chunking-service';

interface MigrationConfig {
  dry_run: boolean;
  batch_size: number;
  clear_existing: boolean;
  pinecone_index: string;
}

interface MigrationStats {
  total_documents: number;
  total_chunks: number;
  successful_indexes: number;
  failed_indexes: number;
  start_time: number;
  end_time?: number;
  errors: any[];
}

/**
 * Main migration function
 */
async function migrate_to_dynamic_chunking(config: MigrationConfig): Promise<MigrationStats> {
  console.log('🚀 Starting migration to dynamic chunking...');
  console.log('📋 Configuration:', config);

  const stats: MigrationStats = {
    total_documents: 0,
    total_chunks: 0,
    successful_indexes: 0,
    failed_indexes: 0,
    start_time: Date.now(),
    errors: []
  };

  try {
    // Step 1: Initialize services
    console.log('\n📦 Step 1/5: Initializing services...');
    const chunking_service = new DynamicChunkingService({
      max_chunk_size: 500,
      min_chunk_size: 50,
      chunk_overlap: 50,
      semantic_chunking: true
    });

    const rag_service = new PineconeRAGService('rawMaterialsAI', {
      topK: 10,
      similarityThreshold: 0.5,
      includeMetadata: true
    });

    console.log('✅ Services initialized');

    // Step 2: Connect to MongoDB and fetch documents
    console.log('\n📂 Step 2/5: Fetching documents from MongoDB...');
    const mongo_client = await client_promise;
    const db = mongo_client.db();
    const collection = db.collection('raw_materials_real_stock');

    const documents = await collection.find({}).toArray();
    stats.total_documents = documents.length;

    console.log(`✅ Fetched ${documents.length} raw material documents`);

    if (documents.length === 0) {
      console.warn('⚠️ No documents found in MongoDB. Exiting...');
      return stats;
    }

    // Step 3: Clear existing index (if configured)
    if (config.clear_existing && !config.dry_run) {
      console.log('\n🗑️  Step 3/5: Clearing existing index...');
      try {
        const index_stats = await rag_service.getIndexStats();
        console.log('📊 Current index stats:', index_stats);

        // Note: Pinecone doesn't have a simple "clear all" method
        // We would need to delete by IDs or recreate the index
        console.log('⚠️ Manual index clearing required. Skipping...');
      } catch (error) {
        console.error('❌ Error getting index stats:', error);
        stats.errors.push({ step: 'clear_index', error: error.message });
      }
    } else {
      console.log('\n➡️  Step 3/5: Skipping index clearing (not configured or dry-run mode)');
    }

    // Step 4: Process documents and create chunks
    console.log('\n🔨 Step 4/5: Processing documents and creating chunks...');

    const all_chunks = [];

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];

      try {
        console.log(`\n[${i + 1}/${documents.length}] Processing: ${doc.rm_code || doc.trade_name}`);

        // Create chunks for this document
        const chunks = chunking_service.chunk_raw_material_document(doc);
        all_chunks.push(...chunks);

        stats.total_chunks += chunks.length;

        // Show chunk statistics
        const chunk_stats = chunking_service.get_chunk_stats(chunks);
        console.log('  📊 Chunk stats:', {
          total: chunk_stats.total_chunks,
          avg_chars: Math.round(chunk_stats.avg_character_count),
          types: Object.keys(chunk_stats.by_type).join(', ')
        });

        // Show sample chunk
        if (chunks.length > 0) {
          console.log('  📝 Sample chunk:', {
            id: chunks[0].id,
            type: chunks[0].chunk_type,
            text_preview: chunks[0].text.substring(0, 100) + '...',
            priority: chunks[0].priority
          });
        }

      } catch (error) {
        console.error(`  ❌ Error processing document ${doc.rm_code}:`, error.message);
        stats.errors.push({ document: doc.rm_code, error: error.message });
        stats.failed_indexes++;
      }
    }

    console.log(`\n✅ Created ${stats.total_chunks} chunks from ${documents.length} documents`);

    // Show overall statistics
    const overall_stats = chunking_service.get_chunk_stats(all_chunks);
    console.log('\n📊 Overall Chunking Statistics:');
    console.log('  Total chunks:', overall_stats.total_chunks);
    console.log('  Avg character count:', Math.round(overall_stats.avg_character_count));
    console.log('  Chunks by type:', overall_stats.by_type);
    console.log('  Priority distribution:', overall_stats.priority_distribution);

    // Step 5: Index chunks to Pinecone
    console.log('\n📤 Step 5/5: Indexing chunks to Pinecone...');

    if (config.dry_run) {
      console.log('🔒 DRY RUN MODE: Skipping actual indexing');
      console.log('📋 Would have indexed', stats.total_chunks, 'chunks');
    } else {
      // Convert chunks to documents
      const pinecone_documents = chunking_service.chunks_to_documents(all_chunks);

      // Batch upload
      const batch_size = config.batch_size;
      const total_batches = Math.ceil(pinecone_documents.length / batch_size);

      console.log(`📦 Uploading in ${total_batches} batches of ${batch_size}...`);

      for (let batch_index = 0; batch_index < total_batches; batch_index++) {
        const start = batch_index * batch_size;
        const end = Math.min(start + batch_size, pinecone_documents.length);
        const batch = pinecone_documents.slice(start, end);

        try {
          console.log(`  [${batch_index + 1}/${total_batches}] Uploading batch ${batch_index + 1}...`);

          await rag_service.upsertDocuments(batch);

          stats.successful_indexes += batch.length;

          console.log(`  ✅ Batch ${batch_index + 1} uploaded (${batch.length} chunks)`);

          // Progress update
          const progress = Math.round((stats.successful_indexes / pinecone_documents.length) * 100);
          console.log(`  📊 Progress: ${progress}% (${stats.successful_indexes}/${pinecone_documents.length})`);

        } catch (error) {
          console.error(`  ❌ Error uploading batch ${batch_index + 1}:`, error.message);
          stats.errors.push({ batch: batch_index + 1, error: error.message });
          stats.failed_indexes += batch.length;
        }

        // Rate limiting: wait 1 second between batches
        if (batch_index < total_batches - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      console.log(`\n✅ Indexing complete: ${stats.successful_indexes} chunks indexed successfully`);
    }

  } catch (error) {
    console.error('\n❌ Migration failed with error:', error);
    stats.errors.push({ step: 'main', error: error.message, stack: error.stack });
  }

  stats.end_time = Date.now();

  return stats;
}

/**
 * Print final statistics
 */
function print_final_stats(stats: MigrationStats): void {
  const duration_seconds = ((stats.end_time || Date.now()) - stats.start_time) / 1000;

  console.log('\n' + '='.repeat(80));
  console.log('📊 MIGRATION COMPLETE - FINAL STATISTICS');
  console.log('='.repeat(80));
  console.log('\n📈 Summary:');
  console.log(`  Total documents processed: ${stats.total_documents}`);
  console.log(`  Total chunks created: ${stats.total_chunks}`);
  console.log(`  Avg chunks per document: ${(stats.total_chunks / stats.total_documents).toFixed(2)}`);
  console.log(`  Successfully indexed: ${stats.successful_indexes}`);
  console.log(`  Failed indexes: ${stats.failed_indexes}`);
  console.log(`  Duration: ${duration_seconds.toFixed(2)} seconds`);

  if (stats.errors.length > 0) {
    console.log(`\n⚠️  Errors encountered: ${stats.errors.length}`);
    console.log('  First 5 errors:');
    stats.errors.slice(0, 5).forEach((err, idx) => {
      console.log(`    ${idx + 1}. ${JSON.stringify(err)}`);
    });
  } else {
    console.log('\n✅ No errors encountered!');
  }

  console.log('\n' + '='.repeat(80));
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);

  const config: MigrationConfig = {
    dry_run: args.includes('--dry-run'),
    batch_size: parseInt(args.find(arg => arg.startsWith('--batch-size='))?.split('=')[1] || '50'),
    clear_existing: args.includes('--clear'),
    pinecone_index: args.find(arg => arg.startsWith('--index='))?.split('=')[1] || 'raw-materials-stock'
  };

  console.log('🎬 Starting migration script...\n');

  if (config.dry_run) {
    console.log('🔒 DRY RUN MODE ENABLED - No data will be modified\n');
  }

  const stats = await migrate_to_dynamic_chunking(config);

  print_final_stats(stats);

  console.log('\n✨ Migration script finished!');
  console.log('\n💡 Next steps:');
  console.log('  1. Verify chunks in Pinecone dashboard');
  console.log('  2. Test search queries with new chunking');
  console.log('  3. Monitor search accuracy improvements');
  console.log('  4. Adjust chunk configuration if needed\n');

  process.exit(stats.errors.length > 0 ? 1 : 0);
}

// Run migration
main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
