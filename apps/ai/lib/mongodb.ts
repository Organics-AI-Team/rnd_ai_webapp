/**
 * Main MongoDB Database Connection
 *
 * Provides a cached MongoDB client connection for the main application database.
 * Uses the create_mongodb_client factory to eliminate code duplication.
 *
 * Environment Variables Required:
 * - MONGODB_URI: MongoDB connection string for main database
 *
 * @module mongodb
 */

import { create_mongodb_client } from './create-mongodb-client';

/**
 * MongoDB client promise for main database
 *
 * In development: Connection is cached globally
 * In production: New connection created for each serverless invocation
 */
const client_promise = create_mongodb_client({
  uri: process.env.MONGODB_URI,
  global_cache_key: '_mongoClientPromise',
  error_message: 'MONGODB_URI environment variable is not set',
  warn_message: 'Warning: MONGODB_URI is not set. Database connections will fail.'
});

export default client_promise;
