/**
 * Single source of truth for Gemini model identifiers.
 *
 * Google retires model ids on a rolling basis. A retired id returns HTTP 404
 * from `generateContent`, which surfaces to the user as a failed chat turn
 * ("Sorry, I could not process your request"). Keeping every default here
 * means a retirement is a one-line change instead of a hunt through call
 * sites — see CHANGELOG 2026-09-21 for the incident this prevents.
 *
 * Every id is overridable per deployment; verify the configured ids against
 * the live API with `npx tsx scripts/verify-gemini-models.ts`.
 *
 * @author AI Management System
 * @date 2026-09-21
 */

/**
 * Default generation model.
 *
 * Pinned to an id present in every plan tier's `allowed_models`
 * (see server/services/ai-control/plan-entitlements.ts). Bumping this to a
 * newer id requires adding that id to those allowlists first, or every run
 * fails the entitlement check before it ever reaches the provider.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';

/** Default embedding model. Changing this invalidates every stored vector. */
export const DEFAULT_GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';

/**
 * Resolve the generation model for agent and script calls.
 *
 * Read lazily (not at module load) so callers that load `.env` after import
 * still observe the configured value.
 *
 * @returns Model id from `GEMINI_MODEL`, else the verified default.
 */
export function get_gemini_model(): string {
  return process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
}

/**
 * Resolve the model used for Google-Search-grounded queries.
 *
 * Falls back through `GEMINI_MODEL` so a deployment that pins only one
 * variable never leaves the search path on a stale id.
 *
 * @returns Model id from `GEMINI_SEARCH_MODEL`, else `GEMINI_MODEL`, else the default.
 */
export function get_gemini_search_model(): string {
  return process.env.GEMINI_SEARCH_MODEL || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
}

/**
 * Resolve the embedding model.
 *
 * @returns Model id from `GEMINI_EMBEDDING_MODEL`, else the verified default.
 */
export function get_gemini_embedding_model(): string {
  return process.env.GEMINI_EMBEDDING_MODEL || DEFAULT_GEMINI_EMBEDDING_MODEL;
}
