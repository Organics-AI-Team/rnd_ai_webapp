/**
 * Class-level guard for the 2026-09-21 unauthenticated-API incident.
 *
 * Nine route handlers under apps/web/app/api shipped to production reachable
 * without any credential, because middleware.ts excluded `/api` from its
 * matcher and no handler compensated. These tests fail on any regression of
 * that shape — a re-excluded matcher, a widened public allowlist, or a handler
 * that takes the acting identity from the request body.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repo_root = path.join(__dirname, '..', '..');
const middleware_path = path.join(repo_root, 'apps', 'web', 'middleware.ts');
const api_root = path.join(repo_root, 'apps', 'web', 'app', 'api');

/** Endpoints that legitimately authorize themselves instead of at the edge. */
const EXPECTED_PUBLIC_API_PREFIXES = ['/api/trpc'];

/**
 * Collect every Next route handler under app/api.
 *
 * @param dir - Directory to walk.
 * @returns Absolute paths of each route.ts found.
 */
function find_route_handlers(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return find_route_handlers(full);
    return entry.name === 'route.ts' ? [full] : [];
  });
}

test('middleware does not exempt /api from the auth matcher', () => {
  const source = fs.readFileSync(middleware_path, 'utf8');
  const matcher = /matcher:\s*\[(?<body>[^\]]*)\]/s.exec(source)?.groups?.body ?? '';

  assert.doesNotMatch(
    matcher,
    /\bapi\b/,
    'middleware matcher excludes /api again — every route handler under app/api ' +
      'would run with no credential check, the exact shape of the 2026-09-21 incident',
  );
});

test('the public API allowlist has not widened', () => {
  const source = fs.readFileSync(middleware_path, 'utf8');
  const block = /PUBLIC_API_PREFIXES\s*=\s*\[(?<body>[^\]]*)\]/s.exec(source)?.groups?.body;

  assert.ok(block, 'PUBLIC_API_PREFIXES not found — the edge gate was restructured');
  const prefixes = [...block.matchAll(/["'](?<value>[^"']+)["']/g)].map((m) => m.groups.value);

  assert.deepEqual(
    prefixes.sort(),
    [...EXPECTED_PUBLIC_API_PREFIXES].sort(),
    'an endpoint was added to the unauthenticated allowlist; each entry is a ' +
      'route the edge gate will not protect, so it needs its own review',
  );
});

test('no route handler takes the acting identity from the request body', () => {
  const offenders = find_route_handlers(api_root).filter((file) =>
    /body\.(userId|user_id|organizationId|accountId)\b/.test(fs.readFileSync(file, 'utf8')),
  );

  assert.deepEqual(
    offenders.map((file) => path.relative(repo_root, file)),
    [],
    'the request body is attacker-controlled: an authenticated caller can act ' +
      'as any user by editing one field. Resolve the actor from the session ' +
      '(createTRPCContext) instead',
  );
});
