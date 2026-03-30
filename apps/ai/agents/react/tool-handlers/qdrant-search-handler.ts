/**
 * Qdrant Search Tool Handler
 * Handles the `qdrant_search` ReAct tool by generating a query embedding,
 * building a Qdrant must-match filter from optional params.filters,
 * calling the QdrantService, and formatting results into a readable string.
 *
 * @author AI Management System
 * @date 2026-03-27
 */

import { get_qdrant_service } from '../../../services/vector/qdrant-service';
import { createEmbeddingService } from '../../../services/embeddings/universal-embedding-service';
import { get_search_defaults } from '../../../config/qdrant-config';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum top_k cap to prevent excessively large result sets */
const MAX_TOP_K = 20;

/** Default score threshold when not specified by caller or collection defaults */
const FALLBACK_SCORE_THRESHOLD = 0.55;

/**
 * Payload fields actually used by format_result().
 * Projected via Qdrant's withPayload.include to reduce bandwidth ~10-20%.
 */
const PROJECTED_PAYLOAD_FIELDS = [
  'rm_code', 'code',
  'trade_name', 'tradeName',
  'inci_name', 'INCI_name', 'inci',
  'supplier',
  'cost',
  'benefits', 'Function', 'function',
  'stock_status', 'stockStatus',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Input parameters for the qdrant_search tool handler.
 *
 * @param query            - Natural-language search query string
 * @param collection       - Target Qdrant collection name
 * @param top_k            - Max results to return (default: collection default or 5, capped at 20)
 * @param score_threshold  - Minimum cosine similarity score (default: collection default or 0.55)
 * @param filters          - Optional key/value pairs to build Qdrant must-match filter conditions
 */
interface QdrantSearchParams {
  query: string;
  collection: string;
  top_k?: number;
  score_threshold?: number;
  filters?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Filter Builder
// ---------------------------------------------------------------------------

/**
 * Convert a plain key/value filter map into a Qdrant `must` filter clause.
 * Each entry becomes a `{ key, match: { value } }` condition inside `must[]`.
 *
 * @param filters - Plain object mapping payload field names to expected values
 * @returns Qdrant filter object `{ must: [...] }`, or undefined when filters is empty/null
 */
function build_qdrant_filter(
  filters: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  console.log('[qdrant-search-handler] build_qdrant_filter — start', {
    filter_count: filters ? Object.keys(filters).length : 0,
  });

  if (!filters || Object.keys(filters).length === 0) {
    console.log('[qdrant-search-handler] build_qdrant_filter — no filters, returning undefined');
    return undefined;
  }

  const must_conditions = Object.entries(filters).map(([key, value]) => ({
    key,
    match: { value },
  }));

  const result = { must: must_conditions };

  console.log('[qdrant-search-handler] build_qdrant_filter — done', {
    must_count: must_conditions.length,
  });

  return result;
}

// ---------------------------------------------------------------------------
// Result Formatter
// ---------------------------------------------------------------------------

/**
 * Format a single Qdrant search result payload into a human-readable line.
 * Extracts key fields: score, rm_code, trade_name, inci_name, supplier, cost,
 * benefits/function, and stock_status.
 *
 * @param index   - 1-based result index for display numbering
 * @param score   - Cosine similarity score (0-1)
 * @param payload - Raw Qdrant payload object for the matched point
 * @returns Formatted multi-line string for this result
 */
function format_result(
  index: number,
  score: number,
  payload: Record<string, unknown>,
): string {
  const score_pct = (score * 100).toFixed(1);
  const code = String(payload.rm_code ?? payload.code ?? 'N/A');
  const trade_name = String(payload.trade_name ?? payload.tradeName ?? 'N/A');
  const inci = String(payload.inci_name ?? payload.INCI_name ?? payload.inci ?? 'N/A');
  const supplier = String(payload.supplier ?? 'N/A');
  const cost = payload.cost !== undefined ? `${payload.cost} THB/kg` : 'N/A';
  const benefits = String(payload.benefits ?? payload.Function ?? payload.function ?? 'N/A');
  const stock_status = String(payload.stock_status ?? payload.stockStatus ?? 'N/A');

  return [
    `[${index}] Score: ${score_pct}%`,
    `    Code: ${code}`,
    `    Trade Name: ${trade_name}`,
    `    INCI: ${inci}`,
    `    Supplier: ${supplier}`,
    `    Cost: ${cost}`,
    `    Benefits/Function: ${benefits}`,
    `    Stock Status: ${stock_status}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Main Handler
// ---------------------------------------------------------------------------

/**
 * Handle the `qdrant_search` ReAct tool call.
 *
 * Workflow:
 * 1. Validate required params (query, collection)
 * 2. Resolve top_k and score_threshold (params > collection defaults > fallbacks)
 * 3. Generate query embedding via UniversalEmbeddingService
 * 4. Build Qdrant filter from params.filters (must-match per field)
 * 5. Call QdrantService.search() with merged options
 * 6. Format results into a structured string for the LLM
 *
 * @param params - QdrantSearchParams containing query, collection, and optional overrides
 * @returns Formatted string of search results or an error message
 * @throws Never throws directly — errors are caught and returned as descriptive strings
 */
export async function handle_qdrant_search(params: QdrantSearchParams): Promise<string> {
  const start_ts = Date.now();
  console.log('[qdrant-search-handler] handle_qdrant_search — start', {
    query: params.query,
    collection: params.collection,
    top_k: params.top_k,
    score_threshold: params.score_threshold,
    has_filters: !!params.filters,
  });

  // --- Validation ---
  if (!params.query || !params.query.trim()) {
    console.log('[qdrant-search-handler] handle_qdrant_search — error: missing query');
    return 'Error: query parameter is required and must not be empty.';
  }
  if (!params.collection || !params.collection.trim()) {
    console.log('[qdrant-search-handler] handle_qdrant_search — error: missing collection');
    return 'Error: collection parameter is required.';
  }

  try {
    // --- Resolve search defaults ---
    let collection_defaults;
    try {
      collection_defaults = get_search_defaults(params.collection);
    } catch {
      // Collection may not have registered defaults; use fallback values
      collection_defaults = { top_k: 5, score_threshold: FALLBACK_SCORE_THRESHOLD };
    }

    const top_k = Math.min(params.top_k ?? collection_defaults.top_k ?? 5, MAX_TOP_K);
    const score_threshold =
      params.score_threshold ?? collection_defaults.score_threshold ?? FALLBACK_SCORE_THRESHOLD;

    console.log('[qdrant-search-handler] handle_qdrant_search — resolved params', {
      top_k,
      score_threshold,
    });

    // --- Generate query embedding ---
    const embedding_service = createEmbeddingService();
    const query_vector = await embedding_service.createEmbedding(params.query);

    console.log('[qdrant-search-handler] handle_qdrant_search — embedding generated', {
      dimensions: query_vector.length,
    });

    // --- Build filter ---
    const qdrant_filter = build_qdrant_filter(params.filters);

    // --- Execute search (with field projection to reduce bandwidth) ---
    const qdrant = get_qdrant_service();
    const results = await qdrant.search(params.collection, query_vector, {
      topK: top_k,
      scoreThreshold: score_threshold,
      filter: qdrant_filter,
      withPayload: { include: PROJECTED_PAYLOAD_FIELDS },
    });

    console.log('[qdrant-search-handler] handle_qdrant_search — search done', {
      result_count: results.length,
    });

    // --- Format response ---
    if (results.length === 0) {
      const elapsed = Date.now() - start_ts;
      console.log('[qdrant-search-handler] handle_qdrant_search — no results', { elapsed_ms: elapsed });
      return (
        `No results found in collection "${params.collection}" for query: "${params.query}". ` +
        `Try lowering the score_threshold (current: ${score_threshold}) or broadening the query.`
      );
    }

    const header =
      `Qdrant search results — collection: "${params.collection}", ` +
      `query: "${params.query}", found: ${results.length}/${top_k} results\n` +
      '─'.repeat(60);

    const formatted_results = results.map((r, i) => format_result(i + 1, r.score, r.payload));

    const output = [header, ...formatted_results].join('\n\n');

    const elapsed = Date.now() - start_ts;
    console.log('[qdrant-search-handler] handle_qdrant_search — done', {
      result_count: results.length,
      elapsed_ms: elapsed,
    });

    return output;
  } catch (error) {
    const elapsed = Date.now() - start_ts;
    const err_msg = error instanceof Error ? error.message : String(error);
    console.log('[qdrant-search-handler] handle_qdrant_search — error', {
      error: err_msg,
      elapsed_ms: elapsed,
    });
    return `Qdrant search failed for collection "${params.collection}": ${err_msg}`;
  }
}
