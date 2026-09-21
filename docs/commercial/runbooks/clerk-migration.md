# Clerk Migration Runbook (G1.6)

Migrates legacy bcrypt accounts into Clerk without forced password resets.
Every step is replay safe; the migration never creates universities from
legacy organizations, and no command below ever prints a password digest.

## Preconditions

- G1.1–G1.5 deployed; Clerk instance configured (see PENDING_EXTERNAL_DASHBOARD in the G1.1 CHANGELOG entry).
- `CLERK_SECRET_KEY` present in the server environment.
- Tenants for known legacy organizations already provisioned via the platform
  console, with `legacyOrganizationId` set on each Tenant during provisioning
  approval (unresolved mappings block those users' membership sync, not their
  sign-in).

## 1. Snapshot

Take a MongoDB backup of `accounts`, `users`, `organizations`, and
`user_profiles` before any write:

```bash
mongodump --uri="$MONGODB_URI" \
  --collection=accounts --collection=users \
  --collection=organizations --collection=user_profiles \
  --out=./backups/pre-clerk-migration-$(date -u +%Y%m%dT%H%M%SZ)
```

## 2. Dry run (default)

```bash
npm run migrate:clerk -w apps/ai
```

Review the printed counts: `would_import` should match the number of active
accounts with valid bcrypt digests. Investigate skips before applying.

## 3. Apply

```bash
npm run migrate:clerk -w apps/ai -- --apply --report=./clerk-migration-report.json
```

The report contains statuses per stable account ID plus
`legacy_org_resolution`. Re-running is safe: already-linked accounts count as
`replayed`, partially created Clerk users are linked without duplication.

## 4. Sampled sign-in verification

Pick 3–5 imported accounts across tenants and verify each can sign in at
`/sign-in` with the existing password (Clerk verifies the imported bcrypt
digest and upgrades the hash transparently on first use).

## 5. Reconciliation

For each provisioned tenant:

```bash
npm run reconcile:clerk -w apps/ai -- --tenant=<tenant-id>
```

Resolve `unresolved_organizations` from the migration report by provisioning
the missing universities in the platform console (platform-admin approval),
then re-run the migration apply step (replay safe) and reconcile again.

## 6. Cutover

Set `CLERK_CUTOVER=true` (and the Clerk keys) in the deployment environment
and redeploy. Ingress authorization switches to the Clerk resolver
exclusively; `resolver_used` appears in request logs.

## 7. Rollback

Set `CLERK_CUTOVER=false` and redeploy. Ingress returns to the legacy session
adapter during the bounded coexistence window. Clerk IDs are additive;
`Account`/`Session` collections remain untouched until G5 retirement.
