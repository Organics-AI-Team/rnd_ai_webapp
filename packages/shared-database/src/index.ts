/**
 * @rnd-ai/shared-database
 *
 * Shared database utilities and connections for RND AI Management monorepo
 *
 * Provides:
 * - MongoDB client factory for creating cached connections
 * - Pre-configured connections for main and raw materials databases
 * - Database utility functions
 *
 * @module @rnd-ai/shared-database
 */

// MongoDB Client Factory
export {
  create_mongodb_client,
  get_database_name_from_uri,
  type MongoDBClientOptions
} from './mongodb/client-factory';

// Pre-configured connections
export {
  main_client_promise,
  raw_materials_client_promise
} from './mongodb/connections';

// Utilities
export { parseArrayField } from './utils/array-utils';

// Default export for backward compatibility
export { default } from './mongodb/connections';
