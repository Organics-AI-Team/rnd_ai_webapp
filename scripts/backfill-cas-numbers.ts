#!/usr/bin/env npx tsx
/**
 * CAS Number Backfill Script
 *
 * Iterates all raw_materials_console documents, uses Gemini AI with
 * Google Search grounding to look up CAS numbers from ec.europa.eu CosIng,
 * and writes cas_no back into each MongoDB document.
 *
 * Also flags non-ingredient items (packaging, equipment, etc.) by setting
 * is_ingredient=false so they can be filtered out.
 *
 * Usage:
 *   npx tsx scripts/backfill-cas-numbers.ts
 *   npx tsx scripts/backfill-cas-numbers.ts --dry-run     # Preview only, no DB writes
 *   npx tsx scripts/backfill-cas-numbers.ts --skip-existing # Skip docs that already have cas_no
 *
 * Env vars required:
 *   MONGODB_URI, GEMINI_API_KEY
 */

import { MongoClient, ObjectId } from 'mongodb';
import { GoogleGenAI } from '@google/genai';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MONGODB_URI = process.env.MONGODB_URI || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const MONGO_DB = 'rnd_ai';
const CONSOLE_COLLECTION = 'raw_materials_console';
const MYSKIN_COLLECTION = 'raw_materials_myskin';

/** Gemini model for CAS lookup — fast model with good chemistry knowledge */
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

/** Number of ingredients per AI batch call */
const BATCH_SIZE = 20;

/** Number of parallel AI workers */
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '5', 10);

/** Delay between AI calls per worker to respect rate limits (ms) */
const RATE_LIMIT_DELAY_MS = 500;

/** CLI flags */
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_EXISTING = process.argv.includes('--skip-existing');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CasLookupResult {
  rm_code: string;
  cas_no: string;
  is_ingredient: boolean;
  confidence: 'high' | 'medium' | 'low';
  source_note: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format elapsed time in human-readable form.
 *
 * @param seconds - Elapsed time in seconds
 * @returns Formatted string like "2m 30s"
 */
function format_duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * Sleep for given milliseconds.
 *
 * @param ms - Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Build the Gemini prompt for a batch of ingredients.
 * Instructs the AI to look up CAS numbers from EU CosIng database
 * and flag non-ingredient items.
 *
 * @param ingredients - Array of {rm_code, trade_name, inci_name} objects
 * @returns Prompt string for Gemini
 */
function build_cas_lookup_prompt(
  ingredients: Array<{ rm_code: string; trade_name: string; inci_name: string }>
): string {
  const ingredient_list = ingredients
    .map((ing, i) => `${i + 1}. rm_code="${ing.rm_code}" | trade_name="${ing.trade_name}" | inci_name="${ing.inci_name || 'N/A'}"`)
    .join('\n');

  return `You are a cosmetic chemistry expert. For each ingredient below, look up its CAS Registry Number using the EU CosIng database (ec.europa.eu/growth/tools-databases/cosing/) and other authoritative sources.

INGREDIENTS:
${ingredient_list}

For EACH ingredient, provide:
1. The CAS number (e.g., "56-81-5" for Glycerin). Use the most common/primary CAS number.
2. Whether it is a real cosmetic/chemical ingredient (is_ingredient=true) or NOT an ingredient (is_ingredient=false for things like: packaging materials, equipment, tools, services, marketing terms, generic labels like "fragrance blend", "preservative system", or items that are finished products rather than raw ingredients).
3. Confidence level: "high" if you found an exact CAS match, "medium" if approximate, "low" if guessing.
4. A brief source note (e.g., "EU CosIng", "PubChem", "common knowledge").

If a material has NO CAS number (e.g., plant extracts with no single CAS, or mixtures), write "N/A" for cas_no but still set is_ingredient=true if it IS a real ingredient.

IMPORTANT: Respond ONLY with a valid JSON array. No markdown, no code fences, no extra text.

Example response format:
[
  {"rm_code":"RM000001","cas_no":"9003-11-6","is_ingredient":true,"confidence":"high","source_note":"EU CosIng - Poloxamer 188"},
  {"rm_code":"RM000002","cas_no":"56-81-5","is_ingredient":true,"confidence":"high","source_note":"EU CosIng - Glycerin"},
  {"rm_code":"RM000003","cas_no":"N/A","is_ingredient":false,"confidence":"high","source_note":"Not an ingredient - packaging material"}
]

Respond with the JSON array now:`;
}

/**
 * Parse the AI response into structured CAS lookup results.
 * Handles potential JSON parsing issues from Gemini output.
 *
 * @param raw_response - Raw text response from Gemini
 * @param batch_codes  - Expected rm_codes in this batch (for validation)
 * @returns Array of parsed CAS lookup results
 */
function parse_cas_response(
  raw_response: string,
  batch_codes: string[]
): CasLookupResult[] {
  console.log('[backfill] parse_cas_response — parsing AI response...');

  // Strip markdown code fences if present
  let cleaned = raw_response.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) {
      console.warn('[backfill] Response is not an array, wrapping...');
      return [parsed].filter(Boolean);
    }

    // Validate and normalize each result
    return parsed.map((item: any) => ({
      rm_code: item.rm_code || '',
      cas_no: (item.cas_no || 'N/A').trim(),
      is_ingredient: item.is_ingredient !== false, // Default true
      confidence: ['high', 'medium', 'low'].includes(item.confidence) ? item.confidence : 'low',
      source_note: item.source_note || '',
    })).filter((item: CasLookupResult) => batch_codes.includes(item.rm_code));
  } catch (err: any) {
    console.error('[backfill] Failed to parse AI response:', err.message);
    console.error('[backfill] Raw response (first 500 chars):', cleaned.substring(0, 500));
    return [];
  }
}

