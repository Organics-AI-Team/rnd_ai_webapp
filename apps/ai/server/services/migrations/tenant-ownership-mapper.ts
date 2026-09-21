import { createHash } from "node:crypto";
import { ObjectId, type Db } from "mongodb";

/**
 * Tenant ownership mapping (G2.3).
 *
 * Deterministic precedence: direct organizationId mapping → parent record's
 * tenantId → uniquely mapped legacy actor. Disagreement or absence
 * quarantines the record with its evidence — a tenant is never silently
 * assigned.
 */

/** Ownership evidence gathered per record. Malformed IDs enter as null. */
export interface OwnershipEvidence {
  readonly direct_tenant_id: string | null;
  readonly parent_tenant_id: string | null;
  readonly unique_actor_tenant_id: string | null;
}

/** Resolution outcome. */
export type OwnershipResolution =
  | { kind: "resolved"; tenant_id: string }
  | {
      kind: "quarantine";
      reason: "NO_OWNER" | "CONFLICTING_OWNERS";
      candidates: string[];
    };

/**
 * Check whether a string is a well-formed Mongo ObjectId.
 *
 * @param id - Candidate ID.
 * @returns True when valid.
 */
export function is_valid_object_id(id: string | null | undefined): boolean {
  return typeof id === "string" && ObjectId.isValid(id);
}

/**
 * Resolve tenant ownership from evidence. Pure and deterministic.
 *
 * @param evidence - Direct/parent/actor tenant candidates (nulls allowed).
 * @returns Resolved tenant or a quarantine decision with candidates.
 */
export function resolve_tenant_ownership(
  evidence: OwnershipEvidence,
): OwnershipResolution {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const candidate of [
    evidence.direct_tenant_id,
    evidence.parent_tenant_id,
    evidence.unique_actor_tenant_id,
  ]) {
    if (candidate && is_valid_object_id(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      candidates.push(candidate);
    }
  }
  if (candidates.length === 1) {
    return { kind: "resolved", tenant_id: candidates[0] };
  }
  return {
    kind: "quarantine",
    reason: candidates.length === 0 ? "NO_OWNER" : "CONFLICTING_OWNERS",
    candidates,
  };
}

/** Collections covered by the backfill, with their evidence sources. */
export const BACKFILL_COLLECTIONS: ReadonlyArray<{
  collection: string;
  parent?: { collection: string; local_field: string };
  actor_field?: string;
}> = [
  { collection: "products", actor_field: "createdBy" },
  { collection: "stock_entries", actor_field: "createdBy" },
  { collection: "formulas", actor_field: "createdBy" },
  { collection: "formula_version_logs", parent: { collection: "formulas", local_field: "formulaId" } },
  { collection: "formula_comments", parent: { collection: "formulas", local_field: "formulaId" } },
  { collection: "orders", actor_field: "createdBy" },
  { collection: "credit_transactions", actor_field: "performedBy" },
  { collection: "product_logs", actor_field: "userId" },
  { collection: "conversations", actor_field: "userId" },
  { collection: "feedback", actor_field: "userId" },
  { collection: "ai_responses", actor_field: "userId" },
  { collection: "chat_threads", actor_field: "userId" },
  { collection: "chat_messages", parent: { collection: "chat_threads", local_field: "threadId" } },
  { collection: "price_calculations", actor_field: "userId" },
];

/** Audit report shape shared by audit/backfill/verify. */
export interface TenantAuditReport {
  totals: {
    total: number;
    already_scoped: number;
    resolvable: number;
    ambiguous: number;
    orphaned: number;
    malformed: number;
    conflicts: number;
  };
  by_collection: Record<string, { total: number; resolvable: number; quarantined: number }>;
  by_tenant: Record<string, number>;
  bucket_hashes: Record<string, string>;
  audit_hash: string;
}

/**
 * SHA-256 over sorted record IDs.
 *
 * @param ids - Record IDs in a bucket.
 * @returns Hex digest.
 */
