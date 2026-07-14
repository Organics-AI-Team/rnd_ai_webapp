# Commercial Security Containment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Patch the unsupported web stack and close the current unauthenticated/private API gaps without coupling application authorization to the later Clerk implementation.

**Architecture:** Introduce a provider-neutral RequestPrincipal and authorization middleware. During this gate only, a LegacyPrincipalResolver verifies the current opaque session against MongoDB; every tRPC procedure and route handler consumes the derived principal. The resolver is replaced by Clerk in G1 while permissions and repository call sites stay stable.

**Tech Stack:** Next.js 16.2.10, React 19.2.7, TypeScript 5.9, tRPC 11.6, MongoDB driver 6.21.0, Zod 3.25, Vitest 4.1.10.

## Global Constraints

- No new custom-auth features; proxy is a navigation optimization only; API authorization occurs inside handlers; no body identity fields; no public university creation; status must be active; the legacy adapter expires at G1 and cannot grant platform roles.

---

## File Structure

- packages/shared-types/src/auth.ts owns provider-neutral roles, permissions, and RequestPrincipal.
- apps/ai/server/auth/ owns the temporary verified legacy resolver and authorization assertions.
- apps/ai/server/trpc.ts owns principal construction for tRPC and named protected procedures.
- apps/web/lib/server/with-request-principal.ts owns direct Route Handler authorization.
- scripts/security/scan-private-boundaries.ts owns static enforcement; tests/auth and tests/security own regression coverage.

### Task 1: Add a reproducible verification baseline

**Files:**

- Modify: package.json
- Modify: apps/web/package.json
- Create: vitest.config.ts
- Create: tests/architecture/framework-baseline.test.ts
- Create: tests/setup.ts

**Interfaces:**

- Consumes: current workspace manifests.

- Produces: root test, typecheck, and security-scan commands used by every later gate.

**Failing test anchor:**

- [ ] **Step 1:** Write tests/architecture/framework-baseline.test.ts that reads apps/web/package.json and asserts exact versions next=16.2.10, react=19.2.7, react-dom=19.2.7 and that next.config.js does not contain ignoreBuildErrors.
- [ ] **Step 2:** Add this exact initial assertion before changing dependencies:

~~~ts
import { describe, expect, it } from "vitest";
import web_package from "../../apps/web/package.json";

describe("commercial framework baseline", () => {
  it("uses the patched supported web stack", () => {
    expect(web_package.dependencies.next).toBe("16.2.10");
    expect(web_package.dependencies.react).toBe("19.2.7");
    expect(web_package.dependencies["react-dom"]).toBe("19.2.7");
  });
});
~~~

**Implementation anchor:**

~~~ts
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "apps/**/__tests__/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
~~~

- [ ] **Step 3:** Run npm test -- tests/architecture/framework-baseline.test.ts.
- [ ] **Step 4:** Expected: FAIL because the repository declares Next 14.2.15 and React 19.2.0.
- [ ] **Step 5:** Add root devDependencies vitest=4.1.10, @vitest/coverage-v8=4.1.10, and tsx=4.20.6.
- [ ] **Step 6:** Add root scripts: test=vitest run, test:watch=vitest, typecheck=tsc --noEmit -p apps/web/tsconfig.json, security:scan=tsx scripts/security/scan-private-boundaries.ts, verify:commercial=npm run typecheck && npm test && npm run security:scan && npm run build:web.
- [ ] **Step 7:** Create vitest.config.ts with test.include set to tests/**/*.test.ts and apps/**/__tests__/**/*.test.ts, environment=node, setupFiles=[tests/setup.ts], clearMocks=true, restoreMocks=true.
- [ ] **Step 8:** Run npm install to update package-lock.json.
- [ ] **Step 9:** Run npm test -- tests/architecture/framework-baseline.test.ts.
- [ ] **Step 10:** Expected: still FAIL until Task 2 completes.
- [ ] **Step 11:** Commit: git add package.json package-lock.json vitest.config.ts tests && git commit -m "test: add commercial verification baseline"

