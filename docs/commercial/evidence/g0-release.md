# G0 — Security Containment Release Evidence

Branch: `v2/dev` · Evidence recorded: 2026-07-14T22:15:17Z (UTC) · HEAD at recording: `a846044a5a8c4fa98fd90de3c8a9cf6eb5362bba`

No secrets or connection strings appear in this document.

## Task completion map

| Task | Commit | Summary |
|---|---|---|
| G0.1 Verification baseline | `400486c` | Root vitest harness + architecture baseline test |
| G0.2 Patched web runtime | `d78ddfb`, `a942114` | Next.js 16.2.10 / React 19.2.7, proxy.ts, type debt repaid, no ignoreBuildErrors |
| G0.3 Public AI secret fallbacks removed | `3286a6c` | @rnd-ai/server-config private credential contract; public fallbacks deleted; external rotation ledger `PENDING_EXTERNAL_ROTATION` (deployment gate) |
| G0.4 Provider-neutral principal | `0f0790e` | RequestPrincipal contracts, legacy resolver, authorize assertions |
| G0.5 Principal in tRPC | `39e5378` | Context resolves cookie once; authenticated/tenant/manager procedures; signup closed; 16 routers converted |
| G0.6 Direct handlers guarded | `a846044` | with_request_principal on all 13 route files; body identity rejected |
| G0.7 Boundary scanner | this commit | scan-private-boundaries.ts wired to security:scan; zero findings |

## Gate command evidence (all run on v2/dev at `a846044`, 2026-07-14T22:0x–22:15Z UTC)

### npm test — exit 0

```
Test Files  8 passed (8)
     Tests  94 passed (94)
```

Coverage of the G0 acceptance behaviors:
- tests/auth/legacy-principal-resolver.test.ts (9): session/account/user/org rejection matrix, role mapping, no platform role from legacy roles.
- tests/auth/authorize.test.ts (10): permission and active-tenant assertions with stable codes.
- tests/auth/trpc-procedures.test.ts (9): no publicProcedure outside auth.ts; anonymous business calls → UNAUTHORIZED; suspended membership → FORBIDDEN; signup → PRECONDITION_FAILED; formula:confirm and manager gates; single pinned public client-order ingress.
- tests/auth/route-authorization.test.ts (43): every direct route × {no cookie → 401, expired cookie → 401, forged identity JSON → 400 IDENTITY_FIELD_NOT_ALLOWED}; guarded pass-through.
- tests/security/private-boundary-scan.test.ts (9): scanner fixtures + zero findings across the production tree.
- tests/security/public-ai-secrets.test.ts, tests/architecture, tests/regression (G0.1–G0.3 baselines).

### npm run typecheck — exit 0

`tsc --noEmit -p apps/web/tsconfig.json` — no errors, no ignoreBuildErrors.

### npm run security:scan — exit 0

```
security:scan — 0 private-boundary violations
```

Enforced rules: PUBLIC_BUSINESS_PROCEDURE, UNGUARDED_ROUTE_HANDLER, CLIENT_IDENTITY_FIELD, LOCALSTORAGE_AUTH_TOKEN, ORG_CREATION_OUTSIDE_PROVISIONING, IGNORED_TYPE_ERRORS.

### npm run build:web — exit 0

```
✓ Compiled successfully in 6.2s
✓ Generating static pages using 7 workers (31/31)
```

### npm run verify:commercial — exit 0

Chains all four gates above; observed exit code 0 at 2026-07-14T22:15:17Z.

## G0 exit criteria (program plan Steps 14–18)

- Next.js 16.2.10 / React 19.2.7: pinned in G0.2 (`d78ddfb`).
- proxy.ts runs redirect-only guidance; every server handler independently authorizes (G0.5/G0.6).
- All private tRPC procedures and route handlers use the temporary legacy principal adapter (G0.4–G0.6).
- Client-supplied userId/organizationId rejected at private boundaries: 400 IDENTITY_FIELD_NOT_ALLOWED on direct routes; tRPC input schemas no longer accept identity fields.
- Public AI credential fallbacks absent (G0.3); **external provider-console rotation remains a documented deployment gate: `PENDING_EXTERNAL_ROTATION` (see G0.3 CHANGELOG entry).**

## Known limitations carried to G1

- Legacy cookie sessions remain until the Clerk cutover (G1.7); auth.login/logout/me stay public by design until then.
- `orders.submitClientOrder` is a deliberate anonymous ingress (public customer order form, preserved G0.2 route contract), pinned to one usage by test and scanner allowlist.
- Fine-grained named permissions per business operation arrive with tenant repositories in G2.5; G0 uses the coarse tenant:read/ai:run/formula:* mapping.

## Rollback

Redeploy the previous image after blocking hostile headers at ingress (program rollback map, G0 row). No destructive schema change was made in G0; all changes are code-level and revert cleanly with the git history.
