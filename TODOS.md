# R&D AI — Follow-ups

**Production runs `dev/droplet`.** Confirmed 2026-09-21 from the droplet's own
deploy backups: `/opt/rnd-ai/.codex-backups/deploy-51688fa-20260802T154853Z`
is named after droplet commit `51688fa` and contains the Clerk stack it
replaced (`app-auth.tsx` importing `@clerk/nextjs`, `sign-in/[[...sign-in]]`,
`/api/ai/runs`, a `worker` compose service). The cutover from `v2/dev` was
2026-08-02, deliberate, and has held across three deploys. `v2/dev` is parked —
162 commits in July, none since. Treat this branch as the only live line.

## Todo

- [ ] **Make the session cookie `httpOnly` (est. 3h)** — *top security item.*
      `apps/web/lib/auth-context.tsx:62,101` persists the 30-day token in
      `localStorage` **and** a JavaScript-readable cookie, so any XSS lifts a
      month-long session. Previously deprioritised on the assumption Clerk would
      supersede it; with `v2/dev` parked, it has to be fixed here.
      The token is minted inside a tRPC mutation, so set the cookie server-side
      via `responseMeta` on the fetch adapter — not by adding a public
      `/api/auth/session` route, which would widen the middleware allowlist that
      `tests/security/api-auth-boundary.test.cjs` guards. Touches the live login
      path: do it with a logged-in smoke test.
- [ ] **Convert the remaining 50 bare `throw new Error` in tRPC routers (est. 3h)** —
      each reaches the client as HTTP 500. The auth-critical path is done and
      guarded; these need per-site judgement (`NOT_FOUND` vs `FORBIDDEN` vs
      `BAD_REQUEST`): `orders.ts` 10 (from :25), `products.ts` 8 (:204),
      `users.ts` 8 (:53), `chat-threads.ts` 7 (:214), `formulas.ts` 5 (:96),
      `calculations.ts` 4 (:275), `organizations.ts` 3 (:31), `stock.ts` 3 (:271),
      `userLogs.ts` 1 (:153), `vector-index.ts` 1 (:20). Extend
      `AUTH_CRITICAL_PATH` in the security test as each router is converted.
- [ ] Add a client/server contract test for `chatThreads` (est. 1h) — the
      2026-09-21 outage was a renamed agent type deployed on one side only, and
      nothing failed until a user clicked send. A test asserting every
      `agentType` and procedure `apps/web/hooks/use_chat_threads.ts` calls exists
      in `apps/ai/server/routers/chat-threads.ts` would have caught all of it.
- [ ] Stop `handle_send_message` swallowing a failed persist (est. 30m) —
      `apps/web/app/ai/page.tsx:93` returns silently when `chat.add_message`
      yields null, which is why a hard tRPC validation error looked like a dead
      button. Surface a toast and log it.
- [ ] Run `npm run verify:models` as a deploy gate (est. 20m) — wire into
      `scripts/deploy-droplet.sh`, whose preflight checks four vars and dies
      silently on anything missing (`scripts/deploy-droplet.sh:45`).

## Needs a human

- [ ] Click through `/ai` logged in and send one message. The 2026-09-21
      auth-boundary change was verified from outside (every API route 401
      unauthenticated; `/login` and the tRPC login path still reachable) but no
      authenticated agent run has exercised it.

## Dropped

- ~~Port the `/ai` rework to `v2/dev` (~2d)~~ — predicated on `v2/dev` being
  production. It is not, and has had no development since July. The skill
  catalog and Gemini model config were ported there in `87d7dd8` before this was
  established; harmless, but that branch is parked. Revisit only if a decision
  is taken to return to Clerk, in which case `TODOS.md` on `v2/dev` still holds
  the analysis (tenant-scoping conflict in `react-agent-service.ts`, the
  `useAuth` shape mismatch, the endpoint choice).

## Done ✓

- [x] Removed the orphan `rnd-ai-worker` container and its 434MB image —
      a leftover of the 2026-08-02 cutover, which dropped `worker` from compose
      without removing the running container. 7 weeks idle, `ai_run_jobs`
      pending=0, nothing since 2026-08-02; the current deployment cannot enqueue
      runs (`/api/ai/runs` is 404).
- [x] Guard every API route at the edge — nine endpoints were reachable
      unauthenticated in production. `CHANGELOG.md` 2026-09-21 and
      `tests/security/api-auth-boundary.test.cjs`.
- [x] Stop `/api/ai/rnd-agent` trusting `body.userId`; drop its
      `NEXT_PUBLIC_GEMINI_API_KEY` fallback.
- [x] Typed `TRPCError` codes across the auth-critical path, guarded by test.
- [x] Session poll 5s -> 60s.
- [x] Index `sessions` — `token_unique` + `expiresAt_ttl` via the re-runnable
      `apps/ai/scripts/ensure-session-indexes.ts`.
- [x] Reclaim droplet disk — build cache 80% -> 19%.
- [x] Commit the 200+ uncommitted paths (`884a3be`); retire the legacy agent tree.
- [x] Restore production `/ai` messaging; sidebar points at `/ai`.
- [x] Sweep pinned Gemini model ids; add the `npm run verify:models` gate.
- [x] Memoize `AuthContext` value and handlers.
