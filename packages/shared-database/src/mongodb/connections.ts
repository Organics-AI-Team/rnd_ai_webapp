/**
 * MongoDB Database Connections
 *
 * Provides cached MongoDB client connections for different databases.
 * Centralized connection management for the entire application.
 *
 * Environment Variables Required:
 * - MONGODB_URI: MongoDB connection string for main database
 * - RAW_MATERIALS_REAL_STOCK_MONGODB_URI: Connection string for raw materials database (optional, falls back to MONGODB_URI)
 *
 * @module connections
 */

import { create_mongodb_client } from './client-factory';
import type { MongoClient } from 'mongodb';

let cached_main_client_promise: Promise<MongoClient> | null = null;
let cached_raw_materials_client_promise: Promise<MongoClient> | null = null;

/**
 * Promise-compatible wrapper that defers connection creation until awaited.
 */
class LazyMongoClientPromise implements Promise<MongoClient> {
  readonly [Symbol.toStringTag] = 'Promise';

  /**
   * Create a lazy promise wrapper.
   *
   * @param get_client_promise - Getter that creates or returns the cached client promise.
   */
  constructor(private readonly get_client_promise: () => Promise<MongoClient>) {}

  /**
   * Resolve the backing client promise only when a consumer awaits or chains it.
   *
   * @param onfulfilled - Callback for a connected MongoDB client.
   * @param onrejected - Callback for a connection or configuration failure.
   * @returns A promise for the chained result.
   */
  then<TResult1 = MongoClient, TResult2 = never>(
    onfulfilled?: ((value: MongoClient) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.get_client_promise().then(onfulfilled, onrejected);
  }

  /**
   * Handle a lazy connection failure.
   *
   * @param onrejected - Callback for a connection or configuration failure.
   * @returns A promise for the original client or recovered result.
   */
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null
  ): Promise<MongoClient | TResult> {
    return this.get_client_promise().catch(onrejected);
  }

  /**
   * Run cleanup after the lazy client promise settles.
   *
   * @param onfinally - Callback invoked after connection success or failure.
   * @returns A promise for the connected MongoDB client.
   */
  finally(onfinally?: (() => void) | null): Promise<MongoClient> {
    return this.get_client_promise().finally(onfinally);
  }
}

/**
 * Get the cached main MongoDB client promise, creating it on first use.
 *
 * @returns Promise for the connected main MongoDB client.
 * @throws Error when MONGODB_URI is missing or the connection fails.
 */
export function get_main_client_promise(): Promise<MongoClient> {
  if (!cached_main_client_promise) {
    cached_main_client_promise = create_mongodb_client({
      uri: process.env.MONGODB_URI,
      global_cache_key: '_mongoClientPromise',
      error_message: 'MONGODB_URI environment variable is not set',
      warn_message: 'Warning: MONGODB_URI is not set. Database connections will fail.'
    });
  }

  return cached_main_client_promise;
}

/**
 * Get the cached raw-materials MongoDB client promise, creating it on first use.
 *
 * @returns Promise for the connected raw-materials MongoDB client.
 * @throws Error when both raw-material and main MongoDB URIs are missing, or connection fails.
 */
export function get_raw_materials_client_promise(): Promise<MongoClient> {
  if (!cached_raw_materials_client_promise) {
    const raw_materials_uri = process.env.RAW_MATERIALS_REAL_STOCK_MONGODB_URI || process.env.MONGODB_URI;
    cached_raw_materials_client_promise = create_mongodb_client({
      uri: raw_materials_uri,
      global_cache_key: '_rawMaterialsMongoClientPromise',
      error_message: 'RAW_MATERIALS_REAL_STOCK_MONGODB_URI or MONGODB_URI environment variable is not set',
      warn_message: 'Warning: RAW_MATERIALS_REAL_STOCK_MONGODB_URI or MONGODB_URI is not set. Raw materials database connections will fail.'
    });
  }

  return cached_raw_materials_client_promise;
}

/**
 * MongoDB client promise for main database
 *
 * In development: Connection is cached globally
 * In production: New connection created for each serverless invocation
 */
export const main_client_promise: Promise<MongoClient> = new LazyMongoClientPromise(
  get_main_client_promise
);

/**
 * MongoDB client promise for raw materials database
 *
 * In development: Connection is cached globally (separate from main DB cache)
 * In production: New connection created for each serverless invocation
 */
export const raw_materials_client_promise: Promise<MongoClient> = new LazyMongoClientPromise(
  get_raw_materials_client_promise
);

// Default exports for backward compatibility
export default main_client_promise;
