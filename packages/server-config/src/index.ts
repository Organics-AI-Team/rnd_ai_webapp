/**
 * Immutable credentials that may be consumed only by server runtimes.
 */
export type ServerAICredentials = Readonly<{
  gemini_api_key: string;
  google_search_api_key?: string;
  google_search_cse_id?: string;
  openai_api_key?: string;
  qdrant_api_key?: string;
}>;

/**
 * Read and normalize a required secret without exposing its value in errors.
 *
 * @param env - Explicit server environment supplied at request or service startup time.
 * @param key - Private environment variable name to require.
 * @returns Normalized secret value.
 * @throws Error when the named private credential is absent or blank.
 */
function require_secret(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required server credential: ${key}`);
  }

  return value;
}

/**
 * Read and normalize an optional secret.
 *
 * @param env - Explicit server environment supplied at request or service startup time.
 * @param key - Private environment variable name to read.
 * @returns Normalized secret value, or undefined when absent or blank.
 */
function optional_secret(
  env: NodeJS.ProcessEnv,
  key: string,
): string | undefined {
  return env[key]?.trim() || undefined;
}

/**
 * Load the canonical private AI credential contract without import-time environment reads.
 *
 * @param env - Explicit server environment supplied by the calling server boundary.
 * @returns Frozen private credential values for provider adapters.
 * @throws Error when the required Gemini server credential is absent or blank.
 */
export function require_server_ai_credentials(
  env: NodeJS.ProcessEnv,
): ServerAICredentials {
  return Object.freeze({
    gemini_api_key: require_secret(env, "GEMINI_API_KEY"),
    google_search_api_key: optional_secret(env, "GOOGLE_SEARCH_API_KEY"),
    google_search_cse_id: optional_secret(env, "GOOGLE_SEARCH_CSE_ID"),
    openai_api_key: optional_secret(env, "OPENAI_API_KEY"),
    qdrant_api_key: optional_secret(env, "QDRANT_API_KEY"),
  });
}
