import { randomUUID } from "node:crypto";
import { ObjectId, type Db, type Document, type WithId } from "mongodb";
import type { Permission } from "@rnd-ai/shared-types";
import type { SupportAccessGrantView } from "@rnd-ai/shared-types";

/**
 * Repository over support_access_grants. Explicit lifecycle methods only;
 * every mutation is audited by the caller.
 */
export interface SupportAccessRepository {
  create_request(input: {
    tenant_id: string;
    platform_profile_id: string;
    reason: string;
    permissions: readonly Permission[];
  }): Promise<WithId<Document>>;
  approve(
    grant_id: string,
    approved_by_profile_id: string,
    duration_hours: number,
  ): Promise<WithId<Document> | null>;
  revoke(grant_id: string): Promise<boolean>;
  find_active_for(
    tenant_id: string,
    platform_profile_id: string,
    now: Date,
  ): Promise<SupportAccessGrantView | null>;
}

/**
 * Map a grant document onto the shared view contract.
 *
 * @param document - Raw grant document.
 * @returns Shared SupportAccessGrantView.
 */
function to_view(document: any): SupportAccessGrantView {
  return {
    id: document._id.toString(),
    tenant_id: String(document.tenantId),
    platform_profile_id: String(document.platformProfileId),
    permissions: (document.permissions ?? []) as Permission[],
    approved_by_profile_id: document.approvedByProfileId
      ? String(document.approvedByProfileId)
      : null,
    approved_at: document.approvedAt ? new Date(document.approvedAt) : null,
    expires_at: document.expiresAt ? new Date(document.expiresAt) : null,
    revoked_at: document.revokedAt ? new Date(document.revokedAt) : null,
    correlation_id: String(document.correlationId),
  };
}

/**
 * Create the support-access repository bound to a database handle.
 *
 * @param db - Connected MongoDB database.
 * @returns Repository instance.
 */
export function create_support_access_repository(db: Db): SupportAccessRepository {
  const grants = db.collection("support_access_grants");
  return {
    async create_request(input) {
      const now = new Date();
      const document: Document = {
        tenantId: input.tenant_id,
        platformProfileId: input.platform_profile_id,
        reason: input.reason,
        permissions: [...input.permissions],
        requestedAt: now,
        approvedByProfileId: null,
        approvedAt: null,
        expiresAt: null,
        revokedAt: null,
        correlationId: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      const result = await grants.insertOne(document);
      return { _id: result.insertedId, ...document } as WithId<Document>;
    },

    async approve(grant_id, approved_by_profile_id, duration_hours) {
      if (!ObjectId.isValid(grant_id)) return null;
      const now = new Date();
      const expires_at = new Date(now.getTime() + duration_hours * 3_600_000);
      await grants.updateOne(
        { _id: new ObjectId(grant_id), approvedAt: null, revokedAt: null },
        {
          $set: {
            approvedByProfileId: approved_by_profile_id,
            approvedAt: now,
            expiresAt: expires_at,
            updatedAt: now,
          },
        },
      );
      return grants.findOne({ _id: new ObjectId(grant_id) });
    },

    async revoke(grant_id) {
      if (!ObjectId.isValid(grant_id)) return false;
      const result = await grants.updateOne(
        { _id: new ObjectId(grant_id), revokedAt: null },
        { $set: { revokedAt: new Date(), updatedAt: new Date() } },
      );
      return result.matchedCount > 0;
    },

    async find_active_for(tenant_id, platform_profile_id, now) {
      const document = await grants.findOne({
        tenantId: tenant_id,
        platformProfileId: platform_profile_id,
        approvedAt: { $ne: null },
        revokedAt: null,
        expiresAt: { $gt: now },
      });
      return document ? to_view(document) : null;
    },
  };
}
