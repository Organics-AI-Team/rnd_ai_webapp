/**
 * Raw Materials MongoDB Database Connection
 *
 * Provides a cached MongoDB client connection for the raw materials database.
 * Uses the create_mongodb_client factory to eliminate code duplication.
 *
 * Environment Variables:
 * - RAW_MATERIALS_REAL_STOCK_MONGODB_URI: Primary connection string (preferred)
 * - MONGODB_URI: Fallback connection string if primary not set
 *
 * @module raw-materials-mongodb
 */

import { create_mongodb_client } from './create-mongodb-client';

/**
 * Get MongoDB URI for raw materials database
 * Falls back to main MONGODB_URI if specific URI not set
 */
const uri = process.env.RAW_MATERIALS_REAL_STOCK_MONGODB_URI || process.env.MONGODB_URI;

/**
 * MongoDB client promise for raw materials database
 *
 * In development: Connection is cached globally (separate from main DB cache)
 * In production: New connection created for each serverless invocation
 */
const client_promise = create_mongodb_client({
  uri,
  global_cache_key: '_rawMaterialsMongoClientPromise',
  error_message: 'RAW_MATERIALS_REAL_STOCK_MONGODB_URI or MONGODB_URI environment variable is not set',
  warn_message: 'Warning: RAW_MATERIALS_REAL_STOCK_MONGODB_URI or MONGODB_URI is not set. Raw materials database connections will fail.'
});

export default client_promise;