/**
 * Call Gemini with Google Search grounding to look up CAS numbers
 * for a batch of ingredients.
 *
 * @param ai          - GoogleGenAI client instance
 * @param ingredients - Batch of ingredients to look up
 * @returns Array of CAS lookup results
 */
async function lookup_cas_batch(
  ai: GoogleGenAI,
  ingredients: Array<{ rm_code: string; trade_name: string; inci_name: string }>
): Promise<CasLookupResult[]> {
  const batch_codes = ingredients.map(i => i.rm_code);
  const prompt = build_cas_lookup_prompt(ingredients);

  console.log(`[backfill] Calling Gemini for ${ingredients.length} ingredients...`);

  const call_config = {
    temperature: 0.1, // Low temperature for factual accuracy
  };

  try {
    // Race between API call and timeout
    const timeout_promise = new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error('Gemini API timeout (60s)')), 60000)
    );

    const api_promise = ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: call_config,
    });

    const response = await Promise.race([api_promise, timeout_promise]) as any;

    const raw_text = response.text || '';
    if (!raw_text) {
      console.warn('[backfill] Empty response from Gemini');
      return [];
    }

    return parse_cas_response(raw_text, batch_codes);
  } catch (err: any) {
    console.error(`[backfill] Gemini API error: ${err.message}`);

    // Retry once after delay on rate limit or timeout
    if (err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED') || err.message?.includes('timeout')) {
      const wait_time = err.message?.includes('timeout') ? 5000 : 10000;
      console.log(`[backfill] Rate limited/timeout — waiting ${wait_time / 1000}s and retrying...`);
      await sleep(wait_time);
      try {
        const retry_response = await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: prompt,
          config: call_config,
        });
        return parse_cas_response(retry_response.text || '', batch_codes);
      } catch (retry_err: any) {
        console.error(`[backfill] Retry also failed: ${retry_err.message}`);
        return [];
      }
    }

    return [];
  }
}

// ---------------------------------------------------------------------------
// Pre-fill from MySkin (fast local lookup before AI)
// ---------------------------------------------------------------------------

/**
 * Build a CAS number map from raw_materials_myskin for fast local lookup.
 * This avoids unnecessary AI calls for ingredients that already have
 * a known CAS number in the MySkin collection.
 *
 * @param db - MongoDB Db instance
 * @returns Map from lowercase inci_name to cas_no string
 */
