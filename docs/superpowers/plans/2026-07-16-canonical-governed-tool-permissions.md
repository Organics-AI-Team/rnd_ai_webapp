# Canonical Governed Tool Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every governed production tool and capability card use a real shared-auth `Permission` literal without changing any model-visible schema.

**Architecture:** Replace the stale unbounded `ToolPermission = string` seam with the existing `Permission` contract exported by `@rnd-ai/shared-types`, then make the governed permission catalogue the single typed mapping used by all seven definitions. Capability-card frontmatter remains a mirror of each definition and the focused test asserts the exact authorization mapping, including the intentional `web.search -> ai:run` choice.

**Tech Stack:** TypeScript 5, Vitest, Zod, markdown capability-card frontmatter.

## Global Constraints

- Canonical mappings: `formula.search -> formula:read`, `formula.draft -> formula:draft:create`, `formula.revise -> formula:draft:update_own`, `formula.comment -> formula:comment:create`, `formula.confirm -> formula:confirm`, `knowledge.search -> tenant:knowledge:read`.
- Use `ai:run` for `web.search`: it is the narrowest existing shared permission authorizing an operation inside a governed AI run; do not add an auth permission.
- Keep model-visible input and output schemas unchanged.
- Do not edit runtime/worker files, `package.json`, `tests/resilience`, `tests/load`, or the approval service.
- Do not commit.

---

### Task 1: Pin the canonical authorization contract

**Files:**
- Modify: `tests/ai-control/capability-cards.test.ts`
- Modify: `tests/ai-control/helpers.ts`
- Modify: `tests/ai-control/tool-executor.test.ts`
- Modify: `apps/ai/server/services/ai-control/tool-definition.ts`
- Modify: `apps/ai/server/services/ai-control/card-loader.ts`
- Modify: `apps/ai/server/services/ai-control/cards/tools/formula.draft.md`
- Modify: `apps/ai/server/services/ai-control/cards/tools/formula.revise.md`
- Modify: `apps/ai/server/services/ai-control/cards/tools/formula.comment.md`
- Modify: `apps/ai/server/services/ai-control/cards/tools/knowledge.search.md`
- Modify: `apps/ai/server/services/ai-control/cards/tools/web.search.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `Permission` from `@rnd-ai/shared-types` and the existing `create_all_governed_tool_definitions(...)` test factory.
- Produces: `ToolPermission = Permission`; `TOOL_PERMISSIONS` whose values are valid shared permissions; exact runtime mapping coverage for all seven governed tools; card frontmatter that remains raw until registration compares it with the typed definition.

- [x] **Step 1: Write the failing exact-mapping test**

Add a test that converts the seven definitions to `{ [tool_name]: required_permission }` and expects:

```ts
{
  "formula.comment": "formula:comment:create",
  "formula.confirm": "formula:confirm",
  "formula.draft": "formula:draft:create",
  "formula.revise": "formula:draft:update_own",
  "formula.search": "formula:read",
  "knowledge.search": "tenant:knowledge:read",
  "web.search": "ai:run",
}
```

Document in the test that `ai:run` is intentional because no narrower web-specific permission exists in shared auth.

- [x] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/ai-control/capability-cards.test.ts`

Expected: FAIL only on the five stale permission values; formula search and confirm already match.

- [x] **Step 3: Type the catalogue and apply the minimal mappings**

Import `Permission` as a type from `@rnd-ai/shared-types`, define `ToolPermission` as `Permission`, and change only the stale `TOOL_PERMISSIONS` values. Do not alter tool names, versions, descriptions, schemas, side effects, approval requirements, retries, timeouts, paths, or execution adapters.

- [x] **Step 4: Align capability-card frontmatter**

Change only each affected `required_permission` line so the existing registration/card drift invariant remains green.

- [x] **Step 5: Run the focused test and verify GREEN**

Run: `npx vitest run tests/ai-control/capability-cards.test.ts`

Expected: all capability-card tests PASS.

- [x] **Step 6: Record and verify the production fix**

Append a concise `CHANGELOG.md` entry with the root cause, canonical mappings, intentional `web.search -> ai:run` decision, unchanged model-visible schemas, and verification commands.

Run:

```bash
npx vitest run tests/ai-control/capability-cards.test.ts tests/ai-control/tool-executor.test.ts tests/integration/ai-control-authorization.test.ts
npm run typecheck
npm run security:scan
git diff --check
```

Expected: focused suites pass, typecheck passes, security scan reports no violations, and diff check is clean.
