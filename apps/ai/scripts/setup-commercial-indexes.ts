/**
 * Commercial identity index setup (G1.2).
 *
 * Creates the partial unique MongoDB indexes for nullable external
 * identifiers. Prisma @unique cannot express these because multiple
 * provisioning-phase records legitimately hold null. Run as a deployment
 * step (npm run setup:commercial-indexes -w apps/ai), never as a module
 * import side effect. Idempotent under repeated invocation.
 */

import type { Db, IndexSpecification, CreateIndexesOptions } from "mongodb";

interface CommercialIndex {
  readonly collection: string;
  readonly specification: IndexSpecification;
  readonly options: CreateIndexesOptions;
}

const commercial_indexes: readonly CommercialIndex[] = [
  {
    collection: "user_profiles",
    specification: { clerkUserId: 1 },
    options: { name: "uniq_user_profile_clerk_user", unique: true },
  },
  {
    collection: "user_profiles",
    specification: { legacyAccountId: 1 },
    options: {
      name: "uniq_user_profile_legacy_account_present",
      unique: true,
      partialFilterExpression: { legacyAccountId: { $type: "string" } },
    },
  },
  {
    collection: "tenants",
    specification: { clerkOrganizationId: 1 },
    options: {
      name: "uniq_tenant_clerk_org_present",
      unique: true,
      partialFilterExpression: { clerkOrganizationId: { $type: "string" } },
    },
  },
  {
    collection: "tenants",
    specification: { legacyOrganizationId: 1 },
    options: {
      name: "uniq_tenant_legacy_org_present",
      unique: true,
      partialFilterExpression: { legacyOrganizationId: { $type: "string" } },
    },
  },
  {
    collection: "tenants",
    specification: { slug: 1 },
    options: { name: "uniq_tenant_slug", unique: true },
  },
  {
    collection: "tenants",
    specification: { provisioningKey: 1 },
    options: { name: "uniq_tenant_provisioning_key", unique: true },
  },
  {
    collection: "tenant_membership_projections",
    specification: { clerkMembershipId: 1 },
    options: {
      name: "uniq_membership_clerk_id_present",
      unique: true,
      partialFilterExpression: { clerkMembershipId: { $type: "string" } },
    },
  },
  {
    collection: "tenant_membership_projections",
    specification: { tenantId: 1, userProfileId: 1 },
    options: { name: "uniq_membership_tenant_profile", unique: true },
  },
  {
    collection: "tenant_invitation_projections",
    specification: { clerkInvitationId: 1 },
    options: { name: "uniq_invitation_clerk_id", unique: true },
  },
  {
    collection: "clerk_webhook_receipts",
    specification: { eventId: 1 },
    options: { name: "uniq_webhook_receipt_event", unique: true },
  },
];

/**
 * Create or verify every commercial identity index.
 *
 * @param db - Connected MongoDB database.
 * @returns Names of the ensured indexes.
 */
export async function setup_commercial_indexes(db: Db): Promise<string[]> {
  const ensured: string[] = [];
  for (const index of commercial_indexes) {
    ensured.push(
      await db
        .collection(index.collection)
        .createIndex(index.specification, index.options),
    );
  }
  return ensured;
}

/**
 * CLI entry: connect using the shared database client and ensure indexes.
 */
async function run_cli(): Promise<void> {
  const { default: client_promise } = await import("@rnd-ai/shared-database");
  const client = await client_promise;
  const ensured = await setup_commercial_indexes(client.db());
  console.log(`setup:commercial-indexes — ensured ${ensured.length} indexes`);
  await client.close();
}

const invoked_directly =
  process.argv[1]?.endsWith("setup-commercial-indexes.ts") ?? false;

if (invoked_directly) {
  run_cli().catch((error) => {
    console.error("setup:commercial-indexes failed:", error);
    process.exitCode = 1;
  });
}
