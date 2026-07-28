/**
 * One-off: provision the first university on a fresh database, mirroring the
 * platform-tenants.create tRPC route with a super_admin principal derived from
 * the bootstrapped platform profile. Idempotent via provision_university's
 * create-or-get ports (safe to re-run).
 */
import { createClerkClient } from "@clerk/backend";
import client_promise from "@rnd-ai/shared-database";
import { PLATFORM_ROLE_PERMISSIONS, type RequestPrincipal } from "@rnd-ai/shared-types";
import { provision_university } from "../server/services/provisioning/provision-university";
import { create_production_provisioning_ports, type ClerkBackendLike } from "../server/services/provisioning/production-ports";

function require_arg(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length).trim();
  if (!value) throw new Error(`Missing required argument ${prefix}<value>`);
  return value;
}

function clerk_client(): ClerkBackendLike {
  const secret = process.env.CLERK_SECRET_KEY?.trim();
  if (!secret) throw new Error("CLERK_SECRET_KEY not configured");
  const clerk = createClerkClient({ secretKey: secret });
  return {
    organizations: {
      createOrganization: (p) => clerk.organizations.createOrganization(p),
      getOrganization: (p) => clerk.organizations.getOrganization(p),
      createOrganizationInvitation: (p) => clerk.organizations.createOrganizationInvitation(p),
      getOrganizationInvitationList: (p) => clerk.organizations.getOrganizationInvitationList(p),
      getOrganizationMembershipList: (p) => clerk.organizations.getOrganizationMembershipList(p),
    },
  } as ClerkBackendLike;
}

async function run(): Promise<void> {
  const actor: RequestPrincipal = {
    auth_provider: "clerk",
    provider_user_id: require_arg("clerk-user-id"),
    internal_user_id: require_arg("profile-id"),
    active_tenant_id: null,
    platform_role: "super_admin",
    tenant_role: null,
    permissions: PLATFORM_ROLE_PERMISSIONS.super_admin,
    membership_status: null,
  };
  const client = await client_promise;
  try {
    const ports = create_production_provisioning_ports(client.db(), clerk_client());
    const result = await provision_university(actor, {
      name: require_arg("name"),
      slug: require_arg("slug"),
      region: require_arg("region") as "sgp" | "bkk",
      plan_key: require_arg("plan"),
      initial_manager_email: require_arg("manager-email"),
      idempotency_key: require_arg("idempotency-key"),
    }, ports);
    console.log("provision:first-tenant — ok", JSON.stringify(result));
  } finally {
    await client.close();
  }
}

run().catch((e) => { console.error("provision:first-tenant failed:", e?.message ?? e); process.exitCode = 1; });
