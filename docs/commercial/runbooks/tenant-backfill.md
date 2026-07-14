# Tenant Ownership Backfill Runbook (G2.3)

Deterministic precedence: direct organizationId mapping → parent record's
tenant → uniquely mapped legacy actor. Disagreement or absence quarantines
the record (tenant_ownership_quarantine); a tenant is never silently
assigned. Preconditions: G2.2 schema expansion deployed; tenants carry
legacyOrganizationId (set during provisioning approval / migration report).

1. Backup: `mongodump --uri="$MONGODB_URI" --out=./backups/pre-tenant-backfill-$(date -u +%Y%m%dT%H%M%SZ)`
2. Dry-run audit: `npm run tenant:audit -w apps/ai > tenant-audit.json` — review totals (already_scoped/resolvable/ambiguous/orphaned/malformed/conflicts), by_collection, by_tenant, bucket hashes.
3. Review: investigate every quarantine candidate before applying; fix source data or accept quarantine.
4. Apply: `npm run tenant:backfill -w apps/ai -- --apply --audit-hash=<audit_hash from step 2>` — refuses if data changed after the audit; conditional `{_id, tenantId: null}` updates make replay safe; each batch writes migration_receipts.
5. Verify: `npm run tenant:verify -w apps/ai` — exits non-zero while any record remains unscoped/ambiguous/orphaned/malformed/conflicting. G2.4 enforcement is blocked until this passes.
6. Quarantine repair: resolve each tenant_ownership_quarantine row by correcting the source record (org/parent/actor), then re-run steps 2–5 (replay safe).
7. Rollback: `TENANT_ENFORCEMENT=shadow` keeps authorization on legacy organizationId while recording mismatches; backfilled tenantId fields remain (additive, per program rollback map).
8. Evidence: attach tenant-audit.json (before), the backfill output, migration_receipts count, and the passing tenant:verify output to docs/commercial/evidence/g2-release.md.
