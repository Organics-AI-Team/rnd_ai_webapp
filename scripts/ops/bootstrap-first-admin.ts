/**
 * Bootstrap the first platform super administrator (one-time operation).
 *
 * After the very first Clerk sign-up, the webhook projects a user_profiles
 * document, but grantPlatformRole requires an existing super admin — a
 * deliberate chicken-and-egg this script breaks exactly once. It refuses to
 * run when any super_admin already exists and records a platform audit event.
 *
 * Usage:
 *   npx tsx scripts/ops/bootstrap-first-admin.ts <email>
 *
 * @param email - primaryEmail of the signed-up, webhook-projected profile.
 * Environment: MONGODB_URI (server-only).
 */
import client_promise from "@rnd-ai/shared-database";

/**
 * Promote the named profile to platform super_admin when none exists yet.
 *
 * @param email - Normalized primary email of the target active profile.
 * @returns Result descriptor for logging.
 * @throws Error when a super admin already exists or no profile matches.
 */
async function bootstrap_first_admin(email: string): Promise<string> {
  console.info({ boundary: "ops", event: "bootstrap_first_admin.start", email });
  const client = await client_promise;
  const db = client.db();
  const profiles = db.collection("user_profiles");

  const existing_super = await profiles.findOne({ platformRole: "super_admin" });
  if (existing_super) {
    throw new Error(
      "refusing: a super_admin already exists; use platformTenants.grantPlatformRole instead",
    );
  }

  const result = await profiles.updateOne(
    { primaryEmail: email, status: "active" },
    { $set: { platformRole: "super_admin", updatedAt: new Date() } },
  );
  if (result.matchedCount === 0) {
    throw new Error(
      `no active user profile found for ${email} — has the sign-up webhook been delivered?`,
    );
  }

  await db.collection("platform_audit_events").insertOne({
    action: "bootstrap_first_super_admin",
    emailNormalized: email,
    occurred_at: new Date(),
    note: "one-time bootstrap; subsequent grants must use platformTenants.grantPlatformRole",
  });
  console.info({ boundary: "ops", event: "bootstrap_first_admin.done", email });
  return `bootstrapped: ${email} is now platform super_admin`;
}

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!email) {
  console.error("usage: npx tsx scripts/ops/bootstrap-first-admin.ts <email>");
  process.exit(1);
}
bootstrap_first_admin(email)
  .then(async (message) => {
    console.log(message);
    await (await client_promise).close();
  })
  .catch(async (error) => {
    console.error("bootstrap-first-admin failed:", error.message ?? error);
    await (await client_promise).close();
    process.exitCode = 1;
  });
