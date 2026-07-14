import type { Db, Document, WithId } from "mongodb";

/**
 * Input for creating a tenant membership projection.
 */
export interface CreateMembershipInput {
  readonly tenant_id: string;
  readonly user_profile_id: string;
  readonly tenant_role: "manager" | "user";
  readonly status: "invited" | "active" | "suspended" | "revoked";
  readonly clerk_membership_id?: string;
}

/**
 * Repository over the tenant_membership_projections collection. Exposes
 * explicit active-record lookups only.
 */
export interface MembershipRepository {
  create_membership(input: CreateMembershipInput): Promise<WithId<Document>>;
  find_active_membership(
    tenant_id: string,
    user_profile_id: string,
  ): Promise<WithId<Document> | null>;
  find_active_memberships_for_profile(
    user_profile_id: string,
  ): Promise<WithId<Document>[]>;
}

/**
 * Create the membership repository bound to a database handle.
 *
 * @param db - Connected MongoDB database.
 * @returns Repository instance.
 */
export function create_membership_repository(db: Db): MembershipRepository {
  const memberships = db.collection("tenant_membership_projections");
  return {
    async create_membership(input) {
      const now = new Date();
      const document: Document = {
        clerkMembershipId: input.clerk_membership_id ?? null,
        tenantId: input.tenant_id,
        userProfileId: input.user_profile_id,
        tenantRole: input.tenant_role,
        status: input.status,
        clerkSyncVersion: 0,
        clerkSyncedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      const result = await memberships.insertOne(document);
      return { _id: result.insertedId, ...document } as WithId<Document>;
    },

    async find_active_membership(tenant_id, user_profile_id) {
      return memberships.findOne({
        tenantId: tenant_id,
        userProfileId: user_profile_id,
        status: "active",
      });
    },

    async find_active_memberships_for_profile(user_profile_id) {
      return memberships
        .find({ userProfileId: user_profile_id, status: "active" })
        .toArray();
    },
  };
}
