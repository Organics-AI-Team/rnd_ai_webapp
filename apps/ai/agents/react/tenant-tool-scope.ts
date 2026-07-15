/**
 * Tenant scoping for legacy ReAct tool handlers (G2.6).
 *
 * The ReAct tool paths are retained only until the OODA/agentic orchestrator
 * replaces them (G4 merged; retirement in G5). Until then, every handler that
 * loads or mutates a tenant record MUST inject the tenant predicate from the
 * trusted server-side execution context — never from a model-supplied tool
 * argument. A model can propose a record ID; deterministic code decides which
 * tenant that lookup runs against.
 */

import { ObjectId } from "mongodb";

/**
 * Provenance field carrying tenant ownership on every tenant-scoped collection
 * (added by G2.2). Kept as a named constant so the predicate is defined once
 * and reused by every scoping helper.
 */
export const TENANT_PROVENANCE_FIELD = "tenantId" as const;

/** A tenant-match `$in` clause spanning both stored tenant ID encodings. */
export type TenantMatchClause = { $in: (string | ObjectId)[] };

/**
 * Build the tenant-match `$in` clause for a verified scope.
 *
 * Tenant IDs were backfilled under two encodings (string and ObjectId), so the
 * clause matches both. The tenant ID comes exclusively from the server-injected
 * execution context; an absent scope yields null so callers fail closed.
 *
 * @param tenant_id - Verified tenant ID from the execution context (trusted).
 * @returns `{ $in: [...] }` clause, or null when no tenant scope is present.
 */
export function tenant_match_clause(
  tenant_id: string | undefined,
): TenantMatchClause | null {
  if (!tenant_id) {
    return null;
  }
  const tenant_values: (string | ObjectId)[] = [tenant_id];
  if (ObjectId.isValid(tenant_id)) {
    tenant_values.push(new ObjectId(tenant_id));
  }
  return { $in: tenant_values };
}

/**
 * Build a Mongo filter that pins a single record ID to the caller's tenant.
 *
 * The tenant ID comes exclusively from the server-injected execution context.
 * A malformed record ID or an absent tenant scope both produce null so the
 * caller fails closed (treats the lookup as not-found) rather than running an
 * unscoped query that could reveal another tenant's record.
 *
 * @param record_id - Model-supplied resource ID (untrusted).
 * @param tenant_id - Verified tenant ID from the execution context (trusted).
 * @returns Filter matching both string and ObjectId tenant encodings, or null
 *          when the record ID is malformed or no tenant scope is present.
 */
export function tenant_scoped_id_filter(
  record_id: string,
  tenant_id: string | undefined,
): { _id: ObjectId; tenantId: TenantMatchClause } | null {
  const clause = tenant_match_clause(tenant_id);
  if (!clause || !ObjectId.isValid(record_id)) {
    return null;
  }
  return { _id: new ObjectId(record_id), tenantId: clause };
}

/**
 * Build a tenant-scope predicate to AND into a multi-document search query.
 *
 * Unlike {@link tenant_scoped_id_filter} this carries no `_id` — it is the
 * tenant clause a list/search handler must combine with its own text filter so
 * results can never span tenants. Returns null when no tenant scope is present
 * so the caller fails closed rather than searching every tenant's records.
 *
 * @param tenant_id - Verified tenant ID from the execution context (trusted).
 * @returns `{ tenantId: { $in: [...] } }` predicate, or null when unscoped.
 */
export function tenant_scoped_query_filter(
  tenant_id: string | undefined,
): { tenantId: TenantMatchClause } | null {
  const clause = tenant_match_clause(tenant_id);
  return clause ? { tenantId: clause } : null;
}
