import { ObjectId, type Collection, type Document, type WithId } from "mongodb";
import type { Permission, TenantExecutionContext } from "@rnd-ai/shared-types";

/**
 * Caller-supplied payload keys that are always server-derived. Any input
 * containing one of these is rejected before touching the database so a
 * forged body can never re-home a record to another tenant or actor.
 */
export const SECURITY_INPUT_FIELDS = [
  "tenantId",
  "organizationId",
  "actorProfileId",
  "ownerProfileId",
] as const;

/**
 * Typed not-found failure with a stable machine code (for example
 * "FORMULA_NOT_FOUND"). Cross-tenant access, a missing ID, and a malformed
 * ID all throw this exact shape so a probe cannot distinguish "exists in
 * another tenant" from "does not exist".
 */
export class ResourceNotFoundError extends Error {
  readonly code: string;

  /**
   * Create a typed not-found failure.
   *
   * @param code - Stable resource-specific code, e.g. "ORDER_NOT_FOUND".
   */
  constructor(code: string) {
    super("The requested resource was not found.");
    this.name = "ResourceNotFoundError";
    this.code = code;
  }
}

/**
 * Typed permission failure, deliberately distinct from ResourceNotFoundError:
 * a missing permission is an authorization outcome, not resource hiding.
 */
export class PermissionDeniedError extends Error {
  readonly code = "FORBIDDEN";

  /**
   * Create a typed permission failure.
   *
   * @param permission - The named permission the context lacked.
   */
  constructor(permission: Permission) {
    super(`The current context lacks the "${permission}" permission.`);
    this.name = "PermissionDeniedError";
  }
}

/**
 * Build the mandatory tenant filter fragment for every collection access.
 *
 * Accepts ONLY a TenantExecutionContext — never a raw tenant ID — so a
 * repository method cannot be handed an attacker-chosen tenant.
 *
 * NOTE (deviation from the plan's implementation anchor): tenantId is
 * returned as a STRING, not an ObjectId. The G2.3 ownership backfill
 * (apps/ai/server/services/migrations/tenant-ownership-mapper.ts) and the
 * G1.2 identity projections both persist tenantId as strings, so an
 * ObjectId filter would never match any scoped document.
 *
 * @param context - Verified per-request tenant execution context.
 * @returns Filter fragment `{ tenantId: <string tenant id> }`.
 */
export function tenant_scope(context: TenantExecutionContext): { tenantId: string } {
  return { tenantId: context.tenant_id };
}

/**
 * Parse a caller-supplied resource ID, folding malformed IDs into the same
 * not-found shape as missing or cross-tenant IDs.
 *
 * @param id - Caller-supplied resource ID string.
 * @param not_found_code - Stable code to throw for an invalid ID.
 * @returns Parsed ObjectId.
 * @throws ResourceNotFoundError when the ID is not a valid ObjectId.
 */
export function object_id_or_not_found(id: string, not_found_code: string): ObjectId {
  if (!ObjectId.isValid(id)) throw new ResourceNotFoundError(not_found_code);
  return new ObjectId(id);
}

/**
 * Build the canonical scoped-by-ID filter used by every get/update/delete:
 * `{ _id: new ObjectId(id), ...tenant_scope(context) }`.
 *
 * @param context - Verified tenant execution context.
 * @param id - Caller-supplied resource ID string.
 * @param not_found_code - Stable code for invalid IDs.
 * @returns MongoDB filter document.
 * @throws ResourceNotFoundError when the ID is malformed.
 */
export function scoped_id_filter(
  context: TenantExecutionContext,
  id: string,
  not_found_code: string,
): Document {
  return { _id: object_id_or_not_found(id, not_found_code), ...tenant_scope(context) };
}

/**
 * Reject any payload carrying a server-derived security field. Runs BEFORE
 * any database access so forged ownership never reaches a write path.
 *
 * @param input - Caller-supplied create/update payload.
 * @throws Error naming the offending security field.
 */
export function assert_no_security_fields(input: Record<string, unknown>): void {
  for (const field of SECURITY_INPUT_FIELDS) {
    if (field in input) {
      throw new Error(
        `Input must not contain security field "${field}"; it is derived from the tenant execution context.`,
      );
    }
  }
}

/**
 * Assert the context carries a named permission.
 *
 * @param context - Verified tenant execution context.
 * @param permission - Required named permission.
 * @throws PermissionDeniedError (code "FORBIDDEN") when absent.
 */
export function require_permission(
  context: TenantExecutionContext,
  permission: Permission,
): void {
  if (!context.permissions.includes(permission)) {
    throw new PermissionDeniedError(permission);
  }
}

