#!/usr/bin/env tsx

/**
 * Create the indexes the `sessions` collection needs, idempotently.
 *
 * The collection shipped with only the default `_id_` index, which means:
 *
 *  - every session lookup (`auth.me`, polled once per 5s per signed-in user,
 *    plus `protectedProcedure` on each tRPC call) was a collection scan on
 *    `token`; cost grows linearly with stored sessions;
 *  - expired rows were never reclaimed — `auth.me` filters them out with
 *    `expiresAt: { $gt: now }`, so they stayed forever as dead weight.
 *
 * Safe to re-run: `createIndex` is a no-op when an equivalent index exists.
 *
 * Usage: npm run ensure:session-indexes --workspace=apps/ai
 */

import client_promise from '@rnd-ai/shared-database';

/**
 * Ensure the token lookup and expiry-reaping indexes exist.
 *
 * @returns Nothing; sets a non-zero exit code when an index cannot be created.
 */
async function ensure_session_indexes(): Promise<void> {
  console.log('[ensure-session-indexes] start', { timestamp: new Date().toISOString() });

  const client = await client_promise;
  const sessions = client.db().collection('sessions');

  const duplicate_tokens = await sessions
    .aggregate([
      { $group: { _id: '$token', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

  // A unique index is the honest constraint — tokens are 32 random bytes, so a
  // collision means a bug, not traffic. Refuse rather than silently degrade to
  // a non-unique index if existing data would violate it.
  if (duplicate_tokens.length > 0) {
    console.error(
      '[ensure-session-indexes] duplicate tokens present; resolve before indexing',
      { duplicate_count: duplicate_tokens.length },
    );
    process.exitCode = 1;
    return;
  }

  try {
    const token_index = await sessions.createIndex({ token: 1 }, { unique: true, name: 'token_unique' });

    // expireAfterSeconds: 0 means "expire at the time stored in this field",
    // so the reaper honours each session's own expiry rather than a fixed age.
    const ttl_index = await sessions.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'expiresAt_ttl' },
    );

    console.log('[ensure-session-indexes] complete', { token_index, ttl_index });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ensure-session-indexes] failed', { message });
    process.exitCode = 1;
  }
}

ensure_session_indexes()
  .catch((error) => {
    console.error('[ensure-session-indexes] unhandled failure', error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
