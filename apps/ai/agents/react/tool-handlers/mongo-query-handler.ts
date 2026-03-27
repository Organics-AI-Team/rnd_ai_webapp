/**
 * MongoDB Query Tool Handler
 * Handles the `mongo_query` ReAct tool by executing read-only MongoDB
 * operations (find, findOne, aggregate, count) against either the rnd_ai
 * or raw_materials database.
 *
 * Design decisions:
 * - MongoClient instances are cached per URI in a module-level Map to avoid
 *   reconnection overhead across repeated tool calls within a session.
 * - Results are capped at 20 documents to prevent oversized LLM context.
 * - Only read operations are permitted; write access is explicitly blocked.
 *
 * @author AI Management System
 * @date 2026-03-27
 */

import { MongoClient, Document } from 'mongodb';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum documents returned per query to keep LLM context manageable */
const MAX_RESULTS = 20;

/** Default limit when caller does not specify one */
const DEFAULT_LIMIT = 10;

/** Allowed MongoDB read operations — write operations are explicitly excluded */
const ALLOWED_OPERATIONS = ['find', 'findOne', 'aggregate', 'count'] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Union of permitted read operation names */
type MongoOperation = typeof ALLOWED_OPERATIONS[number];

/**
 * Input parameters for the mongo_query tool handler.
 *
 * @param collection  - MongoDB collection name to query
 * @param database    - Target database: 'rnd_ai' uses MONGODB_URI; 'raw_materials' uses RAW_MATERIALS_REAL_STOCK_MONGODB_URI
 * @param operation   - Read operation to perform: find | findOne | aggregate | count
 * @param filter      - MongoDB query filter document
 * @param projection  - Optional field selection document (1 = include, 0 = exclude)
 * @param sort        - Optional sort specification (e.g. { cost: 1 } for ascending)
 * @param limit       - Max documents to return for find (default: 10, capped at 20)
 */
interface MongoQueryParams {
  collection: string;
  database: string;
  operation: MongoOperation;
  filter: Record<string, unknown>;
  projection?: Record<string, unknown>;
  sort?: Record<string, unknown>;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Client Cache
// ---------------------------------------------------------------------------

/**
 * Module-level cache of connected MongoClient instances, keyed by URI.
 * Avoids creating a new connection on every tool invocation.
 */
const client_cache = new Map<string, MongoClient>();

/**
 * Retrieve or create a cached MongoClient for the given URI.
 * On first call for a URI, connects and stores the client.
 *
 * @param uri - MongoDB connection string
 * @returns Connected MongoClient instance
 * @throws Error if the URI is empty or connection fails
 */
async function get_or_create_client(uri: string): Promise<MongoClient> {
  console.log('[mongo-query-handler] get_or_create_client — start', {
    uri_preview: uri.substring(0, 30) + '...',
  });

  if (!uri) {
    throw new Error('MongoDB URI is empty. Check environment variables.');
  }

  if (client_cache.has(uri)) {
    console.log('[mongo-query-handler] get_or_create_client — cache hit');
    return client_cache.get(uri)!;
  }

  const client = new MongoClient(uri, {
    maxPoolSize: 5,
    connectTimeoutMS: 10_000,
    serverSelectionTimeoutMS: 10_000,
  });

  await client.connect();
  client_cache.set(uri, client);

  console.log('[mongo-query-handler] get_or_create_client — connected and cached');
  return client;
}

// ---------------------------------------------------------------------------
// URI Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the MongoDB connection URI for the requested database.
 * - 'raw_materials' → RAW_MATERIALS_REAL_STOCK_MONGODB_URI
 * - 'rnd_ai' (or any other value) → MONGODB_URI
 *
 * @param database - Logical database identifier from the tool params
 * @returns The connection URI string
 * @throws Error if the required environment variable is not set
 */
function resolve_mongo_uri(database: string): string {
  console.log('[mongo-query-handler] resolve_mongo_uri — start', { database });

  const uri =
    database === 'raw_materials'
      ? process.env.RAW_MATERIALS_REAL_STOCK_MONGODB_URI
      : process.env.MONGODB_URI;

  if (!uri) {
    const env_var =
      database === 'raw_materials'
        ? 'RAW_MATERIALS_REAL_STOCK_MONGODB_URI'
        : 'MONGODB_URI';
    throw new Error(
      `Missing environment variable "${env_var}" for database "${database}".`,
    );
  }

  console.log('[mongo-query-handler] resolve_mongo_uri — done');
  return uri;
}

// ---------------------------------------------------------------------------
// Operation Executors
// ---------------------------------------------------------------------------

/**
 * Execute a MongoDB `find` operation with optional projection, sort, and limit.
 *
 * @param collection_ref - MongoDB Collection object
 * @param params         - Full MongoQueryParams for filter/projection/sort/limit
 * @returns Array of matching documents (capped at MAX_RESULTS)
 */
async function execute_find(
  collection_ref: ReturnType<ReturnType<MongoClient['db']>['collection']>,
  params: MongoQueryParams,
): Promise<Document[]> {
  console.log('[mongo-query-handler] execute_find — start');

  const safe_limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_RESULTS);
  let cursor = collection_ref.find(params.filter);

  if (params.projection && Object.keys(params.projection).length > 0) {
    cursor = cursor.project(params.projection);
  }
  if (params.sort && Object.keys(params.sort).length > 0) {
    cursor = cursor.sort(params.sort as any);
  }

  const docs = await cursor.limit(safe_limit).toArray();
  console.log('[mongo-query-handler] execute_find — done', { doc_count: docs.length });
  return docs;
}

