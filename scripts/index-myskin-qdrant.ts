#!/usr/bin/env npx tsx
/**
 * MySkin Qdrant Indexing Script (standalone)
 * Reads 4,652 MySkin docs from MongoDB, embeds them via Gemini,
 * and upserts into Qdrant collection raw_materials_myskin.
 *
 * Usage:
 *   npx tsx scripts/index-myskin-qdrant.ts
 *
 * Env vars required:
 *   MONGODB_URI, GEMINI_API_KEY, QDRANT_URL
 */

import { MongoClient } from 'mongodb';
import { QdrantClient } from '@qdrant/js-client-rest';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MONGODB_URI = process.env.MONGODB_URI || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || undefined;

const MONGO_DB = 'rnd_ai';
const MONGO_COLLECTION = 'raw_materials_myskin';
const QDRANT_COLLECTION = 'raw_materials_myskin';
const BATCH_SIZE = 50;
const EMBEDDING_MODEL = 'text-embedding-004';
const VECTOR_SIZE = 768;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build embedding text from a MySkin document.
 * Combines key fields for semantic representation.
 *
 * @param doc - MongoDB document
 * @returns Concatenated text for embedding
 */
function build_embed_text(doc: any): string {
  const parts = [
    doc.trade_name || '',
    doc.inci_name || '',
    doc.category || '',
    doc.benefits || '',
    doc.details || '',
  ].filter(Boolean);
  return parts.join(' | ');
}

/**
 * Format elapsed time.
 *
 * @param seconds - Elapsed seconds
 * @returns Human-readable duration
 */
function format_duration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${s}s`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('[index-myskin] Starting MySkin Qdrant indexing...');
  console.log(`[index-myskin] QDRANT_URL: ${QDRANT_URL}`);
  console.log(`[index-myskin] MONGO_DB: ${MONGO_DB}.${MONGO_COLLECTION}`);

  if (!MONGODB_URI) throw new Error('Missing MONGODB_URI');
  if (!GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY');

  // --- Connect to MongoDB ---
  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const collection = mongo.db(MONGO_DB).collection(MONGO_COLLECTION);
  const total = await collection.countDocuments();
  console.log(`[index-myskin] Total documents: ${total}`);

  if (total === 0) {
    console.log('[index-myskin] No documents found — exiting');
    await mongo.close();
    return;
  }

  // --- Connect to Qdrant ---
  const qdrant = new QdrantClient({
    url: QDRANT_URL,
    apiKey: QDRANT_API_KEY,
  });

  // Verify collection exists
  try {
    const info = await qdrant.getCollection(QDRANT_COLLECTION);
    console.log(`[index-myskin] Qdrant collection: ${QDRANT_COLLECTION} (${info.points_count} existing points)`);
  } catch (err: any) {
    console.log(`[index-myskin] Creating Qdrant collection: ${QDRANT_COLLECTION}`);
    await qdrant.createCollection(QDRANT_COLLECTION, {
      vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
      hnsw_config: { m: 16, ef_construct: 128, full_scan_threshold: 10000 },
      on_disk_payload: true,
    });
  }

  // --- Init Gemini Embedding ---
  const genai = new GoogleGenerativeAI(GEMINI_API_KEY);
  const embedding_model = genai.getGenerativeModel({ model: EMBEDDING_MODEL });

  // --- Process in batches ---
  const cursor = collection.find({}).batchSize(BATCH_SIZE);
  let batch: any[] = [];
  let processed = 0;
  let errors = 0;
  const start_time = Date.now();

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    if (!doc) continue;
    batch.push(doc);

    if (batch.length >= BATCH_SIZE) {
      const result = await process_batch(batch, qdrant, embedding_model, processed, total, start_time);
      processed += result.success;
      errors += result.errors;
      batch = [];

      // Rate limit: 1s between batches to avoid Gemini API limits
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Process remaining
  if (batch.length > 0) {
    const result = await process_batch(batch, qdrant, embedding_model, processed, total, start_time);
    processed += result.success;
    errors += result.errors;
  }

  await cursor.close();
  await mongo.close();

  const elapsed = (Date.now() - start_time) / 1000;
  console.log(`\n[index-myskin] ✅ DONE`);
  console.log(`[index-myskin] Processed: ${processed}/${total} | Errors: ${errors} | Time: ${format_duration(elapsed)}`);

  // Verify
  const final_info = await qdrant.getCollection(QDRANT_COLLECTION);
  console.log(`[index-myskin] Qdrant points: ${final_info.points_count}`);
}

/**
 * Process a batch of documents: embed + upsert to Qdrant.
 *
 * @param batch - Array of MongoDB documents
 * @param qdrant - Qdrant client
 * @param model - Gemini embedding model
 * @param processed_so_far - Running count
 * @param total - Total doc count
 * @param start_time - Start timestamp
 * @returns Success/error counts
 */
async function process_batch(
  batch: any[],
  qdrant: QdrantClient,
  model: any,
  processed_so_far: number,
  total: number,
  start_time: number,
): Promise<{ success: number; errors: number }> {
  try {
    // Build texts for embedding
    const texts = batch.map(build_embed_text);

    // Batch embed via Gemini
    const embed_result = await model.embedContent({
      content: { parts: texts.map(t => ({ text: t })) },
    });

    // Handle both single and batch embedding responses
    let vectors: number[][];
    if (embed_result.embedding) {
      // Single embedding result — need to call individually
      const individual_results = await Promise.all(
        texts.map(async (text: string) => {
          const r = await model.embedContent({ content: { parts: [{ text }] } });
          return r.embedding.values;
        }),
      );
      vectors = individual_results;
    } else {
      vectors = [embed_result.embedding.values];
    }

    // Build Qdrant points
    const points = batch.map((doc, i) => ({
      id: uuidv4(),
      vector: vectors[i] || vectors[0],
      payload: {
        rm_code: doc.rm_code || '',
        trade_name: doc.trade_name || '',
        inci_name: doc.inci_name || '',
        supplier: doc.supplier || doc.company_name || '',
        category: doc.category || '',
        benefits: doc.benefits || '',
        details: doc.details || '',
        cas_no: doc.cas_no || '',
        ec_no: doc.ec_no || '',
        rm_cost: doc.rm_cost || 0,
        usage_min_pct: doc.usage_min_pct || 0,
        usage_max_pct: doc.usage_max_pct || 0,
        url: doc.url || '',
        text: build_embed_text(doc),
        source: 'myskin',
        indexed_at: new Date().toISOString(),
      },
    }));

    // Upsert to Qdrant
    await qdrant.upsert(QDRANT_COLLECTION, { points });

    const new_processed = processed_so_far + batch.length;
    const elapsed = (Date.now() - start_time) / 1000;
    const rate = elapsed > 0 ? new_processed / elapsed : 0;
    const pct = ((new_processed / total) * 100).toFixed(1);
    const eta = rate > 0 ? (total - new_processed) / rate : 0;
    console.log(
      `[index-myskin] ${new_processed}/${total} (${pct}%) | ${rate.toFixed(1)} docs/s | ETA: ${format_duration(eta)}`,
    );

    return { success: batch.length, errors: 0 };
  } catch (err: any) {
    console.error(`[index-myskin] Batch error:`, err.message);
    return { success: 0, errors: batch.length };
  }
}

main().catch(console.error);
