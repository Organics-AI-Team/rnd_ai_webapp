/**
 * Grant (or clear) a platform role on existing user profiles, by email.
 *
 * Operator counterpart of the `platformTenants.grantPlatformRole` tRPC
 * mutation (same writes, same audit event) for use where no authenticated
 * super-admin session exists (droplet ops). A profile only exists after the
 * person's first Clerk sign-in — emails without a profile are reported as
 * `pending_first_sign_in`, never pre-created (the Clerk webhook owns profile
 * creation; a pre-created doc would duplicate on user.created).
 *
 * Usage (on the droplet, MONGODB_URI exported):
 *   GRANT_ROLE_EMAILS=a@x.com,b@y.com GRANT_ROLE=super_admin \
 *   GRANT_ACTOR_PROFILE_ID=<super-admin profile id> \
 *     npm run grant:platform-role -w apps/ai
 *
 * Idempotent: re-running reports `already` and writes no duplicate audit.
 */
import type { Db } from "mongodb";

import { create_platform_audit_service } from "../server/services/audit/platform-audit-service";

/** One per-email outcome of a grant run. */
export type GrantOutcome =
  | "granted"
  | "already"
  | "pending_first_sign_in"
  | "profile_inactive";

/**
 * Grant `role` to the active profile holding `email` (case-insensitive).
 *
 * @param db - Connected MongoDB database.
 * @param email - Target primaryEmail (callers pass trimmed lowercase).
 * @param role - Platform role to set ("super_admin" | "admin").
 * @param actor_profile_id - Auditing actor (an existing super-admin profile id).
 * @returns The outcome for this email.
 */
export async function grant_platform_role_by_email(
  db: Db,
  email: string,
  role: "super_admin" | "admin",
  actor_profile_id: string,
): Promise<GrantOutcome> {
  console.log(`[grant:platform-role] start { email: ${email}, role: ${role} }`);
  const profiles = db.collection("user_profiles");
  const profile = await profiles.findOne(
    { primaryEmail: email },
    { collation: { locale: "en", strength: 2 } },
  );
  if (!profile) {
    console.log(`[grant:platform-role] ${email}: pending_first_sign_in`);
    return "pending_first_sign_in";
  }
  if (profile.status !== "active") {
    console.log(`[grant:platform-role] ${email}: profile_inactive`);
    return "profile_inactive";
  }
  if (profile.platformRole === role) {
    console.log(`[grant:platform-role] ${email}: already ${role}`);
    return "already";
  }
  await profiles.updateOne(
    { _id: profile._id, status: "active" },
    { $set: { platformRole: role, updatedAt: new Date() } },
  );
  await create_platform_audit_service(db).record({
    action: "grant_platform_role",
    clerkUserId: String(profile.clerkUserId ?? ""),
    platformRole: role,
    actorProfileId: actor_profile_id,
    occurred_at: new Date(),
  });
  console.log(`[grant:platform-role] ${email}: granted ${role}`);
  return "granted";
}

/** CLI entry: grant GRANT_ROLE to every email in GRANT_ROLE_EMAILS. */
async function run_cli(): Promise<void> {
  const { default: client_promise } = await import("@rnd-ai/shared-database");
  const emails = (process.env.GRANT_ROLE_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const role = (process.env.GRANT_ROLE ?? "super_admin") as "super_admin" | "admin";
  const actor = process.env.GRANT_ACTOR_PROFILE_ID?.trim();
  if (emails.length === 0 || !actor || !["super_admin", "admin"].includes(role)) {
    throw new Error(
      "GRANT_ROLE_EMAILS, GRANT_ACTOR_PROFILE_ID and a valid GRANT_ROLE are required",
    );
  }
  const client = await client_promise;
  try {
    const summary: Record<string, GrantOutcome> = {};
    for (const email of emails) {
      summary[email] = await grant_platform_role_by_email(client.db(), email, role, actor);
    }
    console.log(`[grant:platform-role] summary ${JSON.stringify(summary)}`);
  } finally {
    await client.close();
  }
}

if (process.argv[1]?.includes("grant-platform-role")) {
  run_cli().catch((e) => {
    console.error("[grant:platform-role] failed:", e?.message ?? e);
    process.exitCode = 1;
  });
}
