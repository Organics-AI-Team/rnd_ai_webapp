/**
 * tenant:audit — dry-run ownership scan (G2.3). Prints the JSON audit report
 * including bucket hashes and the audit_hash consumed by tenant:backfill.
 */
import { audit_tenant_ownership } from "../server/services/migrations/tenant-ownership-mapper";

async function run_cli(): Promise<void> {
  const { default: client_promise } = await import("@rnd-ai/shared-database");
  const client = await client_promise;
  try {
    console.log(JSON.stringify(await audit_tenant_ownership(client.db()), null, 2));
  } finally {
    await client.close();
  }
}
if (process.argv[1]?.endsWith("audit-tenant-ownership.ts")) {
  run_cli().catch((error) => {
    console.error("tenant:audit failed:", error.message ?? error);
    process.exitCode = 1;
  });
}
