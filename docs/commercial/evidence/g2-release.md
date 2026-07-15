# G2 — Tenant Data Authorization Release Evidence

Gate G2 makes every private business record tenant-owned and unreachable across
tenant boundaries: schema provenance, tenant-scoped repositories, converted
routers and AI tools, and a code-level bypass scanner that fails CI on any
direct tenant-collection access outside the sanctioned paths.

## Task completion map

| Task | Outcome | Commit |
|------|---------|--------|
| G2.1 Tenant execution + ownership contracts | done | e2a915c |
| G2.2 Schema tenant provenance (nullable tenantId + indexes) | done | 6493062 |
| G2.3 Auditable backfill + quarantine tooling | done | ae9b860 |
| G2.4 Tenant-scoped domain repositories | done | e310501 |
| G2.5 Routers → named permissions + repositories | done | e747df2 |
| G2.6 AI tools + direct APIs tenant-scoped; mongo_query locked down | done | 7251b7a |
| G2.7 Required tenant ownership + repository-bypass scanner | done | (this commit) |

## Code-level enforcement (G2.7)

- `prisma/schema.prisma`: `tenantId` changed from optional to **required** on the
  14 tenant-owned business models (Product, StockEntry, Formula,
  FormulaVersionLog, FormulaComment, Order, CreditTransaction, ProductLog,
  Conversation, Feedback, AiResponse, ChatThread, ChatMessage, PriceCalculation).
  `UserLog` stays optional by design (a `scope` discriminator distinguishes
  platform vs tenant events); `PromptVersion`/`KnowledgeSource` stay optional
  (platform-scoped prompts/knowledge legitimately have no tenant). `RawMaterial`
  remains platform-global with no `tenantId`. `organizationId` is retained on the
  business models for rollback comparison only — it is no longer an
  authorization source.
- `scripts/security/scan-private-boundaries.ts`: new `TENANT_REPOSITORY_BYPASS`
  rule (AST). Direct access to a tenant-owned collection
  (`db.collection('formulas'|'formula_comments'|'formula_version_logs'|'price_calculations'|'feedback'|'conversations'|'chat_threads'|'chat_messages')`)
  or a tenant Prisma control-plane model (`prisma.aIRun|tenantAIProfile|agentDeployment|aIUsageLedger|aIArtifact|aIApproval`)
  is a violation unless the file is in an allowed path:
  `apps/ai/server/repositories/**` (the repository layer),
  `apps/ai/scripts/**` (migration/admin scripts), or
  `apps/ai/agents/react/tool-handlers/**` (the legacy ReAct tools — tenant-scoped
  in G2.6, scheduled for retirement in G5). The rule matches aliased db handles
  and chained collection calls.
- `products`/`orders` are intentionally **out** of the enforced set: they are
  reachable through the one sanctioned public client-order ingress
  (`submitClientOrder`), which has no tenant execution context by design.
- Fixed a real bypass in `apps/web/app/api/index-data/route.ts`: the legacy
  Pinecone indexer read the `formulas` collection with no tenant scope (an
  unscoped cross-tenant read). Formula indexing now runs only through the
  tenant-scoped `apps/ai/scripts/index-qdrant.ts` path.

## Isolation tests

- `tests/integration/tenant-ai-tool-isolation.test.ts` — cross-tenant reads of
  the legacy AI tools return the generic not-found shape; search fails closed
  when unscoped; generate stamps tenant provenance; mongo_query rejects
  model-supplied collections/filters (17/17).
- `tests/integration/tenant-router-isolation.test.ts` — router-level cross-tenant
  isolation.
- `tests/repositories/tenant-repositories.test.ts` — repository-level scoping.
- `tests/security/tenant-repository-boundary.test.ts` — the bypass scanner (8/8),
  including a full production-tree scan asserting zero `TENANT_REPOSITORY_BYPASS`
  findings.

## Code-side gates (run on v2/dev)

- `npm test` — full suite green (see commit message for the exact count).
- `npm run typecheck` — 0 errors.
- `npm run security:scan` — 0 private-boundary violations (includes the new
  tenant-repository-bypass rule).
- `npm run build:web` — production build exit 0.
- `npx prisma generate` — Prisma client generated clean (schema valid). Note:
  `npx prisma validate` requires `DATABASE_URL` in the environment; it is
  unrelated to schema correctness.

## PENDING_EXTERNAL_STAGING (data gates before production cutover)

These are recorded against a real staged snapshot during cutover, not derived
from code (mirrors the G1 evidence pattern):

- [ ] `npm run tenant:verify` against the staged snapshot: ambiguous=0,
      orphaned=0, malformed=0, conflicts=0 for every enforced collection.
- [ ] Record the backfill audit hash and before/after per-collection counts
      (`npm run tenant:audit` / `tenant:backfill` receipts).
- [ ] Record quarantine resolution for any rows the mapper could not attribute.
- [ ] Rollback rehearsal: restore the pre-backfill snapshot and re-verify.

## Rollback

- Schema: `organizationId` is retained on every business model, so a rollback to
  organization-scoped authorization needs only a resolver/repository swap — no
  data migration. Reverting `tenantId` to optional is a schema-only change (no
  code reads these models via Prisma).
- Scanner: reverting the `TENANT_REPOSITORY_BYPASS` rule and the `index-data`
  edit restores the prior behavior; both are self-contained.
