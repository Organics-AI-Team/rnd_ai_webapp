/**
 * Web Search Tool Handler
 * Handles the `web_search` ReAct tool by querying the Google Custom Search API
 * when credentials are configured, or returning a graceful fallback message
 * that instructs the LLM to use training-data knowledge instead.
 *
 * Configuration (both env vars required for live search):
 *   - GOOGLE_SEARCH_API_KEY  — Google API key with Custom Search enabled
 *   - GOOGLE_SEARCH_CSE_ID   — Custom Search Engine ID (cx parameter)
 *
 * @author AI Management System
 * @date 2026-03-27
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Google Custom Search JSON API base endpoint */
const GOOGLE_CSE_API_URL = 'https://www.googleapis.com/customsearch/v1';

/** Hard cap on results to keep response token count manageable */
const MAX_RESULTS_CAP = 10;

/** Default number of results when caller omits max_results */
const DEFAULT_MAX_RESULTS = 5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Input parameters for the web_search tool handler.
 *
 * @param query       - Search query string to send to Google or use as context
 * @param max_results - Maximum results to return (default: 5, capped at 10)
 */
interface WebSearchParams {
  query: string;
  max_results?: number;
}

/**
 * Normalised representation of a single search result.
 *
 * @param title   - Page title from Google search result
 * @param url     - Full URL of the result page
 * @param snippet - Short excerpt shown in search results
 */
interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ---------------------------------------------------------------------------
// Google CSE Fetcher
// ---------------------------------------------------------------------------

/**
 * Fetch results from Google Custom Search API.
 *
 * @param query       - Search query string
 * @param num_results - Number of results to request (1–10)
 * @param api_key     - Google API key
 * @param cse_id      - Custom Search Engine ID
 * @returns Array of normalised SearchResult objects
 * @throws Error on network failure or non-OK HTTP response
 */
async function fetch_google_results(
  query: string,
  num_results: number,
  api_key: string,
  cse_id: string,
): Promise<SearchResult[]> {
  console.log('[web-search-handler] fetch_google_results — start', {
    query,
    num_results,
  });

  // Google CSE API accepts 1–10 results per request
  const safe_num = Math.min(Math.max(num_results, 1), 10);

  const url = new URL(GOOGLE_CSE_API_URL);
  url.searchParams.set('key', api_key);
  url.searchParams.set('cx', cse_id);
  url.searchParams.set('q', query);
  url.searchParams.set('num', String(safe_num));

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    // Generous timeout: CSE can be slow on first request
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Google CSE API returned HTTP ${response.status}: ${body.substring(0, 200)}`,
    );
  }

  const data = await response.json() as Record<string, unknown>;

  // Extract items array; CSE returns empty items when no results found
  const items = (data.items as Record<string, string>[] | undefined) ?? [];

  const results: SearchResult[] = items.map((item) => ({
    title: item.title ?? 'No title',
    url: item.link ?? '',
    snippet: item.snippet ?? '',
  }));

  console.log('[web-search-handler] fetch_google_results — done', {
    returned: results.length,
  });

  return results;
}

// ---------------------------------------------------------------------------
// Result Formatter
// ---------------------------------------------------------------------------

/**
 * Format an array of SearchResult objects into a readable numbered list.
 *
 * @param query   - Original query for context in the header
 * @param results - Array of search results to format
 * @returns Multi-line formatted string
 */
function format_search_results(query: string, results: SearchResult[]): string {
  const header =
    `Web search results for: "${query}" (${results.length} result${results.length !== 1 ? 's' : ''})\n` +
    '─'.repeat(60);

  const formatted = results.map((r, i) => {
    return [
      `[${i + 1}] ${r.title}`,
      `    URL:     ${r.url}`,
      `    Excerpt: ${r.snippet.replace(/\n/g, ' ')}`,
    ].join('\n');
  });

  return [header, ...formatted].join('\n\n');
}

// ---------------------------------------------------------------------------
// Main Handler
// ---------------------------------------------------------------------------

/**
 * Handle the `web_search` ReAct tool call.
 *
 * When GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CSE_ID are both set:
 *   1. Calls Google Custom Search API
 *   2. Returns formatted results
 *
 * When credentials are not configured:
 *   Returns a fallback message instructing the LLM to answer from training data.
 *
 * @param params - WebSearchParams with query and optional max_results
 * @returns Formatted string of web results or a training-data fallback message
 * @throws Never throws directly — errors are caught and returned as strings
 */
export async function handle_web_search(params: WebSearchParams): Promise<string> {
  const start_ts = Date.now();
  console.log('[web-search-handler] handle_web_search — start', {
    query: params.query,
    max_results: params.max_results,
  });

  // --- Validation ---
  if (!params.query || !params.query.trim()) {
    console.log('[web-search-handler] handle_web_search — error: empty query');
    return 'Error: query parameter is required and must not be empty.';
  }

  const num_results = Math.min(params.max_results ?? DEFAULT_MAX_RESULTS, MAX_RESULTS_CAP);

  // --- Check credentials ---
  const api_key = process.env.GOOGLE_SEARCH_API_KEY;
  const cse_id = process.env.GOOGLE_SEARCH_CSE_ID;

  if (!api_key || !cse_id) {
    console.log('[web-search-handler] handle_web_search — credentials not configured, returning fallback');

    const elapsed = Date.now() - start_ts;
    console.log('[web-search-handler] handle_web_search — done (fallback)', { elapsed_ms: elapsed });

    return (
      `Web search not configured. Based on training data: ` +
      `Please answer the following query using your knowledge up to your training cutoff: "${params.query}". ` +
      `Note: For real-time data (prices, availability, regulations updated after training), ` +
      `results may not reflect the latest information.`
    );
  }

  // --- Execute live search ---
  try {
    const results = await fetch_google_results(params.query, num_results, api_key, cse_id);

    const elapsed = Date.now() - start_ts;

    if (results.length === 0) {
      console.log('[web-search-handler] handle_web_search — no results', { elapsed_ms: elapsed });
      return (
        `Web search returned no results for: "${params.query}". ` +
        `Try a different query or check the Custom Search Engine configuration.`
      );
    }

    const formatted = format_search_results(params.query, results);

    console.log('[web-search-handler] handle_web_search — done', {
      result_count: results.length,
      elapsed_ms: elapsed,
    });

    return formatted;
  } catch (error) {
    const elapsed = Date.now() - start_ts;
    const err_msg = error instanceof Error ? error.message : String(error);
    console.log('[web-search-handler] handle_web_search — error', {
      error: err_msg,
      elapsed_ms: elapsed,
    });

    // On API error, degrade gracefully to training-data fallback
    return (
      `Web search encountered an error: ${err_msg}. ` +
      `Falling back to training data for query: "${params.query}".`
    );
  }
}