async function build_myskin_cas_map(db: any): Promise<Map<string, string>> {
  console.log('[backfill] Building MySkin CAS map...');
  const docs = await db
    .collection(MYSKIN_COLLECTION)
    .find({ cas_no: { $exists: true, $ne: '' } })
    .project({ inci_name: 1, cas_no: 1 })
    .toArray();

  const cas_map = new Map<string, string>();
  for (const doc of docs) {
    const key = (doc.inci_name || '').toLowerCase().trim();
    if (key && doc.cas_no && !cas_map.has(key)) {
      cas_map.set(key, doc.cas_no);
    }
  }

  console.log(`[backfill] MySkin CAS map built: ${cas_map.size} entries`);
  return cas_map;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('='.repeat(70));
  console.log('[backfill] CAS Number Backfill Script');
  console.log(`[backfill] Mode: ${DRY_RUN ? 'DRY RUN (no DB writes)' : 'LIVE'}`);
  console.log(`[backfill] Skip existing: ${SKIP_EXISTING}`);
  console.log(`[backfill] Batch size: ${BATCH_SIZE}`);
  console.log(`[backfill] Parallel workers: ${CONCURRENCY}`);
  console.log('='.repeat(70));

  if (!MONGODB_URI) throw new Error('Missing MONGODB_URI');
  if (!GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY');

  // --- Connect to MongoDB ---
  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  console.log('[backfill] Connected to MongoDB');

  const db = mongo.db(MONGO_DB);
  const console_col = db.collection(CONSOLE_COLLECTION);

  // --- Count documents ---
  const filter: any = SKIP_EXISTING
    ? { $or: [{ cas_no: { $exists: false } }, { cas_no: '' }, { cas_no: null }] }
    : {};
  const total = await console_col.countDocuments(filter);
  const total_all = await console_col.countDocuments({});
  console.log(`[backfill] Documents to process: ${total} (total in collection: ${total_all})`);

  if (total === 0) {
    console.log('[backfill] No documents to process — exiting');
    await mongo.close();
    return;
  }

  // --- Phase 1: Pre-fill from MySkin (free, no AI cost) ---
  console.log('\n--- Phase 1: Pre-fill from MySkin collection ---');
  const myskin_map = await build_myskin_cas_map(db);

  const all_docs = await console_col.find(filter).toArray();
  let myskin_filled = 0;
  let skipped_no_name = 0;
  const needs_ai_lookup: typeof all_docs = [];

  for (const doc of all_docs) {
    const inci = (doc.INCI_name || doc.inci_name || '').toLowerCase().trim();
    const trade = (doc.trade_name || '').trim();
    const myskin_cas = inci ? myskin_map.get(inci) : undefined;

    if (myskin_cas) {
      // Found in MySkin — update directly, no AI needed
      if (!DRY_RUN) {
        await console_col.updateOne(
          { _id: doc._id },
          { $set: { cas_no: myskin_cas, cas_source: 'myskin_inci_match', is_ingredient: true } }
        );
      }
      myskin_filled++;
      if (myskin_filled % 50 === 0) {
        console.log(`[backfill] MySkin pre-fill: ${myskin_filled} matched so far...`);
      }
    } else if (
      (!trade || trade === 'undefined' || trade === 'null') &&
      (!inci || inci === 'undefined' || inci === 'null' || inci === 'n/a')
    ) {
      // No usable name data — skip AI lookup, mark as unknown
      if (!DRY_RUN) {
        await console_col.updateOne(
          { _id: doc._id },
          { $set: { cas_no: '', cas_source: 'skipped_no_name', is_ingredient: true } }
        );
      }
      skipped_no_name++;
    } else {
      needs_ai_lookup.push(doc);
    }
  }

  console.log(`[backfill] Phase 1 complete: ${myskin_filled} filled from MySkin, ${skipped_no_name} skipped (no name), ${needs_ai_lookup.length} need AI lookup`);

  // --- Phase 2: Parallel AI lookup for remaining ---
  console.log(`\n--- Phase 2: AI lookup via Gemini (${CONCURRENCY} parallel workers) ---`);

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const start_time = Date.now();

  let ai_updated = 0;
  let ai_skipped = 0;
  let ai_errors = 0;
  let non_ingredients = 0;
  let batches_done = 0;

  // Split all docs into batches
  const all_batches: typeof needs_ai_lookup[] = [];
  for (let i = 0; i < needs_ai_lookup.length; i += BATCH_SIZE) {
    all_batches.push(needs_ai_lookup.slice(i, i + BATCH_SIZE));
  }
  const batch_count = all_batches.length;
  console.log(`[backfill] Total batches: ${batch_count}, concurrency: ${CONCURRENCY}`);

  // Shared batch index for worker pool
  let next_batch_idx = 0;

  /**
   * Worker function — grabs batches from shared queue until exhausted.
   * Each worker runs one AI call at a time with a small stagger delay.
   *
   * @param worker_id - Worker identifier for logging
   */
  async function worker(worker_id: number): Promise<void> {
    // Stagger worker start to avoid thundering herd
    await sleep(worker_id * 300);

    while (true) {
      // Atomically grab next batch index
      const batch_idx = next_batch_idx++;
      if (batch_idx >= batch_count) break;

      const batch = all_batches[batch_idx];
      const batch_num = batch_idx + 1;
      const elapsed = (Date.now() - start_time) / 1000;
      const rate = batches_done > 0 ? (batches_done * BATCH_SIZE) / elapsed : 0;
      const eta = rate > 0 ? (needs_ai_lookup.length - batches_done * BATCH_SIZE) / rate : 0;

      console.log(`[W${worker_id}] Batch ${batch_num}/${batch_count} (${batch.length} items) | done: ${batches_done} | ${rate.toFixed(0)} items/min | ETA: ${format_duration(eta)}`);

      // Prepare ingredients for prompt
      const ingredients = batch.map((doc: any) => ({
        rm_code: doc.rm_code || '',
        trade_name: doc.trade_name || '',
        inci_name: doc.INCI_name || doc.inci_name || '',
      }));

      // Call Gemini AI
      const results = await lookup_cas_batch(ai, ingredients);

      if (results.length === 0) {
        console.warn(`[W${worker_id}] Batch ${batch_num}: No results — skipping`);
        ai_errors += batch.length;
        await sleep(RATE_LIMIT_DELAY_MS * 2);
        batches_done++;
        continue;
      }

      // Build a lookup map from AI results
      const result_map = new Map<string, CasLookupResult>();
      for (const r of results) {
        result_map.set(r.rm_code, r);
      }

      // Update MongoDB for each ingredient in this batch
      const update_promises: Promise<any>[] = [];
      for (const doc of batch) {
        const result = result_map.get(doc.rm_code);
        if (!result) {
          ai_skipped++;
          continue;
        }

        const cas_value = result.cas_no === 'N/A' ? '' : result.cas_no;

        if (!DRY_RUN) {
          update_promises.push(
            console_col.updateOne(
              { _id: doc._id },
              {
                $set: {
                  cas_no: cas_value,
                  cas_source: `ai_gemini_${result.confidence}`,
                  cas_confidence: result.confidence,
                  cas_source_note: result.source_note,
                  is_ingredient: result.is_ingredient,
                },
              }
            )
          );
        }

        if (!result.is_ingredient) {
          non_ingredients++;
        }
        ai_updated++;
      }

      // Write all MongoDB updates in parallel
      if (update_promises.length > 0) {
        await Promise.all(update_promises);
      }

      batches_done++;

      // Rate limit delay
      await sleep(RATE_LIMIT_DELAY_MS);
    }

    console.log(`[W${worker_id}] Worker finished`);
  }

  // Launch all workers in parallel
  const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i));
  await Promise.all(workers);

  // --- Summary ---
  const total_elapsed = (Date.now() - start_time) / 1000;
  console.log('\n' + '='.repeat(70));
  console.log('[backfill] COMPLETE');
  console.log('='.repeat(70));
  console.log(`  Total processed:      ${total}`);
  console.log(`  MySkin pre-filled:     ${myskin_filled}`);
  console.log(`  Skipped (no name):     ${skipped_no_name}`);
  console.log(`  AI updated:            ${ai_updated}`);
  console.log(`  AI skipped (no match): ${ai_skipped}`);
  console.log(`  AI errors:             ${ai_errors}`);
  console.log(`  Non-ingredients found: ${non_ingredients}`);
  console.log(`  Total time:            ${format_duration(total_elapsed)}`);
  console.log(`  Mode:                  ${DRY_RUN ? 'DRY RUN (no DB changes made)' : 'LIVE'}`);
  console.log('='.repeat(70));

  await mongo.close();
  console.log('[backfill] MongoDB connection closed');
}

main().catch((err) => {
  console.error('[backfill] Fatal error:', err);
  process.exit(1);
});