### Task 2: Upgrade the web runtime and expose current type debt

**Files:**

- Modify: apps/web/package.json
- Modify: apps/ai/package.json
- Modify: apps/web/next.config.js
- Rename: apps/web/middleware.ts to apps/web/proxy.ts
- Modify: apps/web/app/layout.tsx
- Modify: apps/ai/agents/core/agent-usage-example.ts
- Modify: apps/ai/agents/raw-materials-ai/langgraph-agent.ts
- Modify: apps/ai/server/routers/calculations.ts
- Modify: apps/ai/services/regulatory/cosmetic-regulatory-sources.ts
- Modify: apps/ai/services/thresholds/cosmetic-quality-thresholds.ts
- Modify: apps/web/app/api/ai/cosmetic-enhanced/route.ts
- Modify: apps/web/components/dashboard/cosmetic-ai-metrics-dashboard.tsx
- Modify: apps/web/components/formula-form.tsx

**Interfaces:**

- Consumes: failing framework test and the current tsc error list.

- Produces: a supported Next/React runtime with TypeScript enforcement restored.

**Failing test anchor:**

~~~ts
it("uses a patched framework and enforces TypeScript", () => {
  expect(web_package.dependencies.next).toBe("16.2.10");
  expect(web_package.dependencies.react).toBe("19.2.7");
  expect(readFileSync("apps/web/next.config.js", "utf8"))
    .not.toContain("ignoreBuildErrors");
});
~~~

**Implementation anchor:**

