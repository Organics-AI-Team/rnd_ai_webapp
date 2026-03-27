/**
 * Qdrant Re-Indexing Script
 *
 * Reads raw materials from MongoDB and indexes them into Qdrant
 * via QdrantRAGService (embedding generation + vector upsert).
 *
 * Index targets:
 *   1. rnd_ai.raw_materials_console → Qdrant raw_materials_fda  (RAG: rawMaterialsAllAI)
 *   2. raw_materials.raw_materials_real_stock → Qdrant raw_materials_stock (RAG: rawMaterialsAI)
 *
 * Environment Variables:
 *   - MONGODB_URI                          — connection string for rnd_ai database (required)
 *   - RAW_MATERIALS_REAL_STOCK_MONGODB_URI — connection string for raw_materials database
 *                                            (falls back to MONGODB_URI when not set)
 *   - BATCH_SIZE                           — documents per batch (default 50)
 *   - GEMINI_API_KEY                       — required for embedding generation
 *   - QDRANT_URL                           — Qdrant server URL
 *   - QDRANT_API_KEY                       — optional Qdrant auth key
 *
 * Usage:
 *   npx tsx apps/ai/scripts/index-qdrant.ts [--collection <name>] [--batch-size <n>]
 *
 * @author AI Management System
 * @date 2026-03-27
 */

import { MongoClient } from 'mongodb';
import { QdrantRAGService } from '../services/rag/qdrant-rag-service';
import { get_qdrant_service } from '../services/vector/qdrant-service';
import { QDRANT_COLLECTIONS } from '../config/qdrant-config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Known RAG service names that map to Qdrant collections.
 * Each key selects both the embedding defaults and the target collection
 * inside QdrantRAGService.
 */
type RagServiceName = 'rawMaterialsAllAI' | 'rawMaterialsAI' | 'salesRndAI' | 'rawMaterialsMySkinAI';

/**
 * Definition of a single indexing target mapping MongoDB source to Qdrant collection.
 *
 * @param name              - Human-readable label for progress logs
 * @param mongo_db          - MongoDB database name
 * @param mongo_collection  - MongoDB collection name
 * @param mongo_uri_env     - Environment variable name holding the MongoDB connection string
 * @param qdrant_collection - Target Qdrant collection name
 * @param rag_service_name  - RAG service key (maps to collection + defaults in QdrantRAGService)
 */
interface IndexTarget {
  name: string;
  mongo_db: string;
  mongo_collection: string;
  mongo_uri_env: string;
  qdrant_collection: string;
  rag_service_name: RagServiceName;
}

// ---------------------------------------------------------------------------
// Index Target Definitions
// ---------------------------------------------------------------------------

const INDEX_TARGETS: IndexTarget[] = [
  {
    name: 'FDA Raw Materials',
    mongo_db: 'rnd_ai',
    mongo_collection: 'raw_materials_console',
    mongo_uri_env: 'MONGODB_URI',
    qdrant_collection: 'raw_materials_fda',
    rag_service_name: 'rawMaterialsAllAI',
  },
  {
    name: 'Stock Raw Materials',
    mongo_db: 'raw_materials',
    mongo_collection: 'raw_materials_real_stock',
    // Falls back to MONGODB_URI when the dedicated env var is not set
    mongo_uri_env: 'RAW_MATERIALS_REAL_STOCK_MONGODB_URI',
    qdrant_collection: 'raw_materials_stock',
    rag_service_name: 'rawMaterialsAI',
  },
  {
    name: 'Sales R&D Intelligence',
    mongo_db: 'raw_materials',
    mongo_collection: 'raw_materials_real_stock',
    // Same source collection as stock, but indexed with salesRndAI service
    // for sales-oriented search (different embedding context / metadata)
    mongo_uri_env: 'RAW_MATERIALS_REAL_STOCK_MONGODB_URI',
    qdrant_collection: 'sales_rnd',
    rag_service_name: 'salesRndAI',
  },
  {
    name: 'MySkin Raw Materials',
    mongo_db: 'rnd_ai',
    mongo_collection: 'raw_materials_myskin',
    mongo_uri_env: 'MONGODB_URI',
    qdrant_collection: 'raw_materials_myskin',
    rag_service_name: 'rawMaterialsMySkinAI',
  },
];

// ---------------------------------------------------------------------------
// CLI Argument Parsing
// ---------------------------------------------------------------------------

/**
 * Parse command-line arguments for --collection and --batch-size flags.
 *
 * @returns Object with optional collection filter and batch_size override
 */
