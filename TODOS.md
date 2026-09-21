# R&D AI — Follow-ups from the 2026-09-21 chat outage

## Todo

- [ ] Add a client/server contract test for `chatThreads` (est. 1h) — the outage was a renamed
      agent type deployed on one side only, and nothing failed until a user clicked send. A test
      that asserts every `agentType` and procedure `apps/web/hooks/use_chat_threads.ts` calls
      exists in `apps/ai/server/routers/chat-threads.ts` would have caught all of it.
- [ ] Stop `handle_send_message` swallowing a failed persist (est. 30m) —
      `apps/web/app/ai/page.tsx:93` returns silently when `chat.add_message` yields null, which
      is why a hard tRPC validation error looked like a dead button. Surface it as a toast and
      log it (reinforces the no-silent-failures rule).
- [ ] Run `npm run verify:models` as a deploy gate (est. 20m) — wire it into
      `scripts/deploy-droplet.sh`, whose preflight currently checks four vars and dies silently
      on anything missing (`scripts/deploy-droplet.sh:45`).
- [ ] Reconsider the 5s session poll (est. 30m) — `apps/web/lib/auth-context.tsx:52`
      `refetchInterval: 5000` hits `auth.me` twelve times a minute per open tab. The re-render
      storm is fixed but the request volume is still unjustified; 30-60s plus
      `refetchOnWindowFocus` is likely enough. Needs a decision on how fresh
      `organization.credits` must be.
- [ ] Decide what to do with the large uncommitted working tree (est. ?) — 200+ paths, including
      the `apps/ai` restructure. This deploy shipped only the outage fix; the rest is still
      undeployed and unreviewed.

## In Progress

_(none)_

## Done ✓

- [x] Restore production `/ai` messaging — widened the `chatThreads` agent-type contract, added
      the missing `updateMessageMetadata` procedure, repointed the retired `gemini-2.5-flash`.
      See `CHANGELOG.md` 2026-09-21.
- [x] Point the sidebar at `/ai` instead of the two `redirect('/ai')` alias routes.
- [x] Sweep and fix every pinned Gemini model id; add the `npm run verify:models` gate.
- [x] Memoize `AuthContext` value and handlers.