~~~ts
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const token = request.cookies.get("auth_token")?.value;
  if (!token && !is_public_path(request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  return NextResponse.next();
}
~~~

- [ ] **Step 1:** Pin apps/web dependencies next=16.2.10, react=19.2.7, react-dom=19.2.7, and devDependencies @types/react=19.2.7, @types/react-dom=19.2.3, eslint-config-next=16.2.10.
- [ ] **Step 2:** Pin mongodb=6.21.0 in apps/ai/package.json so the server and the later MongoDBSaver dependency share one compatible 6.x driver.
- [ ] **Step 3:** Replace the removed next lint script with eslint . and add typecheck=tsc --noEmit.
- [ ] **Step 4:** Rename middleware.ts to proxy.ts and export async function proxy(request: NextRequest). Preserve its redirect-only behavior until Clerk replaces it in G1.
- [ ] **Step 5:** Remove the typescript.ignoreBuildErrors object from next.config.js.
- [ ] **Step 6:** Move all environment-dependent client construction behind getter functions so importing a route during next build does not require runtime secrets.
- [ ] **Step 7:** Fix the existing type errors using these concrete rules: pass numeric topK to legacy search calls; type the legacy StateGraph with Annotation rather than a Zod object; pass Error as the logger error argument rather than merging arbitrary fields into Error; add targetRegions and complete regional/safety records to the regulatory interfaces; use the existing ThresholdLevel mapping for compliance thresholds; add the fields actually rendered by the metrics dashboard; infer Formula from the formulas router output and include confirmed in its status union.
- [ ] **Step 8:** Run npm install.
- [ ] **Step 9:** Run npm run typecheck.
- [ ] **Step 10:** Expected: PASS with no ignored error categories.
- [ ] **Step 11:** Run npm test -- tests/architecture/framework-baseline.test.ts.
- [ ] **Step 12:** Expected: PASS.
- [ ] **Step 13:** Run npm run build:web.
- [ ] **Step 14:** Expected: Next.js 16.2.10 production build completes without ignoreBuildErrors.
- [ ] **Step 15:** Commit: git add apps package.json package-lock.json && git commit -m "build: upgrade to patched Next and React baseline"

### Task 3: Remove public AI secret fallbacks and rotate exposed credentials

**Files:**

- Modify: docker-compose.yml
- Modify: apps/web/Dockerfile
- Modify: apps/web/lib/env.ts
- Modify: apps/ai/lib/env.ts
- Modify: apps/ai/lib/config.ts
- Modify: apps/web/app/api/ai-chat/route.ts
- Modify: apps/web/app/api/ai/cosmetic-enhanced/route.ts
- Modify: apps/web/app/api/ai/enhanced-chat/route.ts
- Modify: .env.example
- Create: tests/security/public-ai-secrets.test.ts
- Create: docs/commercial/evidence/g0-secret-rotation.md

**Interfaces:**

- Consumes: server-only GEMINI_API_KEY, OPENAI_API_KEY, QDRANT_API_KEY, and approved web-search credentials.
- Produces: one server-only credential loader and evidence that previously exposed credentials were rotated.

**Failing test anchor:**

~~~ts
it("contains no public AI credential name or client fallback", () => {
  const findings = scan_public_ai_secrets(repository_root);
  expect(findings).toEqual([]);
});
~~~

**Implementation anchor:**

~~~ts
export function require_server_ai_credentials(
  env: NodeJS.ProcessEnv,
): ServerAICredentials {
  return Object.freeze({
    gemini_api_key: require_secret(env, "GEMINI_API_KEY"),
    openai_api_key: optional_secret(env, "OPENAI_API_KEY"),
    qdrant_api_key: optional_secret(env, "QDRANT_API_KEY"),
  });
}
~~~

- [ ] **Step 1:** Write the failing source scan for NEXT_PUBLIC_GEMINI_API_KEY, NEXT_PUBLIC_OPENAI_API_KEY, provider keys in client components, and server fallbacks from a public variable.
- [ ] **Step 2:** Run npm test -- tests/security/public-ai-secrets.test.ts.
- [ ] **Step 3:** Expected: FAIL on docker-compose.yml, apps/web/Dockerfile, and current provider/route configuration.
- [ ] **Step 4:** Delete public AI key build args and environment entries from Docker and .env.example. Keep public Clerk publishable key and public API URL because neither is a provider secret.
- [ ] **Step 5:** Route provider construction through require_server_ai_credentials inside server-only adapters. Delete every fallback from server key to NEXT_PUBLIC key and every client-side provider constructor.
- [ ] **Step 6:** Rotate Gemini, OpenAI, Qdrant, and web-search credentials in each environment where a public variable was deployed. Record provider, environment, rotation timestamp, verifier, and old-key revocation result in g0-secret-rotation.md; never record a key value or digest.
- [ ] **Step 7:** Run npm test -- tests/security/public-ai-secrets.test.ts and npm run security:scan.
- [ ] **Step 8:** Expected: PASS with zero public AI credential findings.
- [ ] **Step 9:** Commit: git add docker-compose.yml apps .env.example tests/security docs/commercial/evidence && git commit -m "fix: remove public AI credential fallbacks"

### Task 4: Define the provider-neutral request principal

**Files:**

- Create: packages/shared-types/src/auth.ts
- Modify: packages/shared-types/src/index.ts
- Create: apps/ai/server/auth/errors.ts
- Create: apps/ai/server/auth/legacy-principal-resolver.ts
- Create: apps/ai/server/auth/authorize.ts
- Create: tests/auth/legacy-principal-resolver.test.ts
- Create: tests/auth/authorize.test.ts

**Interfaces:**

- Consumes: verified legacy session, User record, and Organization record.

- Produces: RequestPrincipal and named permission assertions that G1 can keep unchanged.

**Failing test anchor:**

~~~ts
it("never grants a platform role from a legacy tenant role", async () => {
  const principal = await resolve_legacy_principal(valid_admin_token, fake_db);
  expect(principal.tenant_role).toBe("manager");
  expect(principal.platform_role).toBeNull();
  expect(principal.permissions).not.toContain("platform:tenants:create");
});
~~~

- [x] **Step 1:** Write a failing resolver test for missing, expired, inactive-account, suspended-user, missing-organization, and valid session cases.
- [x] **Step 2:** Write a failing authorization test proving a legacy admin maps only to tenant manager, never platform admin, and that shipper/shopper map to tenant user.
- [x] **Step 3:** Run npm test -- tests/auth.
- [x] **Step 4:** Expected: FAIL because the modules do not exist.
- [x] **Step 5:** Add these contracts to packages/shared-types/src/auth.ts:

**Implementation anchor:**

~~~ts
export type PlatformRole = "super_admin" | "admin";
export type TenantRole = "manager" | "user";
export type Permission =
  | "tenant:read"
  | "tenant:members:invite"
  | "tenant:settings:write"
  | "formula:draft"
  | "formula:confirm"
  | "ai:run"
  | "platform:tenants:create"
  | "platform:roles:grant";

export interface RequestPrincipal {
  auth_provider: "legacy" | "clerk";
  provider_user_id: string;
  internal_user_id: string;
  active_tenant_id: string | null;
  platform_role: PlatformRole | null;
  tenant_role: TenantRole | null;
  permissions: readonly Permission[];
  membership_status: "active" | "suspended" | null;
}
~~~

- [x] **Step 6:** Implement resolve_legacy_principal(token, db) with one session query and one user/account/organization lookup sequence. Reject any record whose expiry/status/isActive is invalid.
- [x] **Step 7:** Return provider_user_id as the legacy account ID and map admin to manager; shipper and shopper map to user. Return platform_role=null for every legacy user.
- [x] **Step 8:** Implement require_permission(principal, permission) and require_active_tenant(principal) using typed AuthorizationError codes UNAUTHENTICATED, MEMBERSHIP_INACTIVE, FORBIDDEN.
- [x] **Step 9:** Run npm test -- tests/auth.
- [x] **Step 10:** Expected: PASS.
- [x] **Step 11:** Commit: git add packages/shared-types apps/ai/server/auth tests/auth && git commit -m "feat: add provider-neutral request principal"

### Task 5: Put the principal into tRPC and close public procedures

**Files:**

- Modify: apps/ai/server/trpc.ts
- Modify: apps/ai/server/routers/auth.ts
- Modify: apps/ai/server/routers/organizations.ts
- Modify: apps/ai/server/routers/users.ts
- Modify: apps/ai/server/routers/orders.ts
- Modify: apps/ai/server/routers/calculations.ts
- Modify: apps/ai/server/routers/chat-threads.ts
- Modify: apps/ai/server/routers/conversations.ts
- Modify: apps/ai/server/routers/feedback.ts
- Modify: apps/ai/server/routers/formula-comments.ts
- Modify: apps/ai/server/routers/formula-version-logs.ts
- Modify: apps/ai/server/routers/formulas.ts
- Modify: apps/ai/server/routers/products.ts
- Modify: apps/ai/server/routers/rag.ts
- Modify: apps/ai/server/routers/raw-materials-conversations.ts
- Modify: apps/ai/server/routers/raw-materials-feedback.ts
- Modify: apps/ai/server/routers/stock.ts
- Modify: apps/ai/server/routers/userLogs.ts
- Create: tests/auth/trpc-procedures.test.ts

**Interfaces:**

- Consumes: RequestPrincipal.

- Produces: authenticatedProcedure, tenantProcedure(permission), managerProcedure, and no public business mutations.

**Failing test anchor:**

~~~ts
it("rejects anonymous business router calls", async () => {
  const caller = app_router.createCaller({ principal: null });
  await expect(caller.organizations.current()).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
});
~~~

- [x] **Step 1:** Write an architecture test that parses every router except auth.ts and fails if publicProcedure appears.
- [x] **Step 2:** Write caller tests proving anonymous list/create/update/delete calls fail with UNAUTHORIZED and suspended membership fails with FORBIDDEN.
- [x] **Step 3:** Run npm test -- tests/auth/trpc-procedures.test.ts.
- [x] **Step 4:** Expected: FAIL and report organizations, users, orders, and other unprotected procedures.
- [x] **Step 5:** Change createTRPCContext to resolve the legacy token once and expose principal: RequestPrincipal | null. Do not expose request body organizationId or userId as context.
- [x] **Step 6:** Implement this procedure stack:

**Implementation anchor:**

~~~ts
const authenticated_middleware = t.middleware(({ ctx, next }) => {
  if (!ctx.principal) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, principal: ctx.principal } });
});

