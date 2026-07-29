/**
 * tenant:backfill — apply the audited ownership mapping (G2.3).
 * Requires --apply and --audit-hash=<hash> from a reviewed tenant:audit run;
 * refuses when data changed after the audit. Quarantines instead of guessing.
 */
import { backfill_tenant_ownership } from "../server/services/migrations/tenant-ownership-mapper";

async function run_cli(): Promise<void> {
  if (!process.argv.includes("--apply")) {
    throw new Error("Dry-run only by design: pass --apply --audit-hash=<hash> (see tenant:audit).");
  }
  const audit_hash = process.argv.find((a) => a.startsWith("--audit-hash="))?.slice("--audit-hash=".length);
  if (!audit_hash) throw new Error("--audit-hash=<hash> is required (from tenant:audit output).");
  const { default: client_promise } = await import("@rnd-ai/shared-database");
  const client = await client_promise;
  try {
    console.log(JSON.stringify(await backfill_tenant_ownership(client.db(), audit_hash), null, 2));
  } finally {
    await client.close();
  }
}
if (process.argv[1]?.endsWith("backfill-tenant-ownership.ts")) {
  run_cli().catch((error) => {
    console.error("tenant:backfill failed:", error.message ?? error);
    process.exitCode = 1;
  });
}