function parse_cli_args(): { collection_filter: string | null; batch_size: number } {
  console.log('[index-qdrant] parse_cli_args — start');

  const args = process.argv.slice(2);
  let collection_filter: string | null = null;
  let batch_size = parseInt(process.env.BATCH_SIZE || '50', 10);

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--collection' && args[i + 1]) {
      collection_filter = args[i + 1];
      i++;
    } else if (args[i] === '--batch-size' && args[i + 1]) {
      const parsed = parseInt(args[i + 1], 10);
      if (!isNaN(parsed) && parsed > 0) {
        batch_size = parsed;
      }
      i++;
    }
  }

  console.log('[index-qdrant] parse_cli_args — done', { collection_filter, batch_size });
  return { collection_filter, batch_size };
}

// ---------------------------------------------------------------------------
// Progress Tracker
// ---------------------------------------------------------------------------

/**
 * Format elapsed seconds into a human-readable string (e.g. "2m 30s").
 *
 * @param seconds - Total seconds to format
 * @returns Formatted duration string
 */
function format_duration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining_seconds = Math.floor(seconds % 60);
  return `${minutes}m ${remaining_seconds}s`;
}

/**
 * Log progress for the current indexing operation.
 *
 * @param processed  - Number of documents processed so far
 * @param total      - Total number of documents to process
 * @param start_time - Timestamp (ms) when processing started
 * @param label      - Human-readable target label for log prefix
 */
function log_progress(processed: number, total: number, start_time: number, label: string): void {
  const elapsed_seconds = (Date.now() - start_time) / 1000;
  const rate = elapsed_seconds > 0 ? processed / elapsed_seconds : 0;
  const remaining = total - processed;
  const eta_seconds = rate > 0 ? remaining / rate : 0;
  const progress_pct = total > 0 ? ((processed / total) * 100).toFixed(1) : '0.0';

  console.log(
    `[${label}] ${processed.toLocaleString()}/${total.toLocaleString()} ` +
    `(${progress_pct}%) | ` +
    `${rate.toFixed(1)} docs/s | ` +
    `ETA: ${format_duration(eta_seconds)}`,
  );
}

// ---------------------------------------------------------------------------
// Single Target Indexing
// ---------------------------------------------------------------------------

/**
 * Index a single MongoDB collection into a Qdrant collection.
 *
 * Streams documents via a cursor with batchSize, delegates embedding
 * and upsert to QdrantRAGService.batch_process_documents, and reports
 * progress after each batch.
 *
 * @param target     - IndexTarget defining source and destination
 * @param batch_size - Number of documents per batch
 * @returns Object with processed count and elapsed time in seconds
 */
async function index_target(
  target: IndexTarget,
  batch_size: number,
): Promise<{ processed: number; elapsed_seconds: number }> {
  console.log(`[index-qdrant] index_target — start`, { target: target.name, batch_size });

  // Resolve MongoDB URI: use dedicated env var, fall back to MONGODB_URI
  const mongodb_uri =
    (process.env[target.mongo_uri_env] ?? '') ||
    process.env.MONGODB_URI ||
    '';

  if (!mongodb_uri) {
    console.error(
      `[index-qdrant] Missing env var: ${target.mongo_uri_env} (and MONGODB_URI) — skipping ${target.name}`,
    );
    return { processed: 0, elapsed_seconds: 0 };
  }

  const mongo_client = new MongoClient(mongodb_uri);

  try {
    // Connect to MongoDB
    await mongo_client.connect();
    const safe_host = mongodb_uri.split('@')[1]?.split('/')[0] || 'localhost';
    console.log(`[${target.name}] MongoDB connected — ${safe_host}`);

    const db = mongo_client.db(target.mongo_db);
    const mongo_collection = db.collection(target.mongo_collection);
    const total = await mongo_collection.countDocuments();
    console.log(`[${target.name}] Total documents: ${total.toLocaleString()}`);

    if (total === 0) {
      console.log(`[${target.name}] No documents found — skipping`);
      return { processed: 0, elapsed_seconds: 0 };
    }

    // Create QdrantRAGService for this target's collection
    const rag_service = new QdrantRAGService(
      target.rag_service_name as any,
      { collectionName: target.qdrant_collection },
    );

    // Stream through cursor
    const cursor = mongo_collection.find({}).batchSize(batch_size);
    let batch: Record<string, unknown>[] = [];
    let processed = 0;
    const start_time = Date.now();

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      if (!doc) continue;

      batch.push(doc as Record<string, unknown>);

      if (batch.length >= batch_size) {
        try {
          await rag_service.batch_process_documents(batch, batch_size);
          processed += batch.length;
          log_progress(processed, total, start_time, target.name);
        } catch (error) {
          console.error(`[${target.name}] Batch error at offset ${processed}:`, error);
        }
        batch = [];
      }
    }

    // Process remaining documents in the last partial batch
    if (batch.length > 0) {
      try {
        await rag_service.batch_process_documents(batch, batch_size);
        processed += batch.length;
        log_progress(processed, total, start_time, target.name);
      } catch (error) {
        console.error(`[${target.name}] Final batch error:`, error);
      }
    }

    await cursor.close();
    const elapsed_seconds = (Date.now() - start_time) / 1000;

    console.log(`[index-qdrant] index_target — done`, {
      target: target.name,
      processed,
      elapsed: format_duration(elapsed_seconds),
    });

    return { processed, elapsed_seconds };
  } finally {
    await mongo_client.close();
    console.log(`[${target.name}] MongoDB connection closed`);
  }
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify indexed point counts in Qdrant for all targeted collections.
 *
 * @param targets - Array of IndexTarget to verify
 */
