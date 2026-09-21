import type { Db } from "mongodb";

import { create_membership_repository } from "../repositories/membership-repository";
import { create_tenant_repository } from "../repositories/tenant-repository";
import { create_user_profile_repository } from "../repositories/user-profile-repository";
import type { IdentityProjectionRepositories } from "./clerk-principal-resolver";

/**
 * Assemble the identity projection repository ports for the Clerk resolver
 * from a connected database handle. Role-reconciliation events append to
 * platform_audit_events for operator review.
 *
 * @param db - Connected MongoDB database.
 * @returns Repository ports consumed by resolve_clerk_principal.
 */
export function create_identity_projection_repositories(
  db: Db,
): IdentityProjectionRepositories {
  return {
    user_profiles: create_user_profile_repository(db),
    tenants: create_tenant_repository(db),
    memberships: create_membership_repository(db),
    audit: {
      async record_role_reconciliation(event) {
        await db.collection("platform_audit_events").insertOne({
          action: "role_reconciliation",
          clerkUserId: event.clerk_user_id,
          clerkOrganizationId: event.clerk_org_id,
          clerkOrgRole: event.clerk_org_role,
          internalTenantRole: event.internal_tenant_role,
          occurredAt: event.occurred_at,
        });
      },
    },
  };
}
