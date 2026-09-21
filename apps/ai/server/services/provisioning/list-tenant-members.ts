// apps/ai/server/services/provisioning/list-tenant-members.ts
import { ObjectId, type Db } from "mongodb";

/** One member row: membership projection joined with its user profile. */
export interface TenantMemberRow {
  _id: string;
  userProfileId: string;
  tenantRole: string;
  status: string;
  email: string;
  displayName: string;
  profileStatus: string;
}

/**
 * List membership projections for one university joined with profile
 * identity fields. Shared by the tenant members router (own tenant) and the
 * platform tenant detail view (any tenant, platform-authorized) — the
 * CALLER is responsible for authorization; this is a pure projection read.
 *
 * @param db - Connected database handle.
 * @param tenant_id - Tenant whose members are listed (pre-authorized).
 * @returns Member rows sorted by newest membership first.
 */
export async function list_tenant_members(
  db: Db,
  tenant_id: string,
): Promise<TenantMemberRow[]> {
  console.info({ boundary: "list-tenant-members", event: "list.start", tenant_id });
  const memberships = await db
    .collection("tenant_membership_projections")
    .find({ tenantId: tenant_id })
    .sort({ createdAt: -1 })
    .toArray();
  const profile_ids = memberships
    .map((m) => String(m.userProfileId))
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));
  const profiles = await db
    .collection("user_profiles")
    .find({ _id: { $in: profile_ids } })
    .project({ primaryEmail: 1, displayName: 1, status: 1 })
    .toArray();
  const profile_map = new Map(profiles.map((p) => [p._id.toString(), p]));
  const rows = memberships.map((membership) => ({
    _id: membership._id.toString(),
    userProfileId: String(membership.userProfileId),
    tenantRole: String(membership.tenantRole),
    status: String(membership.status),
    email: profile_map.get(String(membership.userProfileId))?.primaryEmail ?? "",
    displayName:
      profile_map.get(String(membership.userProfileId))?.displayName ?? "",
    profileStatus: String(
      profile_map.get(String(membership.userProfileId))?.status ?? "",
    ),
  }));
  console.info({
    boundary: "list-tenant-members",
    event: "list.done",
    tenant_id,
    count: rows.length,
  });
  return rows;
}
