/**
 * Clerk/Mongo identity reconciliation (G1.5).
 *
 * Compares Clerk organization memberships against the internal projections
 * for one tenant, emits a JSON report, repairs safe missing projections, and
 * marks contradictory roles for manual repair (it never chooses a side).
 *
 * Usage: npm run reconcile:clerk -w apps/ai -- --tenant=<tenant-id>
 */

import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

/** One reconciliation finding. */
export interface ReconciliationFinding {
  readonly kind:
    | "missing_projection_repaired"
    | "contradictory_role_marked"
    | "orphaned_projection"
    | "missing_profile";
  readonly clerk_membership_id?: string;
  readonly clerk_user_id?: string;
  readonly detail: string;
}

/** Reconciliation report for one tenant. */
export interface ReconciliationReport {
  readonly tenant_id: string;
  readonly clerk_membership_count: number;
  readonly projection_count: number;
  readonly findings: ReconciliationFinding[];
}

/** Clerk membership view consumed by reconciliation. */
export interface ClerkMembershipView {
  readonly id: string;
  readonly clerk_user_id: string;
  readonly role: string;
}

/** Ports for reconciliation; injectable for tests and tooling. */
export interface ReconcileClerkPorts {
  list_clerk_memberships(clerk_organization_id: string): Promise<ClerkMembershipView[]>;
}

/**
 * Reconcile one tenant's Clerk memberships with the internal projections.
 *
 * @param db - Connected database handle.
 * @param tenant_id - Internal tenant ID to reconcile.
 * @param ports - Clerk listing port.
 * @returns JSON-serializable reconciliation report.
 */
export async function reconcile_tenant(
  db: Db,
  tenant_id: string,
  ports: ReconcileClerkPorts,
): Promise<ReconciliationReport> {
  const findings: ReconciliationFinding[] = [];
  const tenant = await db
    .collection("tenants")
    .findOne({ _id: new ObjectId(tenant_id) });
  if (!tenant?.clerkOrganizationId) {
    throw new Error("Tenant has no Clerk organization; nothing to reconcile.");
  }

  const clerk_memberships = await ports.list_clerk_memberships(
    String(tenant.clerkOrganizationId),
  );
  const projections = await db
    .collection("tenant_membership_projections")
    .find({ tenantId: tenant_id })
    .toArray();
  const projection_by_clerk_id = new Map(
    projections.map((p) => [String(p.clerkMembershipId), p]),
  );

  for (const membership of clerk_memberships) {
    const profile = await db
      .collection("user_profiles")
      .findOne({ clerkUserId: membership.clerk_user_id });
    if (!profile) {
      findings.push({
        kind: "missing_profile",
        clerk_user_id: membership.clerk_user_id,
        detail: "Clerk member has no internal profile; awaiting user webhook.",
      });
      continue;
    }
    const role = membership.role === "org:manager" || membership.role === "org:admin"
      ? "manager"
      : "user";
    const projection = projection_by_clerk_id.get(membership.id);
    if (!projection) {
      // Safe repair: Clerk is authoritative for membership existence. Keyed
      // by (tenantId, userProfileId) with revive semantics — a revoked
      // projection for the same pair is revived under the new Clerk
      // membership id instead of violating uniq_membership_tenant_profile.
      await db.collection("tenant_membership_projections").updateOne(
        { tenantId: tenant_id, userProfileId: profile._id.toString() },
        {
          $set: {
            clerkMembershipId: membership.id,
            tenantRole: role,
            status: "active",
            clerkSyncedAt: new Date(),
            updatedAt: new Date(),
          },
          $setOnInsert: {
            clerkSyncVersion: 0,
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );
      findings.push({
        kind: "missing_projection_repaired",
        clerk_membership_id: membership.id,
        detail: `Created or revived projection with role ${role}.`,
      });
      continue;
    }
    if (projection.tenantRole !== role) {
      // Contradiction: mark for manual repair, never choose a side.
      await db.collection("tenant_membership_projections").updateOne(
        { _id: projection._id },
        { $set: { reconciliationRequired: true, updatedAt: new Date() } },
      );
      await db.collection("platform_audit_events").insertOne({
        action: "membership_role_contradiction",
        tenantId: tenant_id,
        clerkMembershipId: membership.id,
        clerkRole: membership.role,
        internalRole: projection.tenantRole,
        occurred_at: new Date(),
      });
      findings.push({
        kind: "contradictory_role_marked",
        clerk_membership_id: membership.id,
        detail: `Clerk says ${role}, projection says ${String(projection.tenantRole)}.`,
      });
    }
  }

  const clerk_ids = new Set(clerk_memberships.map((m) => m.id));
  for (const projection of projections) {
    if (
      projection.clerkMembershipId &&
      !clerk_ids.has(String(projection.clerkMembershipId)) &&
      projection.status === "active"
    ) {
      findings.push({
        kind: "orphaned_projection",
        clerk_membership_id: String(projection.clerkMembershipId),
        detail: "Active projection has no Clerk membership; review for revocation.",
      });
    }
  }

  return {
    tenant_id,
    clerk_membership_count: clerk_memberships.length,
    projection_count: projections.length,
    findings,
  };
}

/**
 * Parse a required --name=value CLI argument.
 *
 * @param name - Argument name without dashes.
 * @returns Argument value.
 * @throws Error when missing.
 */
function require_cli_argument(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length)
    .trim();
  if (!value) throw new Error(`Missing required argument ${prefix}<value>`);
  return value;
}

/**
 * CLI entry: reconcile one tenant and print the JSON report.
 */
async function run_cli(): Promise<void> {
  const tenant_id = require_cli_argument("tenant");
  const { createClerkClient } = await import("@clerk/backend");
  const secret = process.env.CLERK_SECRET_KEY?.trim();
  if (!secret) throw new Error("CLERK_SECRET_KEY is not configured.");
  const clerk = createClerkClient({ secretKey: secret });
  const { default: client_promise } = await import("@rnd-ai/shared-database");
  const client = await client_promise;
  try {
    const report = await reconcile_tenant(client.db(), tenant_id, {
      async list_clerk_memberships(clerk_organization_id) {
        const response = await clerk.organizations.getOrganizationMembershipList({
          organizationId: clerk_organization_id,
          limit: 500,
        });
        return response.data.map((membership) => ({
          id: membership.id,
          clerk_user_id: membership.publicUserData?.userId ?? "",
          role: membership.role,
        }));
      },
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.close();
  }
}

const invoked_directly = process.argv[1]?.endsWith("reconcile-clerk.ts") ?? false;

if (invoked_directly) {
  run_cli().catch((error) => {
    console.error("reconcile:clerk failed:", error.message ?? error);
    process.exitCode = 1;
  });
}