export const authenticatedProcedure = t.procedure.use(authenticated_middleware);
export const tenantProcedure = (permission: Permission) =>
  authenticatedProcedure.use(({ ctx, next }) => {
    require_permission(ctx.principal, permission);
    return next({ ctx });
  });
~~~

- [x] **Step 7:** Delete auth.signup. Replace it with an explicit GONE error saying universities are provisioned by platform administration. Keep login/logout/me only until G1, and derive logout identity from the session rather than input.
- [x] **Step 8:** Convert every business procedure to authenticatedProcedure or tenantProcedure. Require formula:confirm for both the formula router confirm mutation and any status transition to confirmed/approved.
- [x] **Step 9:** Remove organizationId and createdBy/userId identity fields from input schemas where they are derivable; use ctx.principal values.
- [x] **Step 10:** Run npm test -- tests/auth/trpc-procedures.test.ts.
- [x] **Step 11:** Expected: PASS with zero public business procedures.
- [x] **Step 12:** Commit: git add apps/ai/server tests/auth && git commit -m "fix: require verified principals for tRPC operations"

### Task 6: Guard every direct route handler and remove body identity

**Files:**

- Create: apps/web/lib/server/with-request-principal.ts
- Modify: apps/web/app/api/agents/[agentId]/chat/route.ts
- Modify: apps/web/app/api/agents/execute/route.ts
- Modify: apps/web/app/api/agents/list/route.ts
- Modify: apps/web/app/api/ai-chat/refresh/route.ts
- Modify: apps/web/app/api/ai-chat/route.ts
- Modify: apps/web/app/api/ai/cosmetic-enhanced/route.ts
- Modify: apps/web/app/api/ai/enhanced-chat/route.ts
- Modify: apps/web/app/api/ai/raw-materials-agent/langgraph-route.ts
- Modify: apps/web/app/api/ai/raw-materials-agent/route.ts
- Modify: apps/web/app/api/index-data/route.ts
- Modify: apps/web/app/api/rag/hybrid-search/route.ts
- Modify: apps/web/app/api/rag/searchRawMaterials/route.ts
- Modify: apps/web/app/api/rag/unified-search/route.ts
- Create: tests/auth/route-authorization.test.ts

