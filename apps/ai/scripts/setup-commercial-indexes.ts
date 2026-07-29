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
  {
    collection: "tenant_ai_profiles",
    specification: { tenantId: 1 },
    options: { name: "uniq_tenant_ai_profile_tenant", unique: true },
  },
  {
    collection: "agent_deployments",
    specification: { tenantId: 1, agentKey: 1, revision: 1 },
    options: { name: "uniq_agent_deployment_revision", unique: true },
  },
  {
    collection: "agent_deployments",
    specification: { tenantId: 1, agentKey: 1, status: 1 },
    options: { name: "idx_agent_deployment_active_lookup" },
  },
  {
    collection: "platform_ai_state",
    specification: { key: 1 },
    options: { name: "uniq_platform_ai_state_key", unique: true },
  },
  {
    collection: "ai_rollout_assignments",
    specification: { tenantId: 1 },
    options: { name: "uniq_ai_rollout_assignment_tenant", unique: true },
  },
  {
    collection: "ai_rollout_events",
    specification: { idempotencyKey: 1 },
    options: { name: "uniq_ai_rollout_event_idempotency", unique: true },
  },
  {
    collection: "ai_rollout_events",
    specification: {
      tenantId: 1,
      eventType: 1,
      fromVersion: 1,
      toVersion: 1,
      actorProfileId: 1,
    },
    options: { name: "idx_ai_rollout_event_replay" },
  },
  {
    collection: "ai_runs",
    specification: { tenantId: 1, idempotencyKey: 1 },
    options: { name: "uniq_ai_run_tenant_idempotency", unique: true },
  },
  {
    collection: "ai_runs",
    specification: { correlationId: 1 },
    options: {
      name: "uniq_ai_run_correlation",
      unique: true,
      partialFilterExpression: { correlationId: { $type: "string" } },
    },
  },
  {
    collection: "ai_runs",
    specification: { tenantId: 1, status: 1, createdAt: -1 },
    options: { name: "idx_ai_run_tenant_status_created" },
  },
  {
    collection: "ai_usage_ledger",
    specification: { tenantId: 1, idempotencyKey: 1 },
    options: { name: "uniq_ai_usage_tenant_idempotency", unique: true },
  },
  {
    collection: "ai_usage_ledger",
    specification: { tenantId: 1, month: 1 },
    options: { name: "idx_ai_usage_tenant_month" },
  },
  {
    collection: "ai_usage_ledger",
    specification: { tenantId: 1, runId: 1, kind: 1, reservationId: 1 },
    options: { name: "idx_ai_usage_tenant_run_kind" },
  },
  {
    collection: "ai_usage_ledger",
    specification: { kind: 1, runId: 1 },
    options: { name: "idx_ai_usage_open_reservations" },
  },
  {
    collection: "ai_usage_counters",
    specification: { tenantId: 1, month: 1 },
    options: { name: "uniq_ai_usage_counter_tenant_month", unique: true },
  },
  {
    collection: "ai_artifacts",
    specification: { tenantId: 1, runId: 1, contentHash: 1 },
    options: { name: "uniq_ai_artifact_run_content", unique: true },
  },
  {
    collection: "ai_approvals",
    specification: { idempotencyKey: 1 },
    options: {
      name: "uniq_ai_approval_idempotency",
      unique: true,
      partialFilterExpression: { idempotencyKey: { $type: "string" } },
    },
  },
  {
    collection: "ai_approvals",
    specification: { tenantId: 1, runId: 1, checkpointId: 1, status: 1 },
    options: { name: "idx_ai_approval_run_checkpoint_status" },
  },
  {
    collection: "ai_approvals",
    specification: { tenantId: 1, runId: 1, artifactId: 1, status: 1 },
    options: { name: "idx_ai_approval_artifact_status" },
  },
  {
    collection: "ai_run_jobs",
    specification: { runId: 1, command: 1, idempotencyKey: 1 },
    options: { name: "uniq_ai_run_job_command", unique: true },
  },
  {
    collection: "ai_run_jobs",
    specification: { status: 1, availableAt: 1, createdAt: 1 },
    options: { name: "idx_ai_run_job_available" },
  },
  {
    collection: "ai_run_jobs",
    specification: { status: 1, leaseExpiresAt: 1, availableAt: 1, createdAt: 1 },
    options: { name: "idx_ai_run_job_expired_lease" },
  },
  {
    collection: "ai_run_events",
    specification: { runId: 1, sequence: 1 },
    options: { name: "uniq_ai_run_event_sequence", unique: true },
  },
  {
    collection: "ai_run_events",
    specification: { tenantId: 1, runId: 1, sequence: 1 },
    options: { name: "idx_ai_run_event_replay" },
  },
  {
    collection: "ai_tool_usage_events",
    specification: { tenantId: 1, idempotencyKey: 1 },
    options: { name: "uniq_ai_tool_usage_tenant_idempotency", unique: true },
  },
  {
    collection: "ai_tool_results",
    specification: { tenantId: 1, idempotencyKey: 1 },
    options: { name: "uniq_ai_tool_result_tenant_idempotency", unique: true },
  },
  {
    collection: "ai_commercial_events",
    specification: { occurred_at: 1 },
    options: { name: "idx_ai_commercial_event_occurred" },
  },
  {
    collection: "ai_incidents",
    specification: { status: 1, started_at: -1 },
    options: { name: "idx_ai_incident_active_started" },
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
