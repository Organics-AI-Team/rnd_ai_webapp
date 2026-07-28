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

## Expected counts (Organics AI tenant, verified on prod 2026-07-28)
- products: 3,049 of 3,070 rows (17 duplicate rm_codes, 4 missing code/name;
  enriched with CAS/functions where INCI matched)
- inci_reference: 36,269 (CosIng + inci_lines merged; 2,738 rows missing INCI skipped)
- formulas: 1,916 (latest `rd_formulas` version per product — not the ~474
  `formula_masters` subset; 1,098 unmatched rm_code lines retained and reported)

Re-running produces the same counts (upsert by natural key).

## Operational note (production)
Both managed Mongo clusters are trusted-source firewalled to the droplet —
imports must run ON `rnd-ai-prod` (`/opt/rnd-ai`), with the export synced to
`/opt/rnd_ai` and `RND_EXPORT_DIR=/opt/rnd_ai`.

## Qdrant knowledge ingest (M3)

Grounds the governed `knowledge.search` tool. Writes through the governed
adapter into the SAME collections production reads —
`platform_knowledge_${AI_EMBEDDING_VERSION}` (market scrape) and
`tenant_knowledge_${AI_EMBEDDING_VERSION}` (this tenant's formulas) — with
the production embedding config (gemini-embedding-001, 768 dims, version
`v1`). Never writes the legacy `raw_materials_*` collections.

**Run ON the rnd-ai-prod droplet** (Mongo + Qdrant are firewalled to it).

### Extra env (beyond the Mongo section above)
- `GEMINI_API_KEY` — REQUIRED for embeddings. Verify it is set on the
  droplet before starting: `node -e "process.env.GEMINI_API_KEY || process.exit(1)"`.
- `QDRANT_URL`, `QDRANT_API_KEY` — existing Qdrant connection.
- `AI_EMBEDDING_MODEL` / `AI_EMBEDDING_VERSION` / `AI_EMBEDDING_DIMENSIONS`
  — leave at the worker defaults (`gemini-embedding-001` / `v1` / `768`)
  unless the worker env pins different values; they MUST match the worker.
- `KNOWLEDGE_BATCH_SIZE` (default 50), `KNOWLEDGE_BATCH_DELAY_MS` (default
  1000), `KNOWLEDGE_PROGRESS_FILE` (default `.import-progress-myskin.json`).

### Commands
```bash
# validate + report, no embeds, no writes
npm run import:knowledge:market   -w apps/ai -- --dry-run
IMPORT_TENANT_ID=<tenant> IMPORT_ACTOR_PROFILE_ID=<profile> \
  npm run import:knowledge:formulas -w apps/ai -- --dry-run

# real runs (market takes ~40+ min for 94,530 rows; run under nohup/tmux)
npm run import:knowledge:market   -w apps/ai
IMPORT_TENANT_ID=<tenant> IMPORT_ACTOR_PROFILE_ID=<profile> \
  npm run import:knowledge:formulas -w apps/ai

# both, in order
IMPORT_TENANT_ID=<tenant> IMPORT_ACTOR_PROFILE_ID=<profile> \
  npm run import:knowledge -w apps/ai
```

### Resumability & idempotency
- The market ingest checkpoints its row position after every batch; an
  interrupted run resumes where it stopped. Pass `--from-start` to ignore
  the checkpoint. Point ids are deterministic per `source_id`, so re-runs
  overwrite the same points — never duplicate.

### Expected counts (Organics AI tenant)
- platform points: ≤ 94,530 (myskin rows minus unidentifiable/duplicate)
- tenant points: ~1,916 (one per imported formula)
