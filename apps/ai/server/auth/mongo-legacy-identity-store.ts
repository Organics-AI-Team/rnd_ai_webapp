import { ObjectId, type Db } from "mongodb";

import type {
  LegacyAccountRecord,
  LegacyIdentityStore,
  LegacyOrganizationRecord,
  LegacySessionRecord,
  LegacyUserRecord,
} from "./legacy-principal-resolver";

/**
 * Convert an untrusted ID string into an ObjectId, or null when malformed.
 *
 * @param id - Candidate MongoDB object ID string.
 * @returns The ObjectId, or null when the string is not a valid object ID.
 */
function safe_object_id(id: string): ObjectId | null {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

/**
 * Create a read-only LegacyIdentityStore backed by the legacy MongoDB
 * collections (sessions, accounts, users, organizations). Documents are
 * normalized to the resolver's record contracts; lookups never write.
 *
 * @param db - Connected MongoDB database handle.
 * @returns Store implementation used by the tRPC context principal resolution.
 */
export function create_legacy_identity_store(db: Db): LegacyIdentityStore {
  return {
    async find_session_by_token(token) {
      const session = await db.collection("sessions").findOne({ token });
      if (!session) return null;
      const record: LegacySessionRecord = {
        id: session._id.toString(),
        accountId: String(session.accountId),
        token: String(session.token),
        expiresAt: new Date(session.expiresAt),
      };
      return record;
    },

    async find_account_by_id(account_id) {
      const object_id = safe_object_id(account_id);
      if (!object_id) return null;
      const account = await db.collection("accounts").findOne({ _id: object_id });
      if (!account) return null;
      const record: LegacyAccountRecord = {
        id: account._id.toString(),
        email: String(account.email ?? ""),
        isActive: account.isActive !== false,
      };
      return record;
    },

    async find_user_by_account_id(account_id) {
      const user = await db.collection("users").findOne({ accountId: account_id });
      if (!user) return null;
      const record: LegacyUserRecord = {
        id: user._id.toString(),
        accountId: String(user.accountId),
        organizationId: String(user.organizationId ?? ""),
        name: String(user.name ?? ""),
        email: String(user.email ?? ""),
        role: (user.role as LegacyUserRecord["role"]) ?? "shopper",
        status: user.status === "suspend" ? "suspend" : "active",
        isActive: user.isActive !== false,
      };
      return record;
    },

    async find_organization_by_id(organization_id) {
      const object_id = safe_object_id(organization_id);
      if (!object_id) return null;
      const organization = await db
        .collection("organizations")
        .findOne({ _id: object_id });
      if (!organization) return null;
      const record: LegacyOrganizationRecord = {
        id: organization._id.toString(),
        isActive: organization.isActive !== false,
      };
      return record;
    },
  };
}
