/**
 * MongoDB Diagnostic Tool Handler (G2.6 — locked down).
 *
 * This tool previously accepted a model-supplied collection name, raw filter,
 * and aggregation pipeline — a direct cross-tenant data-exfiltration vector: a
 * model (or a prompt-injected instruction) could read any collection with any
 * filter. It is now restricted to a small set of server-authored, read-only
 * named diagnostics. The model may only choose a diagnostic by name and pass a
 * narrow set of validated scalar parameters; it can never name a collection,
 * supply a filter, or author an aggregation stage. Every tenant-scoped
 * diagnostic pins its query to the trusted execution context's tenant.
 *
 * @author AI Management System
 * @date 2026-03-27
 */

import { MongoClient, type Db } from 'mongodb';
import client_promise from '@rnd-ai/shared-database';
import type { ToolHandlerContext } from '../types';
import { tenant_scoped_query_filter } from '../tenant-tool-scope';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum documents returned per diagnostic to keep LLM context manageable. */
const MAX_RESULTS = 20;

/** Default document limit when the caller does not specify one. */
const DEFAULT_LIMIT = 10;

/**
 * Formula lifecycle statuses the model may filter recent-formula diagnostics
 * by. Anything outside this allowlist is rejected — the model can never inject
 * an arbitrary filter value.
 */
