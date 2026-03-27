/**
 * Web Search Tool Handler
 * Handles the `web_search` ReAct tool using Gemini's built-in Google Search
 * grounding. No external API keys needed — uses GEMINI_API_KEY only.
 *
 * Uses @google/genai SDK with `googleSearch` tool to get real-time web results
 * with source citations and grounding metadata.
 *
 * Configuration:
 *   - GEMINI_API_KEY — Required (same key used by the rest of the AI system)
 *
 * @author AI Management System
 * @date 2026-03-27
 */

import { GoogleGenAI } from '@google/genai';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Gemini model used for search-grounded queries */
const SEARCH_MODEL = process.env.GEMINI_SEARCH_MODEL || 'gemini-2.5-flash';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Input parameters for the web_search tool handler.
 *
 * @param query       - Search query string
 * @param max_results - Maximum results to return (advisory — Gemini decides actual count)
 */
interface WebSearchParams {
  query: string;
  max_results?: number;
}

/**
 * Normalised representation of a single search result source.
 *
 * @param title   - Page title from grounding chunk
 * @param url     - Full URL of the source page
 * @param snippet - Relevant text excerpt from the source
 */
interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ---------------------------------------------------------------------------
// Singleton GenAI Client
// ---------------------------------------------------------------------------

let genai_client: GoogleGenAI | null = null;

/**
 * Get or create the GoogleGenAI client singleton.
 *
 * @returns GoogleGenAI instance
 * @throws Error if GEMINI_API_KEY is not set
 */
function get_genai_client(): GoogleGenAI {
  if (genai_client) return genai_client;

  const api_key = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!api_key) {
    throw new Error('GEMINI_API_KEY not configured — required for web search');
  }

  genai_client = new GoogleGenAI({ apiKey: api_key });
  console.log('[web-search-handler] GoogleGenAI client initialised');
  return genai_client;
}

// ---------------------------------------------------------------------------
// Gemini Search with Grounding
// ---------------------------------------------------------------------------

/**
 * Execute a web search using Gemini's built-in Google Search grounding.
 * Gemini automatically searches the web and returns a grounded answer
 * with source citations.
 *
 * @param query - Search query string
 * @returns Object with answer text and extracted search results
 */
async function search_with_gemini_grounding(
  query: string,
): Promise<{ answer: string; sources: SearchResult[] }> {
  console.log('[web-search-handler] search_with_gemini_grounding — start', { query });

  const ai = get_genai_client();

  const response = await ai.models.generateContent({
    model: SEARCH_MODEL,
    contents: `Search the web and provide factual, current information about: ${query}\n\nProvide a concise summary with key facts. Include specific data points, dates, and numbers when available.`,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const answer = response.text || 'No answer generated.';

  // Extract grounding metadata for source citations
  const metadata = response.candidates?.[0]?.groundingMetadata;
  const sources: SearchResult[] = [];

  if (metadata?.groundingChunks) {
    for (const chunk of metadata.groundingChunks) {
      if (chunk.web) {
        sources.push({
          title: chunk.web.title || 'Web Source',
          url: chunk.web.uri || '',
          snippet: '', // Gemini grounding chunks don't include snippets directly
        });
      }
    }
  }

  // Extract search queries used by Gemini for transparency
  const search_queries = metadata?.webSearchQueries || [];

  console.log('[web-search-handler] search_with_gemini_grounding — done', {
    answer_length: answer.length,
    source_count: sources.length,
    search_queries,
  });

  return { answer, sources };
}

// ---------------------------------------------------------------------------
// Result Formatter
// ---------------------------------------------------------------------------

/**
 * Format the Gemini grounded search response into a readable string
 * for the ReAct agent to consume.
 *
 * @param query   - Original query for context in the header
 * @param answer  - Gemini's grounded answer text
 * @param sources - Array of source citations from grounding metadata
 * @returns Multi-line formatted string with answer and sources
 */
function format_grounded_response(
  query: string,
  answer: string,
  sources: SearchResult[],
): string {
  console.log('[web-search-handler] format_grounded_response — start');

  const header =
    `Web search results for: "${query}" (Gemini Google Search grounding)\n` +
    '─'.repeat(60);

  const parts = [header, '', answer];

  if (sources.length > 0) {
    parts.push('', '─'.repeat(60), 'Sources:');
    sources.forEach((s, i) => {
      parts.push(`  [${i + 1}] ${s.title} — ${s.url}`);
    });
  }

  console.log('[web-search-handler] format_grounded_response — done');
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Main Handler
// ---------------------------------------------------------------------------

/**
 * Handle the `web_search` ReAct tool call.
 *
 * Uses Gemini's built-in Google Search grounding to search the web
 * and return a grounded answer with source citations.
 * Requires only GEMINI_API_KEY (no Google CSE keys needed).
 *
 * @param params - WebSearchParams with query and optional max_results
 * @returns Formatted string with grounded web search answer and sources
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

  // --- Check Gemini API key ---
  const api_key = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!api_key) {
    const elapsed = Date.now() - start_ts;
    console.log('[web-search-handler] handle_web_search — no GEMINI_API_KEY, fallback', { elapsed_ms: elapsed });

    return (
      `Web search not configured (missing GEMINI_API_KEY). ` +
      `Please answer the following query using your knowledge: "${params.query}".`
    );
  }

  // --- Execute Gemini-grounded web search ---
  try {
    const { answer, sources } = await search_with_gemini_grounding(params.query);

    const elapsed = Date.now() - start_ts;
    const formatted = format_grounded_response(params.query, answer, sources);

    console.log('[web-search-handler] handle_web_search — done', {
      answer_length: answer.length,
      source_count: sources.length,
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

    // On error, degrade gracefully to training-data fallback
    return (
      `Web search encountered an error: ${err_msg}. ` +
      `Falling back to training data for query: "${params.query}".`
    );
  }
}
