// apps/ai/scripts/repair-multi-org-suspensions.ts
/**
 * Rollout repair script — Plan 3 Task 14 (Phase G, Step 2).
 *
 * The retired single-membership rule in the legacy apply_clerk_event handler
 * (pre-Plan-3) suspended any profile that accepted a second Clerk org
 * membership on the grounds that it implied a data-model invariant violation.
 * Plan 3 explicitly permits multi-org; those profiles must be reactivated.
 *
 * This script:
 *   1. Finds all tenant_membership_projections with status = "suspended" whose
 *      underlying user_profiles record is NOT independently suspended (i.e. the
 *      profile itself is active — the suspension was membership-only and driven
 *      by the single-membership guard).
 *   2. Reactivates those membership rows and records an audit entry.
 *
 * Safety defaults:
 *   --dry-run  (default ON) — prints what would change without writing.
 *   --commit   — required to apply changes.
 *   --tenant   — optional; restrict repairs to one tenant_id.
 *   --limit    — optional; cap rows processed (default 500).
 *
 * Usage (dry-run, always run this first):
 *   tsx scripts/repair-multi-org-suspensions.ts
 *
 * Usage (apply):
 *   tsx scripts/repair-multi-org-suspensions.ts --commit
 *
 * Usage (targeted):
 *   tsx scripts/repair-multi-org-suspensions.ts --commit --tenant=<id> --limit=100
 */

import type { Db } from "mongodb";

/** Parsed CLI arguments. */
export interface RepairArgs {
  readonly dry_run: boolean;
  readonly tenant_id: string | null;
  readonly limit: number;
}

/** One repair candidate row. */
export interface RepairCandidate {
  readonly membership_id: string;
  readonly tenant_id: string;
  readonly user_profile_id: string;
  readonly profile_status: string;
}

/** Side-effect boundary for the repair operation — injectable in tests. */
export interface RepairPorts {
  /**
   * Find membership rows suspended at the membership level while the
   * underlying profile is active (single-membership rule artefacts).
   *
   * @param tenant_id - When set, restrict results to this tenant.
   * @param limit - Maximum rows to return.
   * @returns Candidate rows to reactivate.
   */
  find_candidates(
    tenant_id: string | null,
    limit: number,
  ): Promise<RepairCandidate[]>;

  /**
   * Reactivate one membership projection and record an audit event.
   *
   * @param candidate - The row to reactivate.
   * @param dry_run - When true, log only — no DB writes.
   */
  reactivate(candidate: RepairCandidate, dry_run: boolean): Promise<void>;
}

/**
 * Parse CLI arguments from process.argv.
 *
 * @param args - Raw argv slice (after the first two interpreter entries).
 * @returns Parsed repair arguments.
 * @throws Error when --limit is not a positive integer.
 */
export function parse_repair_args(args: readonly string[]): RepairArgs {
  const has = (flag: string) => args.some((a) => a === flag || a.startsWith(`${flag}=`));
  const value_of = (flag: string): string | null => {
    const prefix = `${flag}=`;
    const match = args.find((a) => a.startsWith(prefix));
    return match ? match.slice(prefix.length).trim() : null;
  };

  const commit = has("--commit");
  const raw_limit = value_of("--limit");
  const limit_value = raw_limit !== null ? Number(raw_limit) : 500;
  if (!Number.isInteger(limit_value) || limit_value < 1) {
    throw new Error("--limit must be a positive integer");
  }

  return {
    dry_run: !commit,
    tenant_id: value_of("--tenant"),
    limit: limit_value,
  };
}

/**
 * Identify and optionally reactivate multi-org suspension artefacts.
 *
 * @param args - Parsed repair arguments.
 * @param ports - Side-effect boundary (DB + audit in production, fakes in tests).
 * @returns Count of candidates found and count actually reactivated.
 */
