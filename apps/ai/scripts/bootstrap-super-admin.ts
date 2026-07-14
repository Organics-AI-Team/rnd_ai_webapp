/**
 * Platform super-admin bootstrap (G1.2).
 *
 * Creates the first (and only bootstrap-able) platform super_admin profile.
 * Succeeds only while no active platform role exists; a second invocation
 * exits non-zero. Appends one platform_audit_events record.
 *
 * Usage: npm run bootstrap:super-admin -w apps/ai -- \
 *          --clerk-user-id=user_xxx --email=admin@example.com
 */

import type { Db } from "mongodb";

import { create_user_profile_repository } from "../server/repositories/user-profile-repository";

/** Bootstrap input. */
export interface BootstrapSuperAdminInput {
  readonly clerk_user_id: string;
  readonly email: string;
  readonly now?: Date;
}

/** Bootstrap result. */
export interface BootstrapSuperAdminResult {
  readonly created: boolean;
  readonly profile_id: string;
}

/**
 * Create the sole bootstrap super_admin profile and audit the action.
 *
 * @param db - Connected MongoDB database.
 * @param input - Clerk user ID and email of the initial administrator.
 * @returns Creation result with the new profile ID.
 * @throws Error when an active platform role already exists.
 */
export async function bootstrap_super_admin(
  db: Db,
  input: BootstrapSuperAdminInput,
): Promise<BootstrapSuperAdminResult> {
  const profiles = create_user_profile_repository(db);
  const existing = await profiles.count_active_platform_admins();
  if (existing > 0) {
    throw new Error(
      "A platform role already exists; bootstrap is single-use. Grant further roles through platform administration.",
    );
  }

  const created = await profiles.create_user_profile({
    clerk_user_id: input.clerk_user_id,
    primary_email: input.email,
    display_name: input.email,
    platform_role: "super_admin",
  });

  await db.collection("platform_audit_events").insertOne({
    action: "bootstrap_super_admin",
    profileId: created._id.toString(),
    clerkUserId: input.clerk_user_id,
    emailNormalized: input.email.trim().toLowerCase(),
    occurredAt: input.now ?? new Date(),
  });

  return { created: true, profile_id: created._id.toString() };
}

/**
 * Parse a required --name=value CLI argument.
 *
 * @param name - Argument name without dashes.
 * @returns Argument value.
 * @throws Error when the argument is missing or empty.
 */
function require_cli_argument(name: string): string {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix));
  const value = raw?.slice(prefix.length).trim();
  if (!value) {
    throw new Error(`Missing required argument ${prefix}<value>`);
  }
  return value;
}

/**
 * CLI entry: connect via the shared client and bootstrap the super admin.
 */
async function run_cli(): Promise<void> {
  const clerk_user_id = require_cli_argument("clerk-user-id");
  const email = require_cli_argument("email");
  const { default: client_promise } = await import("@rnd-ai/shared-database");
  const client = await client_promise;
  try {
    const result = await bootstrap_super_admin(client.db(), {
      clerk_user_id,
      email,
    });
    console.log(`bootstrap:super-admin — created profile ${result.profile_id}`);
  } finally {
    await client.close();
  }
}

const invoked_directly =
  process.argv[1]?.endsWith("bootstrap-super-admin.ts") ?? false;

if (invoked_directly) {
  run_cli().catch((error) => {
    console.error("bootstrap:super-admin failed:", error.message ?? error);
    process.exitCode = 1;
  });
}