**Interfaces:**

- Consumes: verified auth_token during G0 and Permission requirement per route.

- Produces: guarded handlers receiving RequestPrincipal as an argument.

**Failing test anchor:**

~~~ts
it("rejects a forged tenant field before invoking the handler", async () => {
  const handler = vi.fn();
  const response = await with_request_principal(
    request_with_json({ message: "x", tenantId: tenant_b }),
    "ai:run",
    handler,
  );
  expect(response.status).toBe(400);
  expect(handler).not.toHaveBeenCalled();
});
~~~

**Implementation anchor:**

~~~ts
export async function with_request_principal(
  request: NextRequest,
  permission: Permission,
  handler: (principal: RequestPrincipal) => Promise<Response>,
): Promise<Response> {
  const principal = await resolve_request_principal(request);
  require_permission(principal, permission);
  const body = await read_json_without_identity_fields(request);
  request_body_cache.set(request, body);
  return handler(principal);
}
~~~

- [x] **Step 1:** Write table-driven tests that invoke every listed handler without a cookie, with an expired cookie, and with a valid principal. Expect 401, 401, and a non-auth result respectively.
- [x] **Step 2:** Add tests that send a different userId, orgId, organizationId, or tenantId in JSON and assert 400 IDENTITY_FIELD_NOT_ALLOWED.
- [x] **Step 3:** Run npm test -- tests/auth/route-authorization.test.ts.
- [x] **Step 4:** Expected: FAIL because direct routes are unguarded.
- [x] **Step 5:** Implement with_request_principal(request, permission, handler). It verifies the legacy cookie, checks permission, rejects identity fields recursively, and calls handler(principal).
- [x] **Step 6:** Wrap agent and AI execution routes with ai:run, indexing routes with tenant:settings:write, and retrieval routes with tenant:read.
- [x] **Step 7:** Pass principal.internal_user_id and principal.active_tenant_id into service context; delete all fallbacks to body identity.
- [x] **Step 8:** Keep apps/web/app/api/trpc/[trpc]/route.ts outside this wrapper because its tRPC context performs the same verification.
- [x] **Step 9:** Run npm test -- tests/auth/route-authorization.test.ts.
- [x] **Step 10:** Expected: PASS for all 13 route files.
- [x] **Step 11:** Commit: git add apps/web/app/api apps/web/lib/server tests/auth && git commit -m "fix: authorize direct API handlers"

