"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.create_mongodb_client = create_mongodb_client;
exports.get_database_name_from_uri = get_database_name_from_uri;
const mongodb_1 = require("mongodb");
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
function create_mongodb_client({ uri, global_cache_key, error_message, warn_message }) {
    // Warn if URI is not set (build-time safety)
    if (!uri) {
        console.warn(warn_message);
    }
    const options = {};
    let client_promise;
    if (uri) {
        if (process.env.NODE_ENV === "development") {
            // Development: Use global caching to prevent connection exhaustion
            const global_with_mongo = global;
            if (!global_with_mongo[global_cache_key]) {
                const client = new mongodb_1.MongoClient(uri, options);
                global_with_mongo[global_cache_key] = client.connect();
            }
            client_promise = global_with_mongo[global_cache_key];
        }
        else {
            // Production: Create new connection (serverless-friendly)
            const client = new mongodb_1.MongoClient(uri, options);
            client_promise = client.connect();
        }
    }
    else {
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
 * @returns Explicit database name from the URI.
 * @throws Error when the URI is malformed or omits a database.
 */
function get_database_name_from_uri(uri) {
    var _a;
    const match = uri.trim().match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^/?]+)(?:\?|$)/i);
    const database_name = (_a = match === null || match === void 0 ? void 0 : match[1]) === null || _a === void 0 ? void 0 : _a.trim();
    if (!database_name) {
        throw new Error("MongoDB URI must include an explicit database name.");
    }
    return decodeURIComponent(database_name);
}