export async function repair_multi_org_suspensions(
  args: RepairArgs,
  ports: RepairPorts,
): Promise<{ candidates: number; reactivated: number }> {
  console.info({
    script: "repair-multi-org-suspensions",
    event: "start",
    dry_run: args.dry_run,
    tenant_id: args.tenant_id,
    limit: args.limit,
  });

  const candidates = await ports.find_candidates(args.tenant_id, args.limit);

  console.info({
    script: "repair-multi-org-suspensions",
    event: "candidates.found",
    count: candidates.length,
    dry_run: args.dry_run,
  });

  let reactivated = 0;
  for (const candidate of candidates) {
    await ports.reactivate(candidate, args.dry_run);
    if (!args.dry_run) reactivated++;
    else reactivated++; // count for reporting even in dry-run
  }

  console.info({
    script: "repair-multi-org-suspensions",
    event: "complete",
    candidates: candidates.length,
    reactivated: args.dry_run ? 0 : reactivated,
    dry_run: args.dry_run,
  });

  return { candidates: candidates.length, reactivated: args.dry_run ? 0 : reactivated };
}

/**
 * Build production ports over the provided database handle.
 *
 * @param db - Connected database handle.
 * @returns Production repair ports.
 */
function create_production_repair_ports(db: Db): RepairPorts {
  return {
    async find_candidates(tenant_id, limit) {
      // Find all suspended memberships, optionally scoped to one tenant.
      const filter: Record<string, unknown> = { status: "suspended" };
      if (tenant_id) filter.tenantId = tenant_id;

      const memberships = await db
        .collection("tenant_membership_projections")
        .find(filter)
        .limit(limit)
        .toArray();

      const candidates: RepairCandidate[] = [];
      for (const membership of memberships) {
        const profile_id = String(membership.userProfileId);
        const profile = await db
          .collection("user_profiles")
          .findOne({ _id: membership.userProfileId }, { projection: { status: 1 } });
        const profile_status = profile ? String(profile.status) : "not_found";

        // Only include where the PROFILE is active — the suspension is
        // membership-level only, induced by the retired single-membership guard.
        if (profile_status === "active") {
          candidates.push({
            membership_id: membership._id.toString(),
            tenant_id: String(membership.tenantId),
            user_profile_id: profile_id,
            profile_status,
          });
        }
      }
      return candidates;
    },

    async reactivate(candidate, dry_run) {
      console.info({
        script: "repair-multi-org-suspensions",
        event: dry_run ? "candidate.would_reactivate" : "candidate.reactivating",
        membership_id: candidate.membership_id,
        tenant_id: candidate.tenant_id,
        user_profile_id: candidate.user_profile_id,
      });
      if (dry_run) return;

      await db.collection("tenant_membership_projections").updateOne(
        { _id: candidate.membership_id },
        { $set: { status: "active", updatedAt: new Date() } },
      );
      await db.collection("platform_audit_events").insertOne({
        action: "repair_multi_org_suspension",
        tenantId: candidate.tenant_id,
        userProfileId: candidate.user_profile_id,
        reason: "Plan-3 rollout: retired single-membership guard reactivation",
        occurred_at: new Date(),
      });
    },
  };
}

/**
 * CLI entry point — invoked when the script is run directly.
 */
async function run_cli(): Promise<void> {
  const args = parse_repair_args(process.argv.slice(2));

  if (args.dry_run) {
    console.warn(
      "DRY-RUN mode (default). Pass --commit to apply changes. " +
        "Always review dry-run output before committing.",
    );
  }

  const { get_main_client_promise } = await import("@rnd-ai/shared-database");
  const client = await get_main_client_promise();
  try {
    const result = await repair_multi_org_suspensions(
      args,
      create_production_repair_ports(client.db()),
    );
    process.stdout.write(
      `${JSON.stringify({ candidates: result.candidates, reactivated: result.reactivated, dry_run: args.dry_run })}\n`,
    );
  } finally {
    await client.close();
  }
}

const invoked_directly =
  process.argv[1]?.endsWith("repair-multi-org-suspensions.ts") ?? false;
if (invoked_directly) {
  run_cli().catch((error) => {
    console.error(
      "repair-multi-org-suspensions failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  });
}
