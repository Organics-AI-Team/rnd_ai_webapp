# R&D AI — Follow-ups

## Todo

- [ ] **Make the session cookie `httpOnly` (est. 3h)** — `apps/web/lib/auth-context.tsx:62,101`
      persists the 30-day token in `localStorage` *and* a JavaScript-readable cookie, so any XSS
      lifts a month-long session. The fix is not a one-liner: the token is minted inside a tRPC
      mutation, so the cookie has to be set server-side via `responseMeta` on the fetch adapter
      (keeping `/api/trpc` as the only public prefix) rather than by adding a new public
      `/api/auth/session` route, which would widen the middleware allowlist. Touches the live
      login path — do it deliberately, with a logged-in smoke test, not as a tail-end sweep.
- [ ] **Convert the remaining 50 bare `throw new Error` in tRPC routers (est. 3h)** — each reaches
      the client as HTTP 500. The auth-critical path is done and guarded; these need per-site
      semantic judgement (`NOT_FOUND` vs `FORBIDDEN` vs `BAD_REQUEST`), so they are listed rather
      than bulk-replaced: `orders.ts` 10 (from :25), `products.ts` 8 (:204), `users.ts` 8 (:53),
      `chat-threads.ts` 7 (:214), `formulas.ts` 5 (:96), `calculations.ts` 4 (:275),
      `organizations.ts` 3 (:31), `stock.ts` 3 (:271), `userLogs.ts` 1 (:153),
      `vector-index.ts` 1 (:20). Extend `AUTH_CRITICAL_PATH` in
      `tests/security/api-auth-boundary.test.cjs` as each router is converted.
- [ ] Add a client/server contract test for `chatThreads` (est. 1h) — the 2026-09-21 outage was a
      renamed agent type deployed on one side only, and nothing failed until a user clicked send.
      A test asserting every `agentType` and procedure `apps/web/hooks/use_chat_threads.ts` calls
      exists in `apps/ai/server/routers/chat-threads.ts` would have caught all of it.
- [ ] Stop `handle_send_message` swallowing a failed persist (est. 30m) —
      `apps/web/app/ai/page.tsx:93` returns silently when `chat.add_message` yields null, which is
      why a hard tRPC validation error looked like a dead button. Surface a toast and log it.
- [ ] Run `npm run verify:models` as a deploy gate (est. 20m) — wire into
      `scripts/deploy-droplet.sh`, whose preflight checks four vars and dies silently on anything
      missing (`scripts/deploy-droplet.sh:45`).

## Blocked — needs a decision

- [ ] **Which branch should production serve?** `dev/droplet` (live now: Mongo sessions, no
      Clerk) or `v2/dev` (Clerk + multi-tenant RBAC + governed run API, finished and tested,
      currently undeployed). This morning's deploy replaced the Clerk cutover recorded in
      `16d65e3` — unclear whether that was intentional. Everything below waits on the answer.
- [ ] Orphan `rnd-ai-worker` container on the droplet — 7-week-old code from the undeployed
      Clerk branch, idle 24h, absent from `docker compose config --services`, still holding
      `.env` credentials and a Mongo connection. Stop it, or redeploy `v2/dev` and make it
      current. Do not leave it drifting indefinitely.
- [ ] Finish porting the `/ai` rework to `v2/dev` (est. ~2d) — see `TODOS.md` on that branch.
      Pointless if production stays on `dev/droplet`.

## Needs a human

- [ ] Click through `/ai` logged in and send one message. The 2026-09-21 auth-boundary change
      was verified from outside (all API routes 401 unauthenticated, `/login` and the tRPC login
      path still reachable) but no authenticated agent run has exercised it.

## Done ✓

- [x] Guard every API route at the edge — nine endpoints were reachable unauthenticated in
      production. See `CHANGELOG.md` 2026-09-21 and `tests/security/api-auth-boundary.test.cjs`.
- [x] Stop `/api/ai/rnd-agent` trusting `body.userId`; drop its `NEXT_PUBLIC_GEMINI_API_KEY`
      fallback.
- [x] Typed `TRPCError` codes across the auth-critical path (`auth.ts`, `trpc.ts`), guarded by
      test so bare throws cannot return.
- [x] Reconsider the 5s session poll — now 60s; `refreshUser()` covers immediacy and
      `refetchOnWindowFocus` covers returning tabs.
- [x] Index the `sessions` collection — `token_unique` + `expiresAt_ttl` via the re-runnable
      `apps/ai/scripts/ensure-session-indexes.ts`.
- [x] Reclaim droplet disk — build cache 80% -> 19%.
- [x] Commit the 200+ uncommitted paths (`884a3be`) and retire the legacy agent tree.
- [x] Restore production `/ai` messaging — widened the `chatThreads` agent-type contract, added
      the missing `updateMessageMetadata` procedure, repointed the retired `gemini-2.5-flash`.
- [x] Point the sidebar at `/ai` instead of the two `redirect('/ai')` alias routes.
- [x] Sweep and fix every pinned Gemini model id; add the `npm run verify:models` gate.
- [x] Memoize `AuthContext` value and handlers.