function hash_ids(ids: string[]): string {
  return createHash("sha256").update([...ids].sort().join("\n")).digest("hex");
}

/**
 * Build tenant lookup maps from legacy identifiers.
 *
 * @param db - Database handle.
 * @returns organizationId→tenantId and legacy userId→tenantId maps.
 */
async function build_lookup_maps(db: Db) {
  const org_to_tenant = new Map<string, string>();
  for (const tenant of await db.collection("tenants").find({ legacyOrganizationId: { $ne: null } }).toArray()) {
    org_to_tenant.set(String(tenant.legacyOrganizationId), tenant._id.toString());
  }
  const user_to_tenant = new Map<string, string | null>();
  for (const user of await db.collection("users").find({}).toArray()) {
    const tenant_id = org_to_tenant.get(String(user.organizationId)) ?? null;
    user_to_tenant.set(user._id.toString(), tenant_id);
  }
  return { org_to_tenant, user_to_tenant };
}

/**
 * Run the full ownership audit (dry-run scan of every listed collection).
 *
 * @param db - Database handle.
 * @returns Deterministic audit report with bucket hashes.
 */
export async function audit_tenant_ownership(db: Db): Promise<TenantAuditReport> {
  const { org_to_tenant, user_to_tenant } = await build_lookup_maps(db);
  const totals = { total: 0, already_scoped: 0, resolvable: 0, ambiguous: 0, orphaned: 0, malformed: 0, conflicts: 0 };
  const by_collection: TenantAuditReport["by_collection"] = {};
  const by_tenant: Record<string, number> = {};
  const buckets: Record<string, string[]> = { resolvable: [], quarantined: [], already_scoped: [] };

  for (const spec of BACKFILL_COLLECTIONS) {
    const stats = { total: 0, resolvable: 0, quarantined: 0 };
    const parent_cache = new Map<string, string | null>();
    for (const record of await db.collection(spec.collection).find({}).toArray()) {
      stats.total += 1;
      totals.total += 1;
      const id = record._id.toString();
      if (record.tenantId) {
        totals.already_scoped += 1;
        buckets.already_scoped.push(id);
        continue;
      }
      const org_raw = record.organizationId != null ? String(record.organizationId) : null;
      const malformed = org_raw !== null && !is_valid_object_id(org_raw);
      if (malformed) totals.malformed += 1;
      let parent_tenant: string | null = null;
      if (spec.parent && record[spec.parent.local_field] != null) {
        const parent_key = String(record[spec.parent.local_field]);
        if (!parent_cache.has(parent_key)) {
          const parent = is_valid_object_id(parent_key)
            ? await db.collection(spec.parent.collection).findOne({ _id: new ObjectId(parent_key) })
            : null;
          const parent_org = parent?.organizationId != null ? String(parent.organizationId) : null;
          parent_cache.set(
            parent_key,
            (parent?.tenantId != null ? String(parent.tenantId) : null) ??
              (parent_org ? org_to_tenant.get(parent_org) ?? null : null),
          );
        }
        parent_tenant = parent_cache.get(parent_key) ?? null;
      }
      const actor_raw = spec.actor_field && record[spec.actor_field] != null ? String(record[spec.actor_field]) : null;
      const resolution = resolve_tenant_ownership({
        direct_tenant_id: org_raw && !malformed ? org_to_tenant.get(org_raw) ?? null : null,
        parent_tenant_id: parent_tenant,
        unique_actor_tenant_id: actor_raw ? user_to_tenant.get(actor_raw) ?? null : null,
      });
      if (resolution.kind === "resolved") {
        totals.resolvable += 1;
        stats.resolvable += 1;
        buckets.resolvable.push(id);
        by_tenant[resolution.tenant_id] = (by_tenant[resolution.tenant_id] ?? 0) + 1;
      } else {
        stats.quarantined += 1;
        buckets.quarantined.push(id);
        if (resolution.reason === "CONFLICTING_OWNERS") totals.conflicts += 1;
        else totals.orphaned += 1;
        totals.ambiguous += resolution.reason === "CONFLICTING_OWNERS" ? 1 : 0;
      }
    }
    by_collection[spec.collection] = stats;
  }

  const bucket_hashes = Object.fromEntries(
    Object.entries(buckets).map(([bucket, ids]) => [bucket, hash_ids(ids)]),
  );
  const audit_hash = createHash("sha256")
    .update(JSON.stringify({ totals, by_collection, bucket_hashes }))
    .digest("hex");
  return { totals, by_collection, by_tenant, bucket_hashes, audit_hash };
}