/**
 * Fetch one tenant-scoped document by ID.
 *
 * @param collection - Target collection.
 * @param context - Verified tenant execution context.
 * @param id - Caller-supplied resource ID string.
 * @param not_found_code - Stable code for every failure mode.
 * @returns The scoped document.
 * @throws ResourceNotFoundError for cross-tenant, missing, or malformed IDs.
 */
export async function get_scoped_document(
  collection: Collection<Document>,
  context: TenantExecutionContext,
  id: string,
  not_found_code: string,
): Promise<WithId<Document>> {
  const document = await collection.findOne(scoped_id_filter(context, id, not_found_code));
  if (!document) throw new ResourceNotFoundError(not_found_code);
  return document;
}

/**
 * List every document belonging to the context tenant, optionally narrowed
 * by an extra business filter that can never widen the tenant scope.
 *
 * @param collection - Target collection.
 * @param context - Verified tenant execution context.
 * @param extra_filter - Optional additional business filter fields.
 * @returns Scoped documents.
 */
export async function list_scoped_documents(
  collection: Collection<Document>,
  context: TenantExecutionContext,
  extra_filter: Document = {},
): Promise<WithId<Document>[]> {
  return collection.find({ ...extra_filter, ...tenant_scope(context) }).toArray();
}

/**
 * Apply a $set patch to one tenant-scoped document by ID.
 *
 * @param collection - Target collection.
 * @param context - Verified tenant execution context.
 * @param id - Caller-supplied resource ID string.
 * @param not_found_code - Stable code for every failure mode.
 * @param patch - Business fields to set (security fields rejected).
 * @param extra_filter - Optional extra filter (e.g. owner/status guards).
 * @returns The updated document.
 * @throws Error when the patch carries a security field.
 * @throws ResourceNotFoundError for cross-tenant, missing, malformed, or
 *   guard-filtered IDs (identical shape by design).
 */
export async function update_scoped_document(
  collection: Collection<Document>,
  context: TenantExecutionContext,
  id: string,
  not_found_code: string,
  patch: Record<string, unknown>,
  extra_filter: Document = {},
): Promise<WithId<Document>> {
  assert_no_security_fields(patch);
  const updated = await collection.findOneAndUpdate(
    { ...scoped_id_filter(context, id, not_found_code), ...extra_filter },
    { $set: { ...patch, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!updated) throw new ResourceNotFoundError(not_found_code);
  return updated;
}

/**
 * Delete one tenant-scoped document by ID.
 *
 * @param collection - Target collection.
 * @param context - Verified tenant execution context.
 * @param id - Caller-supplied resource ID string.
 * @param not_found_code - Stable code for every failure mode.
 * @throws ResourceNotFoundError for cross-tenant, missing, or malformed IDs.
 */
export async function delete_scoped_document(
  collection: Collection<Document>,
  context: TenantExecutionContext,
  id: string,
  not_found_code: string,
): Promise<void> {
  const result = await collection.deleteOne(scoped_id_filter(context, id, not_found_code));
  if (result.deletedCount === 0) throw new ResourceNotFoundError(not_found_code);
}

/** Ownership stamping mode for scoped inserts. */
export type OwnershipStamp = "actor" | "owner" | "both";

/**
 * Insert a document with tenant/actor ownership derived exclusively from the
 * context. The input is rejected before database access if it carries any
 * security field; tenantId (and actorProfileId/ownerProfileId per the stamp
 * mode) are then written from context values only.
 *
 * @param collection - Target collection.
 * @param context - Verified tenant execution context.
 * @param input - Validated business fields (no security fields allowed).
 * @param ownership - Which ownership fields to stamp from the context:
 *   "actor" stamps actorProfileId, "owner" stamps ownerProfileId, "both"
 *   stamps both. Defaults to "actor".
 * @returns The inserted document including its new _id.
 * @throws Error when the input carries a security field.
 */
export async function insert_scoped_document(
  collection: Collection<Document>,
  context: TenantExecutionContext,
  input: Record<string, unknown>,
  ownership: OwnershipStamp = "actor",
): Promise<WithId<Document>> {
  assert_no_security_fields(input);
  const now = new Date();
  const document: Document = {
    ...input,
    ...tenant_scope(context),
    createdAt: now,
    updatedAt: now,
  };
  if (ownership === "actor" || ownership === "both") {
    document.actorProfileId = context.actor_profile_id;
  }
  if (ownership === "owner" || ownership === "both") {
    document.ownerProfileId = context.actor_profile_id;
  }
  const result = await collection.insertOne(document);
  return { _id: result.insertedId, ...document } as WithId<Document>;
}
