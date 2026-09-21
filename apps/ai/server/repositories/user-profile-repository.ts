import { ObjectId, type Db, type Document, type WithId } from "mongodb";

/**
 * Input for creating an internal user profile projected from a Clerk user.
 */
export interface CreateUserProfileInput {
  readonly clerk_user_id: string;
  readonly primary_email: string;
  readonly display_name: string;
  readonly legacy_account_id?: string;
  readonly platform_role?: "super_admin" | "admin";
}

/**
 * Repository over the user_profiles collection. Exposes explicit
 * active-record lookups only — no generic findOne filter reaches routers.
 */
export interface UserProfileRepository {
  create_user_profile(input: CreateUserProfileInput): Promise<WithId<Document>>;
  find_active_by_clerk_user_id(clerk_user_id: string): Promise<WithId<Document> | null>;
  find_active_by_id(profile_id: string): Promise<WithId<Document> | null>;
  count_active_platform_admins(): Promise<number>;
}

/**
 * Create the user-profile repository bound to a database handle.
 *
 * @param db - Connected MongoDB database.
 * @returns Repository instance.
 */
export function create_user_profile_repository(db: Db): UserProfileRepository {
  const profiles = db.collection("user_profiles");
  return {
    async create_user_profile(input) {
      const now = new Date();
      const document: Document = {
        clerkUserId: input.clerk_user_id,
        legacyAccountId: input.legacy_account_id ?? null,
        primaryEmail: input.primary_email,
        displayName: input.display_name,
        platformRole: input.platform_role ?? null,
        status: "active",
        clerkSyncVersion: 0,
        clerkSyncedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      const result = await profiles.insertOne(document);
      return { _id: result.insertedId, ...document } as WithId<Document>;
    },

    async find_active_by_clerk_user_id(clerk_user_id) {
      return profiles.findOne({ clerkUserId: clerk_user_id, status: "active" });
    },

    async find_active_by_id(profile_id) {
      if (!ObjectId.isValid(profile_id)) return null;
      return profiles.findOne({ _id: new ObjectId(profile_id), status: "active" });
    },

    async count_active_platform_admins() {
      return profiles.countDocuments({
        platformRole: { $in: ["super_admin", "admin"] },
        status: "active",
      });
    },
  };
}