/**
 * Execute a MongoDB `findOne` operation.
 *
 * @param collection_ref - MongoDB Collection object
 * @param params         - Full MongoQueryParams for filter/projection
 * @returns Single document or null if not found
 */
async function execute_find_one(
  collection_ref: ReturnType<ReturnType<MongoClient['db']>['collection']>,
  params: MongoQueryParams,
): Promise<Document | null> {
  console.log('[mongo-query-handler] execute_find_one — start');

  const options: Record<string, unknown> = {};
  if (params.projection && Object.keys(params.projection).length > 0) {
    options.projection = params.projection;
  }

  const doc = await collection_ref.findOne(params.filter, options as any);
  console.log('[mongo-query-handler] execute_find_one — done', { found: !!doc });
  return doc;
}

/**
 * Execute a MongoDB `aggregate` pipeline.
 * Expects params.filter to be an array of pipeline stages.
 *
 * @param collection_ref - MongoDB Collection object
 * @param params         - MongoQueryParams; filter must be pipeline stages array
 * @returns Array of aggregated documents (capped at MAX_RESULTS)
 */
async function execute_aggregate(
  collection_ref: ReturnType<ReturnType<MongoClient['db']>['collection']>,
  params: MongoQueryParams,
): Promise<Document[]> {
  console.log('[mongo-query-handler] execute_aggregate — start');

  // Support both array pipeline and object (wrap single stage)
  const pipeline: Document[] = Array.isArray(params.filter)
    ? (params.filter as Document[])
    : [{ $match: params.filter }];

  // Inject $limit stage if not already present and cap at MAX_RESULTS
  const has_limit_stage = pipeline.some((stage) => '$limit' in stage);
  if (!has_limit_stage) {
    pipeline.push({ $limit: MAX_RESULTS });
  }

  const docs = await collection_ref.aggregate(pipeline).toArray();
  const capped = docs.slice(0, MAX_RESULTS);
  console.log('[mongo-query-handler] execute_aggregate — done', { doc_count: capped.length });
  return capped;
}

/**
 * Execute a MongoDB `countDocuments` operation.
 *
 * @param collection_ref - MongoDB Collection object
 * @param filter         - MongoDB filter document
 * @returns Count as a plain object `{ count: number }`
 */
async function execute_count(
  collection_ref: ReturnType<ReturnType<MongoClient['db']>['collection']>,
  filter: Record<string, unknown>,
): Promise<{ count: number }> {
  console.log('[mongo-query-handler] execute_count — start');

  const count = await collection_ref.countDocuments(filter as any);
  console.log('[mongo-query-handler] execute_count — done', { count });
  return { count };
}

// ---------------------------------------------------------------------------
// Main Handler
// ---------------------------------------------------------------------------

/**
 * Handle the `mongo_query` ReAct tool call.
 *
 * Workflow:
 * 1. Validate required params
 * 2. Resolve MongoDB URI based on database field
 * 3. Get or create a cached MongoClient
 * 4. Dispatch to the correct operation executor
 * 5. Return JSON-stringified results with a context header
 *
 * @param params - MongoQueryParams specifying collection, database, operation, filter, etc.
 * @returns JSON string of query results or a descriptive error string
 * @throws Never throws directly — errors are caught and returned as strings
 */
export async function handle_mongo_query(params: MongoQueryParams): Promise<string> {
  const start_ts = Date.now();
  console.log('[mongo-query-handler] handle_mongo_query — start', {
    collection: params.collection,
    database: params.database,
    operation: params.operation,
    limit: params.limit,
  });

  // --- Validation ---
  if (!params.collection) {
    return 'Error: collection parameter is required.';
  }
  if (!params.database) {
    return 'Error: database parameter is required.';
  }
  if (!ALLOWED_OPERATIONS.includes(params.operation)) {
    return `Error: unsupported operation "${params.operation}". Allowed: ${ALLOWED_OPERATIONS.join(', ')}.`;
  }
  if (!params.filter) {
    return 'Error: filter parameter is required (use {} for no filter).';
  }

  try {
    const uri = resolve_mongo_uri(params.database);
    const client = await get_or_create_client(uri);
    const db = client.db(params.database);
    const col = db.collection(params.collection);

    let result: Document | Document[] | { count: number } | null;

    switch (params.operation) {
      case 'find':
        result = await execute_find(col, params);
        break;
      case 'findOne':
        result = await execute_find_one(col, params);
        break;
      case 'aggregate':
        result = await execute_aggregate(col, params);
        break;
      case 'count':
        result = await execute_count(col, params.filter);
        break;
      default:
        return `Error: unrecognised operation "${params.operation}".`;
    }

    const elapsed = Date.now() - start_ts;
    const doc_count = Array.isArray(result) ? result.length : 1;

    console.log('[mongo-query-handler] handle_mongo_query — done', {
      operation: params.operation,
      doc_count,
      elapsed_ms: elapsed,
    });

    const header =
      `MongoDB query result — db: "${params.database}", collection: "${params.collection}", ` +
      `operation: "${params.operation}", elapsed: ${elapsed}ms\n`;

    return header + JSON.stringify(result, null, 2);
  } catch (error) {
    const elapsed = Date.now() - start_ts;
    const err_msg = error instanceof Error ? error.message : String(error);
    console.log('[mongo-query-handler] handle_mongo_query — error', {
      error: err_msg,
      elapsed_ms: elapsed,
    });
    return `MongoDB query failed (db: "${params.database}", collection: "${params.collection}"): ${err_msg}`;
  }
}
