# Port /ai rework from dev/droplet onto the Clerk branch

Context: `dev/droplet` (Mongo-session auth) and `v2/dev` (Clerk + multi-tenant)
diverged at `e4ec327`. The droplet-side `/ai` rework is being carried across.
Done so far: `87d7dd8`. Both branches are committed and pushed; nothing is
stranded on disk.

## Todo

- [ ] **Port the unified `/ai` chat UI** (~1d). Droplet's `app/ai/page.tsx`
      replaces the old hub-of-cards with one chat surface (AIChatLayout +
      sidebar + threads). v2/dev's `app/ai/page.tsx` is still the hub.
      - Rewire auth: droplet imports `useAuth` from `@/lib/auth-context`
        (deleted here); v2/dev's is `@/lib/app-auth` (Clerk). Shapes differ —
        no `token`/`login`/`signup`, and `user.id` is a Clerk id, not a Mongo
        `_id`.
      - Droplet deletes `ai_features_grid.tsx` and `ai_page_header.tsx`; both
        are still referenced on v2/dev. Check before removing.
      - Preserve v2/dev-only components the droplet UI never saw:
        `ai_run_view`, `ai_approval_card`, `ai_clarification_card`,
        `ai_evidence_list`, `ai_feedback_buttons`.

- [ ] **Hand-merge `react-agent-service.ts`** (~0.5d). Droplet's version is
      1239 lines with no tenant scoping; v2/dev's is 837 lines and pins every
      tool access to a verified `tenant_id` (G2.6). Take droplet's grounded
      fallback + skill-catalog injection **on top of** v2/dev's scoping — never
      replace the file. Same applies to `react-system-prompt.ts`,
      `tool-definitions.ts`, `types.ts`.

- [ ] **Decide the execution endpoint for the ported UI** (~0.5d, do before
      the UI port). Droplet's chat posts to `/api/ai/rnd-agent`, which this
      branch does not have. v2/dev's governed path is `/api/ai/runs` (async:
      create run → stream events → resume) behind
      `lib/server/with-request-principal.ts`. Either adapt the UI to the
      governed async API, or port `rnd-agent` **with** principal enforcement —
      do not port it as-is (see below).

- [ ] **Port droplet's 3 new react tool-handlers** — `stock-lookup-handler.ts`
      is new here; `context-memory-handler.ts` and `qdrant-search-handler.ts`
      already exist on v2/dev and differ. Diff before overwriting.

## Won't port (decided)

- `bd8dd3c` "docs: redesign G4 as dynamic agentic orchestrator" — a design
  proposal for a pipeline v2/dev already implemented and audited differently.
  Landing it would leave docs describing code that does not exist.
- `dev/droplet:apps/web/app/api/ai/rnd-agent/route.ts` **as written** — it
  reads `userId` straight from the request body and sits outside the
  middleware matcher, so it is callable unauthenticated by anyone, as any
  user. It must gain principal enforcement before it lands here.

## Findings on dev/droplet (fix there, not here)

- [ ] `api/ai/rnd-agent/route.ts` — unauthenticated; trusts `body.userId`.
- [ ] `api/ai/rnd-agent/route.ts` — falls back to `NEXT_PUBLIC_GEMINI_API_KEY`,
      which is inlined into client bundles. Fixed in the ported script here;
      the droplet copy is still live.
- [ ] `lib/auth-context.tsx` — session token in `localStorage` + a
      non-httpOnly cookie; any XSS lifts a 30-day session.
- [ ] `sessions` collection has no TTL index on `expiresAt`; expired rows
      accumulate forever.