/**
 * Apply the backfill: conditional updates matching _id and tenantId=null so
 * replay never overwrites a concurrent assignment; quarantined records get a
 * quarantine marker document; each batch writes a migration receipt.
 *
 * @param db - Database handle.
 * @param audit_hash - Hash from the reviewed audit run (must match).
 * @returns Applied/quarantined counts.
 */
export async function backfill_tenant_ownership(
  db: Db,
  audit_hash: string,
): Promise<{ applied: number; quarantined: number }> {
  const fresh = await audit_tenant_ownership(db);
  if (fresh.audit_hash !== audit_hash) {
    throw new Error(
      `Audit hash mismatch: data changed after the reviewed audit (expected ${audit_hash.slice(0, 12)}…, got ${fresh.audit_hash.slice(0, 12)}…). Re-run tenant:audit.`,
    );
  }
  const { org_to_tenant, user_to_tenant } = await build_lookup_maps(db);
  let applied = 0;
  let quarantined = 0;

  for (const spec of BACKFILL_COLLECTIONS) {
    const parent_cache = new Map<string, string | null>();
    for (const record of await db.collection(spec.collection).find({ tenantId: null }).toArray()) {
      const org_raw = record.organizationId != null ? String(record.organizationId) : null;
      let parent_tenant: string | null = null;
      if (spec.parent && record[spec.parent.local_field] != null) {
        const parent_key = String(record[spec.parent.local_field]);
        if (!parent_cache.has(parent_key)) {
          const parent = is_valid_object_id(parent_key)
            ? await db.collection(spec.parent.collection).findOne({ _id: new ObjectId(parent_key) })
            : null;
          const parent_org = parent?.organizationId != null ? String(parent.organizationId) : null;
          parent_cache.set(
            parent_key,
            (parent?.tenantId != null ? String(parent.tenantId) : null) ??
              (parent_org ? org_to_tenant.get(parent_org) ?? null : null),
          );
        }
        parent_tenant = parent_cache.get(parent_key) ?? null;
      }
      const actor_raw = spec.actor_field && record[spec.actor_field] != null ? String(record[spec.actor_field]) : null;
      const resolution = resolve_tenant_ownership({
        direct_tenant_id: org_raw && is_valid_object_id(org_raw) ? org_to_tenant.get(org_raw) ?? null : null,
        parent_tenant_id: parent_tenant,
        unique_actor_tenant_id: actor_raw ? user_to_tenant.get(actor_raw) ?? null : null,
      });
      if (resolution.kind === "resolved") {
        const result = await db.collection(spec.collection).updateOne(
          { _id: record._id, tenantId: null },
          { $set: { tenantId: resolution.tenant_id, updatedAt: new Date() } },
        );
        applied += result.modifiedCount;
      } else {
        await db.collection("tenant_ownership_quarantine").updateOne(
          { collection: spec.collection, recordId: record._id.toString() },
          {
            $set: {
              reason: resolution.reason,
              candidates: resolution.candidates,
              updatedAt: new Date(),
            },
            $setOnInsert: { createdAt: new Date() },
          },
          { upsert: true },
        );
        quarantined += 1;
      }
    }
    await db.collection("migration_receipts").insertOne({
      migration: "tenant_ownership_backfill",
      collection: spec.collection,
      auditHash: audit_hash,
      appliedSoFar: applied,
      quarantinedSoFar: quarantined,
      occurredAt: new Date(),
    });
  }
  return { applied, quarantined };
}
