# G1 — Clerk Identity and Provisioning Release Evidence

Branch: `v2/dev` · Recorded: 2026-07-14T23:05Z (UTC). No secrets appear here.

## Task completion map

| Task | Commit | Summary |
|---|---|---|
| G1.1 Clerk surface | `491d362` | @clerk/nextjs 7.5.18 + backend 3.11.5; clerkMiddleware proxy; ClerkProvider in body; sign-in/up/onboarding pages |
| G1.2 Projections | `f95847b` | UserProfile/Tenant/Membership/Invitation models; partial unique indexes; single-use super-admin bootstrap |
| G1.3 Clerk resolver | `6cc918d` | DB-authoritative resolve_clerk_principal; full permission catalogue; CLERK_CUTOVER-exclusive resolver selection |
| G1.4 Provisioning | `b0bacdd` | Idempotent provision_university; platformTenants router; platform console |
| G1.5 Webhooks/invitations | `de7e76e` | Signed webhook ingress; receipts; monotonic projections; single-membership rule; reconcile:clerk |
| G1.6 Legacy import | `5abe8f3` | bcrypt digest import with externalId linkage; dry-run default; migration runbook |
| G1.7 Cutover | this commit | Legacy auth UI/procedures deleted; Clerk-only client session handling; e2e suite |

## Code-side gates (run on v2/dev, 2026-07-14T23:0xZ)

- `npm test` — 154 passed / 0 failed (auth, provisioning, repositories, webhooks, security, architecture, regression).
- `npm run typecheck` — exit 0.
- `npm run security:scan` — 0 violations: no localStorage auth token, no custom password verification or session creation outside the retired legacy adapter, no public organization creation (provisioning path only).
- `npm run build:web` — production build succeeds (with and without Clerk keys).
- `npm run test:e2e -- tests/e2e/clerk-auth.spec.ts` — 7 staged tests (signed-out redirect, invited sign-up, imported-user sign-in, platform tenant creation, manager invitation, student denial incl. API 401/403, onboarding states); they self-skip without `E2E_CLERK_CONFIGURED=true`.

## Cutover state

- Custom client authentication is deleted: `auth-context.tsx`, `/login`, `/signup`, and the login/logout/me/signup procedures are gone; `authRouter` exposes only a public health probe. Client session handling is Clerk-only (`app-auth.tsx`: SignedIn state via Clerk hooks; no tokens in localStorage or JS cookies).
- The legacy server resolver remains solely as the `CLERK_CUTOVER=false` rollback adapter for existing cookie sessions (no new logins possible); it is retired in G5.

## PENDING_EXTERNAL_STAGING (deployment gates before production cutover)

1. Clerk Dashboard settings snapshot (from G1.1: invitation-only sign-up, org self-service disabled, custom roles, MFA for platform admins).
2. `CLERK_CUTOVER=true` in staging + `npm run migrate:clerk -- --apply --report=...` + `reconcile:clerk` per tenant with zero unexplained mismatches (record the report hash here).
3. Clerk webhook health (deliveries succeeding to `/api/webhooks/clerk`).
4. Staged `test:e2e` run output.
5. Rollback rehearsal: set `CLERK_CUTOVER=false`, verify existing legacy cookie sessions still authorize, then restore `true`.

## Rollback

`CLERK_CUTOVER=false` returns ingress to the legacy adapter during the bounded coexistence window (existing sessions only). Clerk IDs are additive; Account/Session collections remain until G5.
