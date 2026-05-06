/**
 * MongoDB Client Factory
 *
 * Creates MongoDB client connections with proper caching for development
 * and production environments. Eliminates code duplication across
 * different database connections.
 *
 * Features:
 * - Development connection caching (prevents connection exhaustion)
 * - Production connection management
 * - Type-safe error handling
 * - Clear error messages for missing configuration
 *
 * @module client-factory
 */

import { MongoClient } from "mongodb";

/**
 * Options for creating a MongoDB client connection
 */
export interface MongoDBClientOptions {
  /**
   * MongoDB connection URI from environment variables
   * If undefined, a rejected promise will be returned
   */
  uri: string | undefined;

  /**
   * Unique key for storing the connection in global cache (development only)
   * Used to prevent multiple connections to the same database in development
   *
   * @example '_mongoClientPromise', '_rawMaterialsMongoClientPromise'
   */
  global_cache_key: string;

  /**
   * Custom error message to display when URI is not set
   *
   * @example 'MONGODB_URI environment variable is not set'
   */
  error_message: string;

  /**
   * Warning message to display when URI is not set (before connection attempt)
   *
   * @example 'Warning: MONGODB_URI is not set. Database connections will fail.'
   */
  warn_message: string;
}

/**
 * Creates a MongoDB client connection with proper caching
 *
 * This factory function eliminates duplication by providing a single
 * implementation for all MongoDB connection patterns in the application.
 *
 * In development:
 * - Caches connection globally to prevent connection exhaustion
 * - Reuses existing connection if available
 *
 * In production:
 * - Creates new connection for each call
 * - No global caching (serverless-friendly)
 *
 * @param options - Configuration for the MongoDB client
 * @returns Promise that resolves to MongoClient or rejects if URI is missing
 *
 * @example
 * ```typescript
 * const client_promise = create_mongodb_client({
 *   uri: process.env.MONGODB_URI,
 *   global_cache_key: '_mongoClientPromise',
 *   error_message: 'MONGODB_URI environment variable is not set',
 *   warn_message: 'Warning: MONGODB_URI is not set. Database connections will fail.'
 * });
 * ```
 */
export function create_mongodb_client({
  uri,
  global_cache_key,
  error_message,
  warn_message
}: MongoDBClientOptions): Promise<MongoClient> {

  // Warn if URI is not set (build-time safety)
  if (!uri) {
    console.warn(warn_message);
  }

  const options = {};
  let client_promise: Promise<MongoClient>;

  if (uri) {
    if (process.env.NODE_ENV === "development") {
      // Development: Use global caching to prevent connection exhaustion
      const global_with_mongo = global as typeof globalThis & {
        [key: string]: Promise<MongoClient> | undefined;
      };

      if (!global_with_mongo[global_cache_key]) {
        const client = new MongoClient(uri, options);
        global_with_mongo[global_cache_key] = client.connect();
      }
      client_promise = global_with_mongo[global_cache_key]!;
    } else {
      // Production: Create new connection (serverless-friendly)
      const client = new MongoClient(uri, options);
      client_promise = client.connect();
    }
  } else {
    // URI not set: Create rejected promise that will fail if actually used
    // This allows build to complete but will error at runtime if DB is accessed
    client_promise = Promise.reject(new Error(error_message));
  }

  return client_promise;
}

/**
 * Helper function to get MongoDB database name from URI
 *
 * @param uri - MongoDB connection URI
 * @returns Database name or 'test' if not found
 */
export function get_database_name_from_uri(uri: string): string {
  try {
    const match = uri.match(/\/([^/?]+)(\?|$)/);
    return match ? match[1] : 'test';
  } catch {
    return 'test';
  }
}