const ALLOWED_FORMULA_STATUSES = [
  'draft',
  'testing',
  'approved',
  'rejected',
  'confirmed',
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Model-visible input for the mongo_query diagnostic tool. Deliberately carries
 * no collection, database, filter, projection, sort, or aggregation field.
 *
 * @param query_name - Name of a server-authored diagnostic (allowlisted).
 * @param status     - Optional formula status filter (allowlist-validated).
 * @param limit      - Optional document cap (clamped to 1..MAX_RESULTS).
 */
interface MongoDiagnosticParams {
  query_name?: string;
  status?: string;
  limit?: number;
}

/** Validated, server-controlled parameters passed to a diagnostic runner. */
interface DiagnosticSafeParams {
  status: (typeof ALLOWED_FORMULA_STATUSES)[number] | null;
  limit: number;
}

/**
 * A single server-authored diagnostic. `requires_tenant` marks queries that
 * read tenant data and therefore fail closed without a tenant scope.
 */
interface DiagnosticDefinition {
  description: string;
  requires_tenant: boolean;
  run: (
    context: DiagnosticRunContext,
    params: DiagnosticSafeParams,
  ) => Promise<unknown>;
}

/** Runtime handles a diagnostic runner may use. */
interface DiagnosticRunContext {
  main_db: Db;
  tenant_scope: { tenantId: { $in: (string | import('mongodb').ObjectId)[] } } | null;
}

// ---------------------------------------------------------------------------
// Raw-materials client cache (platform-global reference DB only)
// ---------------------------------------------------------------------------

/**
 * Module-level cache of connected MongoClient instances for the platform-global
 * raw-materials database, keyed by URI. Tenant diagnostics use the shared main
 * client (client_promise) instead so they honour tenant provenance.
 */
const raw_materials_client_cache = new Map<string, MongoClient>();

/**
 * Resolve the platform-global raw-materials database connection URI.
 *
 * @returns The raw-materials connection URI string.
 * @throws Error if RAW_MATERIALS_REAL_STOCK_MONGODB_URI is not set.
 */
function resolve_raw_materials_uri(): string {
  const uri = process.env.RAW_MATERIALS_REAL_STOCK_MONGODB_URI;
  if (!uri) {
    throw new Error(
      'Missing environment variable "RAW_MATERIALS_REAL_STOCK_MONGODB_URI".',
    );
  }
  return uri;
}

/**
 * Retrieve or create a cached MongoClient for the raw-materials database.
 *
 * @returns Connected MongoClient for the raw-materials database.
 * @throws Error if the URI is missing or the connection fails.
 */
async function get_raw_materials_client(): Promise<MongoClient> {
  const uri = resolve_raw_materials_uri();
  const cached = raw_materials_client_cache.get(uri);
  if (cached) {
    return cached;
  }
  const client = new MongoClient(uri, {
    maxPoolSize: 5,
    connectTimeoutMS: 10_000,
    serverSelectionTimeoutMS: 10_000,
  });
  await client.connect();
  raw_materials_client_cache.set(uri, client);
  return client;
}

// ---------------------------------------------------------------------------
// Diagnostic registry (server-authored, read-only)
// ---------------------------------------------------------------------------

/**
 * Registry of allowlisted diagnostics. Each entry owns its collection, filter,
 * and (where relevant) tenant predicate — none of which the model can supply.
 */
const NAMED_DIAGNOSTIC_QUERIES: Record<string, DiagnosticDefinition> = {
  tenant_formula_count: {
    description: "Count the caller's formulas, optionally filtered by status.",
    requires_tenant: true,
    run: async ({ main_db, tenant_scope }, params) => {
      const filter: Record<string, unknown> = { ...tenant_scope };
      if (params.status) {
        filter.status = params.status;
      }
      const count = await main_db.collection('formulas').countDocuments(filter);
      return { count };
    },
  },
  tenant_formula_status_breakdown: {
    description: "Count the caller's formulas grouped by lifecycle status.",
    requires_tenant: true,
    run: async ({ main_db, tenant_scope }) => {
      const rows = await main_db
        .collection('formulas')
        .aggregate([
          { $match: { ...tenant_scope } },
          { $group: { _id: '$status', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: MAX_RESULTS },
        ])
        .toArray();
      return rows.map((row) => ({ status: row._id ?? 'unknown', count: row.count }));
    },
  },
  tenant_recent_formulas: {
    description:
      "List the caller's most recently updated formulas (code, name, status).",
    requires_tenant: true,
    run: async ({ main_db, tenant_scope }, params) => {
      const filter: Record<string, unknown> = { ...tenant_scope };
      if (params.status) {
        filter.status = params.status;
      }
      const docs = await main_db
        .collection('formulas')
        .find(filter, {
          projection: {
            formulaCode: 1,
            formulaName: 1,
            status: 1,
            version: 1,
            updatedAt: 1,
          },
        })
        .sort({ updatedAt: -1, _id: -1 })
        .limit(params.limit)
        .toArray();
      return docs.map((doc) => ({
        formula_id: doc._id.toString(),
        formula_code: doc.formulaCode ?? null,
        formula_name: doc.formulaName ?? null,
        status: doc.status ?? null,
        version: doc.version ?? null,
      }));
    },
  },
  raw_material_count: {
    description:
      'Count platform-global raw materials in the shared reference database.',
    requires_tenant: false,
    run: async () => {
      const client = await get_raw_materials_client();
      const count = await client
        .db('raw_materials')
        .collection('raw_materials_console')
        .countDocuments({});
      return { count };
    },
  },
};

// ---------------------------------------------------------------------------
// Parameter validation
// ---------------------------------------------------------------------------

/**
 * Validate and clamp the model-supplied scalar parameters. Unknown status
 * values are rejected so the model cannot inject an arbitrary filter value.
 *
 * @param params - Raw model-supplied parameters.
 * @returns Validated safe parameters, or an error string.
 */
function validate_safe_params(
  params: MongoDiagnosticParams,
): DiagnosticSafeParams | { error: string } {
  let status: DiagnosticSafeParams['status'] = null;
  if (params.status !== undefined && params.status !== null) {
    if (!ALLOWED_FORMULA_STATUSES.includes(params.status as never)) {
      return {
        error:
          `Error: status "${params.status}" is not allowed. ` +
          `Allowed: ${ALLOWED_FORMULA_STATUSES.join(', ')}.`,
      };
    }
    status = params.status as DiagnosticSafeParams['status'];
  }

  const requested = Number(params.limit ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), MAX_RESULTS)
    : DEFAULT_LIMIT;

  return { status, limit };
}

// ---------------------------------------------------------------------------
// Main Handler
// ---------------------------------------------------------------------------

/**
 * Handle the `mongo_query` diagnostic tool call.
 *
 * Workflow:
 * 1. Resolve the named diagnostic (reject unknown names).
 * 2. Validate the narrow scalar parameters (reject disallowed values).
 * 3. Resolve the tenant scope from the trusted context; fail closed when a
 *    tenant-scoped diagnostic has no tenant.
 * 4. Run the server-authored diagnostic and return its JSON result.
 *
 * @param params  - MongoDiagnosticParams (query_name + validated scalars only).
 * @param context - Tool handler context; its verified tenant_id scopes every
 *                  tenant diagnostic. Never throws — errors are returned as
 *                  descriptive strings.
 * @returns JSON string of the diagnostic result, or a descriptive error string.
 */
export async function handle_mongo_query(
  params: MongoDiagnosticParams,
  context?: ToolHandlerContext,
): Promise<string> {
  const start_ts = Date.now();
  console.log('[mongo-query-handler] handle_mongo_query — start', {
    query_name: params.query_name,
    status: params.status,
    limit: params.limit,
    tenant_id: context?.tenant_id,
  });

  const available = Object.keys(NAMED_DIAGNOSTIC_QUERIES).join(', ');

  if (!params.query_name) {
    return (
      'Error: query_name is required. Free-form collection/filter/aggregation ' +
      `is no longer allowed. Choose an allowlisted diagnostic: ${available}.`
    );
  }

  const definition = NAMED_DIAGNOSTIC_QUERIES[params.query_name];
  if (!definition) {
    return `Error: unknown diagnostic "${params.query_name}". Allowed: ${available}.`;
  }

  const safe_params = validate_safe_params(params);
  if ('error' in safe_params) {
    return safe_params.error;
  }

  const tenant_scope = tenant_scoped_query_filter(context?.tenant_id);
  if (definition.requires_tenant && !tenant_scope) {
    return (
      `Error: diagnostic "${params.query_name}" requires a tenant scope, but ` +
      'no verified tenant is present in the execution context.'
    );
  }

  try {
    const main_client = await client_promise;
    const main_db = main_client.db();

    const result = await definition.run(
      { main_db, tenant_scope },
      safe_params,
    );

    const elapsed = Date.now() - start_ts;
    console.log('[mongo-query-handler] handle_mongo_query — done', {
      query_name: params.query_name,
      elapsed_ms: elapsed,
    });

    const header =
      `MongoDB diagnostic result — query: "${params.query_name}", elapsed: ${elapsed}ms\n`;
    return header + JSON.stringify(result, null, 2);
  } catch (error) {
    const elapsed = Date.now() - start_ts;
    const err_msg = error instanceof Error ? error.message : String(error);
    console.log('[mongo-query-handler] handle_mongo_query — error', {
      query_name: params.query_name,
      error: err_msg,
      elapsed_ms: elapsed,
    });
    return `MongoDB diagnostic "${params.query_name}" failed: ${err_msg}`;
  }
}
