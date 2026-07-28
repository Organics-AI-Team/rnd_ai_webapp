# Chem/Formula Data Import

Loads raw materials (enriched), INCI reference, and historical formulas from the
legacy `rnd_ai` export into `rd_ai_gen2`'s tenant-scoped Mongo collections.
Idempotent — safe to re-run.

## Prerequisites
- The `rnd_ai` export present. Default location: sibling folder `../rnd_ai`.
  Override with `RND_EXPORT_DIR=/abs/path/to/rnd_ai`.
- Env: `MONGODB_URI` (or `DATABASE_URL`), `IMPORT_TENANT_ID`,
  `IMPORT_ACTOR_PROFILE_ID` (the tenant's bootstrapped super-admin profile id).

## Commands
```bash
# validate + report, no writes
IMPORT_TENANT_ID=<tenant> IMPORT_ACTOR_PROFILE_ID=<profile> \
  npm run import:all -w apps/ai -- --dry-run

# run for real (order: reference → materials → formulas)
IMPORT_TENANT_ID=<tenant> IMPORT_ACTOR_PROFILE_ID=<profile> \
  npm run import:all -w apps/ai

# individual datasets
npm run import:reference -w apps/ai
npm run import:materials -w apps/ai
npm run import:formulas  -w apps/ai
```

## Expected counts (Organics AI tenant)
- products: ~3,049 (enriched with CAS/functions where INCI matched)
- inci_reference: ~30k
- formulas: ~474 (latest version per product)

Re-running produces the same counts (upsert by natural key).
