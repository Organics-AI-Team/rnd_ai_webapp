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
 * Build a Mongo filter that pins a record ID to the caller's tenant.
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
): { _id: ObjectId; tenantId: { $in: (string | ObjectId)[] } } | null {
  if (!tenant_id || !ObjectId.isValid(record_id)) {
    return null;
  }
  const tenant_values: (string | ObjectId)[] = [tenant_id];
  if (ObjectId.isValid(tenant_id)) {
    tenant_values.push(new ObjectId(tenant_id));
  }
  return { _id: new ObjectId(record_id), tenantId: { $in: tenant_values } };
}
