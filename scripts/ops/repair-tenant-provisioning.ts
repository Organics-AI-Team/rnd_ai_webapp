/**
 * Re-drive provisioning for a tenant stuck in repair_required.
 *
 * Provisioning marks a tenant repair_required when external Clerk state is
 * unprovable (for example: the organizations feature was disabled on the
 * instance). After the operator fixes the external cause, this script
 * replays the SAME provisioning flow with the tenant's original
 * idempotency key, so begin_or_load resumes the existing record and every
 * step stays idempotent — no parallel code path, no hand-written writes.
 *
 * Usage:
 *   npx tsx scripts/ops/repair-tenant-provisioning.ts <tenant_id> <manager_email>
 *
 * @param tenant_id - Mongo _id of the repair_required tenant document.
 * @param manager_email - Initial manager email to (re)invite; the invitation
 *   step is idempotent over pending Clerk invitations.
 * Environment: MONGODB_URI, CLERK_SECRET_KEY (server-only).
 */
import { ObjectId } from "mongodb";
import { createClerkClient } from "@clerk/backend";
import client_promise from "@rnd-ai/shared-database";
import type { RequestPrincipal } from "@rnd-ai/shared-types";

import { provision_university } from "../../apps/ai/server/services/provisioning/provision-university";
import {
  create_production_provisioning_ports,
  type ClerkBackendLike,
} from "../../apps/ai/server/services/provisioning/production-ports";

/**
 * Build the narrow Clerk backend view from the private secret.
 *
 * @returns Clerk backend client restricted to the provisioning surface.
 * @throws Error when CLERK_SECRET_KEY is not configured.
 */
function operator_clerk_client(): ClerkBackendLike {
  const secret = process.env.CLERK_SECRET_KEY?.trim();
  if (!secret) throw new Error("CLERK_SECRET_KEY is required");
  const clerk = createClerkClient({ secretKey: secret });
  return {
    organizations: {
      createOrganization: (params) => clerk.organizations.createOrganization(params),
      getOrganization: (params) => clerk.organizations.getOrganization(params),
      createOrganizationInvitation: (params) =>
        clerk.organizations.createOrganizationInvitation(params),
      getOrganizationInvitationList: async (params) => {
        const response = await clerk.organizations.getOrganizationInvitationList(
          params as never,
        );
        return {
          data: response.data.map((invitation) => ({
            id: invitation.id,
            emailAddress: invitation.emailAddress,
            role: invitation.role,
            status: String(invitation.status),
          })),
        };
      },
    },
  };
}

/**
 * Replay provisioning for the stuck tenant using its stored provisioningKey.
 *
 * @param tenant_id - Tenant document id in repair_required status.
 * @param manager_email - Manager email for the idempotent invitation step.
 * @returns Activation result from the provisioning flow.
 * @throws Error when the tenant is missing or not repair_required.
 */
async function repair_tenant(tenant_id: string, manager_email: string) {
  console.info({ boundary: "ops", event: "repair_tenant.start", tenant_id });
  const client = await client_promise;
  const db = client.db();
  const tenant = await db
    .collection("tenants")
    .findOne({ _id: new ObjectId(tenant_id) });
  if (!tenant) throw new Error(`tenant ${tenant_id} not found`);
  if (tenant.status !== "repair_required") {
    throw new Error(
      `tenant ${tenant_id} is '${tenant.status}', not repair_required — nothing to repair`,
    );
  }

  // Operator identity for the audit trail; permission checks require the
  // platform tenant-creation permission this synthetic principal carries.
  const operator: RequestPrincipal = {
    auth_provider: "clerk",
    provider_user_id: "ops:repair-tenant-provisioning",
    internal_user_id: String(tenant.createdByProfileId),
    active_tenant_id: null,
    platform_role: "super_admin",
    tenant_role: null,
    permissions: ["platform:tenants:create"],
    membership_status: null,
  };

  const result = await provision_university(
    operator,
    {
      name: tenant.name,
      slug: tenant.slug,
      region: tenant.dataResidencyRegion,
      plan_key: tenant.planKey,
      initial_manager_email: manager_email,
      // The ORIGINAL idempotency key resumes the same tenant record.
      idempotency_key: tenant.provisioningKey,
    },
    create_production_provisioning_ports(db, operator_clerk_client()),
  );
  console.info({ boundary: "ops", event: "repair_tenant.done", tenant_id, result });
  return result;
}

const [tenant_id, manager_email] = [process.argv[2] ?? "", process.argv[3] ?? ""];
if (!tenant_id || !manager_email) {
  console.error(
    "usage: npx tsx scripts/ops/repair-tenant-provisioning.ts <tenant_id> <manager_email>",
  );
  process.exit(1);
}
repair_tenant(tenant_id, manager_email.trim().toLowerCase())
  .then(async (result) => {
    console.log(JSON.stringify(result, null, 2));
    await (await client_promise).close();
  })
  .catch(async (error) => {
    console.error("repair-tenant-provisioning failed:", error.message ?? error);
    await (await client_promise).close();
    process.exitCode = 1;
  });