### Task 7: Make boundary regressions fail CI

**Files:**

- Create: scripts/security/scan-private-boundaries.ts
- Create: tests/security/private-boundary-scan.test.ts
- Create: docs/commercial/evidence/g0-release.md
- Modify: CHANGELOG.md

**Interfaces:**

- Consumes: source tree.

- Produces: deterministic policy violations with file and line numbers.

**Failing test anchor:**

~~~ts
it("finds all private-boundary violations", () => {
  const findings = scan_private_boundaries([
    source("router.ts", "publicProcedure.mutation(() => 1)"),
    source("route.ts", "export async function POST() {}"),
  ]);
  expect(findings.map((finding) => finding.code)).toEqual([
    "PUBLIC_BUSINESS_PROCEDURE",
    "UNGUARDED_ROUTE_HANDLER",
  ]);
});
~~~

**Implementation anchor:**

~~~ts
export function scan_private_boundaries(
  files: readonly SourceFile[],
): readonly SecurityFinding[] {
  return files.flatMap((file) => [
    ...find_public_business_procedures(file),
    ...find_unguarded_route_handlers(file),
    ...find_client_identity_fields(file),
    ...find_ignored_type_errors(file),
  ]);
}
~~~

- [ ] **Step 1:** Write a failing test fixture containing publicProcedure in a business router, an unwrapped route.ts, and request JSON userId. Assert three findings.
- [ ] **Step 2:** Implement the scanner with TypeScript AST parsing. Allow publicProcedure only in auth.ts for the bounded G0 login/logout/me set and require every other route handler to call with_request_principal or be the tRPC adapter.
- [ ] **Step 3:** Reject localStorage auth_token writes, organization creation outside the provisioning service path reserved for G1, and ignoreBuildErrors.
- [ ] **Step 4:** Run npm run security:scan.
- [ ] **Step 5:** Expected: PASS with zero findings in production source.
- [ ] **Step 6:** Run npm run verify:commercial.
- [ ] **Step 7:** Expected: tests, typecheck, security scan, and web build all exit 0.
- [ ] **Step 8:** Fill docs/commercial/evidence/g0-release.md with command, UTC timestamp, commit SHA, exit code, and complete output for each G0 gate. Do not write secrets or connection strings.
- [ ] **Step 9:** Add the G0 containment changes and remaining Clerk cutover limitation to CHANGELOG.md.
- [ ] **Step 10:** Commit: git add scripts tests/security docs/commercial CHANGELOG.md && git commit -m "ci: enforce private server boundaries"
