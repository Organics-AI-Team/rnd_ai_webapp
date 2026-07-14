/**
 * tenant:verify — repeat the audit after backfill (G2.3). Exits non-zero when
 * ambiguous, orphaned, malformed, conflicting, or still-unscoped records
 * remain, so enforcement (G2.4/G2.7) cannot proceed on dirty data.
 */
import { audit_tenant_ownership } from "../server/services/migrations/tenant-ownership-mapper";

async function run_cli(): Promise<void> {
  const { default: client_promise } = await import("@rnd-ai/shared-database");
  const client = await client_promise;
  try {
    const report = await audit_tenant_ownership(client.db());
    console.log(JSON.stringify(report, null, 2));
    const t = report.totals;
    const dirty = t.ambiguous + t.orphaned + t.malformed + t.conflicts + t.resolvable;
    if (dirty > 0) {
      console.error(`tenant:verify FAILED — ${dirty} record(s) not cleanly scoped.`);
      process.exitCode = 1;
    } else {
      console.log("tenant:verify PASSED — every record is tenant-scoped.");
    }
  } finally {
    await client.close();
  }
}
if (process.argv[1]?.endsWith("verify-tenant-ownership.ts")) {
  run_cli().catch((error) => {
    console.error("tenant:verify failed:", error.message ?? error);
    process.exitCode = 1;
  });
}
