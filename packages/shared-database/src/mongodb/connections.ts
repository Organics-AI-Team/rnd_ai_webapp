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

/**
 * MongoDB client promise for main database
 *
 * In development: Connection is cached globally
 * In production: New connection created for each serverless invocation
 */
export const main_client_promise = create_mongodb_client({
  uri: process.env.MONGODB_URI,
  global_cache_key: '_mongoClientPromise',
  error_message: 'MONGODB_URI environment variable is not set',
  warn_message: 'Warning: MONGODB_URI is not set. Database connections will fail.'
});

/**
 * Get MongoDB URI for raw materials database
 * Falls back to main MONGODB_URI if specific URI not set
 */
const raw_materials_uri = process.env.RAW_MATERIALS_REAL_STOCK_MONGODB_URI || process.env.MONGODB_URI;

/**
 * MongoDB client promise for raw materials database
 *
 * In development: Connection is cached globally (separate from main DB cache)
 * In production: New connection created for each serverless invocation
 */
export const raw_materials_client_promise = create_mongodb_client({
  uri: raw_materials_uri,
  global_cache_key: '_rawMaterialsMongoClientPromise',
  error_message: 'RAW_MATERIALS_REAL_STOCK_MONGODB_URI or MONGODB_URI environment variable is not set',
  warn_message: 'Warning: RAW_MATERIALS_REAL_STOCK_MONGODB_URI or MONGODB_URI is not set. Raw materials database connections will fail.'
});

// Default exports for backward compatibility
export default main_client_promise;