async function verify_collections(targets: IndexTarget[]): Promise<void> {
  console.log('[index-qdrant] verify_collections — start');

  const qdrant_service = get_qdrant_service();
  await qdrant_service.ensure_initialised();

  for (const target of targets) {
    try {
      const info = await qdrant_service.get_collection_info(target.qdrant_collection);
      console.log(
        `[Verify] ${target.qdrant_collection}: ${info.pointsCount.toLocaleString()} points | status: ${info.status}`,
      );
    } catch (error) {
      console.error(`[Verify] Failed to read ${target.qdrant_collection}:`, error);
    }
  }

  console.log('[index-qdrant] verify_collections — done');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Main entry point. Orchestrates:
 *   1. CLI arg parsing
 *   2. Qdrant collection provisioning
 *   3. Sequential indexing of each target
 *   4. Verification of point counts
 *
 * Exits with code 0 on success, 1 on failure.
 */
async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Qdrant Re-Indexing Script');
  console.log('MongoDB → Embeddings → Qdrant');
  console.log('='.repeat(60));
  console.log('');

  // Validate required environment variables before proceeding
  if (!process.env.MONGODB_URI) {
    console.error('[index-qdrant] MONGODB_URI is not set. Aborting.');
    process.exit(1);
  }

  const { collection_filter, batch_size } = parse_cli_args();

  // Determine which targets to process
  let targets = INDEX_TARGETS;
  if (collection_filter) {
    targets = INDEX_TARGETS.filter(
      (t) => t.qdrant_collection === collection_filter || t.name === collection_filter,
    );
    if (targets.length === 0) {
      const available = INDEX_TARGETS.map((t) => t.qdrant_collection).join(', ');
      console.error(
        `[index-qdrant] Unknown collection: "${collection_filter}". Available: ${available}`,
      );
      process.exit(1);
    }
  }

  console.log('Configuration:');
  console.log(`  Batch size: ${batch_size}`);
  console.log(`  Targets: ${targets.map((t) => t.qdrant_collection).join(', ')}`);
  console.log('');

  // Ensure all Qdrant collections exist before indexing
  console.log('Ensuring Qdrant collections exist...');
  const qdrant_service = get_qdrant_service();
  await qdrant_service.ensure_initialised();
  await qdrant_service.ensure_all_collections();
  console.log('All Qdrant collections ready.\n');

  // Process each target sequentially
  const results: { name: string; processed: number; elapsed_seconds: number }[] = [];
  const global_start = Date.now();

  for (const target of targets) {
    console.log('');
    console.log('-'.repeat(60));
    console.log(`Indexing: ${target.name}`);
    console.log(`  Source: ${target.mongo_db}.${target.mongo_collection}`);
    console.log(`  Destination: Qdrant ${target.qdrant_collection}`);
    console.log('-'.repeat(60));

    const result = await index_target(target, batch_size);
    results.push({ name: target.name, ...result });
  }

  // Verification pass
  console.log('\n' + '='.repeat(60));
  console.log('Verification');
  console.log('='.repeat(60));
  await verify_collections(targets);

  // Summary
  const global_elapsed = (Date.now() - global_start) / 1000;
  const total_processed = results.reduce((sum, r) => sum + r.processed, 0);

  console.log('\n' + '='.repeat(60));
  console.log('COMPLETED');
  console.log('='.repeat(60));
  for (const r of results) {
    console.log(`  ${r.name}: ${r.processed.toLocaleString()} docs in ${format_duration(r.elapsed_seconds)}`);
  }
  console.log(`  Total: ${total_processed.toLocaleString()} docs`);
  console.log(`  Total time: ${format_duration(global_elapsed)}`);
  console.log('='.repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n[index-qdrant] Fatal error:', error);
    process.exit(1);
  });
