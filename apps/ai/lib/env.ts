/**
 * Type-Safe Environment Variable Access
 *
 * Provides type-safe helpers for accessing environment variables with
 * validation and clear error messages.
 *
 * Benefits:
 * - Type safety for environment variable names
 * - Validation at access time
 * - Clear error messages for missing variables
 * - Centralized environment variable access patterns
 *
 * @module env
 */

/**
 * Required environment variable keys
 * These MUST be set for the application to function
 */
type RequiredEnvVar =
  | 'MONGODB_URI'
  | 'ADMIN_EMAIL'
  | 'ADMIN_PASSWORD';

/**
 * Optional environment variable keys
 * These MAY be set for additional functionality
 */
type OptionalEnvVar =
  | 'RAW_MATERIALS_REAL_STOCK_MONGODB_URI'
  | 'GEMINI_API_KEY'
  | 'OPENAI_API_KEY'
  | 'PINECONE_API_KEY'
  | 'NEXT_PUBLIC_APP_URL'
  | 'NEXT_PUBLIC_API_URL'
  | 'NODE_ENV'
  | 'DEBUG_AI';

/**
 * Get a required environment variable or throw an error
 *
 * Use this function when the environment variable is critical
 * for the application to function.
 *
 * @param key - The environment variable name
 * @returns The environment variable value
 * @throws {Error} If the variable is not set
 *
 * @example
 * ```typescript
 * const mongoUri = get_required_env('MONGODB_URI');
 * // Throws error if MONGODB_URI is not set
 * ```
 */
export function get_required_env(key: RequiredEnvVar): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}\n` +
      `Please set ${key} in your .env.local file`
    );
  }
  return value;
}

/**
 * Get an optional environment variable with a fallback value
 *
 * Use this function when the environment variable is optional
 * and you have a sensible default value.
 *
 * @param key - The environment variable name
 * @param fallback - The default value if not set (defaults to empty string)
 * @returns The environment variable value or fallback
 *
 * @example
 * ```typescript
 * const appUrl = get_optional_env('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
 * // Returns value or fallback if not set
 * ```
 */
export function get_optional_env(
  key: OptionalEnvVar,
  fallback: string = ''
): string {
  return process.env[key] || fallback;
}

/**
 * Check if an environment variable is set
 *
 * @param key - The environment variable name
 * @returns True if the variable is set (non-empty), false otherwise
 *
 * @example
 * ```typescript
 * if (has_env('GEMINI_API_KEY')) {
 *   // Use Gemini service
 * }
 * ```
 */
export function has_env(key: string): boolean {
  return !!process.env[key];
}

/**
 * Centralized environment variable access with type safety
 *
 * This object provides convenient access to commonly used
 * environment variables with proper type checking.
 *
 * @example
 * ```typescript
 * import { env } from '@/lib/env';
 *
 * const uri = env.mongo_uri();  // Throws if not set
 * const apiKey = env.gemini_api_key();  // Throws if not set
 * const isDev = env.is_development();  // Boolean
 * ```
 */
export const env = {
  /**
   * Database connection strings
   */
  mongo_uri: () => get_required_env('MONGODB_URI'),
  raw_materials_uri: () =>
    get_optional_env('RAW_MATERIALS_REAL_STOCK_MONGODB_URI') ||
    get_required_env('MONGODB_URI'),

  /**
   * Authentication credentials
   */
  admin_email: () => get_required_env('ADMIN_EMAIL'),
  admin_password: () => get_required_env('ADMIN_PASSWORD'),

  /**
   * AI service API keys
   */
  gemini_api_key: () => {
    const key = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (!key) {
      throw new Error('GEMINI_API_KEY is not set in environment variables');
    }
    return key;
  },

  openai_api_key: () => {
    const key = process.env.OPENAI_API_KEY || process.env.NEXT_PUBLIC_OPENAI_API_KEY;
    if (!key) {
      throw new Error('OPENAI_API_KEY is not set in environment variables');
    }
    return key;
  },

  pinecone_api_key: () => {
    const key = process.env.PINECONE_API_KEY;
    if (!key) {
      throw new Error('PINECONE_API_KEY is not set in environment variables');
    }
    return key;
  },

  /**
   * Application URLs
   */
  app_url: () => get_optional_env('NEXT_PUBLIC_APP_URL', 'http://localhost:3000'),
  api_url: () => get_optional_env('NEXT_PUBLIC_API_URL', '/api'),

  /**
   * Environment checks
   */
  node_env: () => get_optional_env('NODE_ENV', 'development'),
  is_development: () => env.node_env() === 'development',
  is_production: () => env.node_env() === 'production',
  is_test: () => env.node_env() === 'test',

  /**
   * Debug mode
   */
  is_debug_mode: () => has_env('DEBUG_AI') && process.env.DEBUG_AI === 'true',
} as const;

/**
 * Get all environment variables as a safe object (for debugging)
 *
 * This function returns a sanitized view of environment variables
 * with sensitive values masked.
 *
 * @returns Object with environment variable names and masked values
 *
 * @example
 * ```typescript
 * console.log(get_env_status());
 * // { MONGODB_URI: 'SET', ADMIN_EMAIL: 'SET', ... }
 * ```
 */
export function get_env_status(): Record<string, string> {
  const required: RequiredEnvVar[] = [
    'MONGODB_URI',
    'ADMIN_EMAIL',
    'ADMIN_PASSWORD',
  ];

  const optional: OptionalEnvVar[] = [
    'RAW_MATERIALS_REAL_STOCK_MONGODB_URI',
    'GEMINI_API_KEY',
    'OPENAI_API_KEY',
    'PINECONE_API_KEY',
    'NEXT_PUBLIC_APP_URL',
    'NODE_ENV',
    'DEBUG_AI',
  ];

  const status: Record<string, string> = {};

  required.forEach(key => {
    status[key] = process.env[key] ? 'SET' : 'NOT_SET (REQUIRED)';
  });

  optional.forEach(key => {
    status[key] = process.env[key] ? 'SET' : 'NOT_SET (optional)';
  });

  return status;
}
