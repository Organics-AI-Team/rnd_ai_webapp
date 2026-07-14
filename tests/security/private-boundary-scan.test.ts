import { describe, expect, it } from "vitest";

import {
  collect_production_sources,
  scan_private_boundaries,
  type SourceFile,
} from "../../scripts/security/scan-private-boundaries";

/**
 * Build an in-memory source file for scanner fixtures.
 *
 * @param path - Repo-relative path controlling which rules apply.
 * @param content - TypeScript source text.
 * @returns SourceFile fixture.
 */
function source(path: string, content: string): SourceFile {
  return { path, content };
}

describe("scan_private_boundaries fixtures", () => {
  it("finds all private-boundary violations", () => {
    const findings = scan_private_boundaries([
      source(
        "apps/ai/server/routers/router.ts",
        "publicProcedure.mutation(() => 1)",
      ),
      source(
        "apps/web/app/api/example/route.ts",
        "export async function POST(request: NextRequest) { return new Response('x'); }",
      ),
      source(
        "apps/web/app/api/other/route.ts",
        `export async function POST(request: NextRequest) {
  return with_request_principal(request, 'ai:run', async () => {
    const { userId } = await request.json();
    return new Response(userId);
  });
}`,
      ),
    ]);
    expect(findings.map((finding) => finding.code)).toEqual([
      "PUBLIC_BUSINESS_PROCEDURE",
      "UNGUARDED_ROUTE_HANDLER",
      "CLIENT_IDENTITY_FIELD",
    ]);
    expect(findings.every((finding) => finding.line > 0)).toBe(true);
  });

  it("allows publicProcedure only in the auth router", () => {
    const findings = scan_private_boundaries([
      source(
        "apps/ai/server/routers/auth.ts",
        "export const authRouter = router({ login: publicProcedure.mutation(() => 1) });",
      ),
    ]);
    expect(findings).toEqual([]);
  });

  it("allows the client-order ingress only in orders.ts", () => {
    const clean = scan_private_boundaries([
      source(
        "apps/ai/server/routers/orders.ts",
        "submitClientOrder: publicClientOrderProcedure.mutation(() => 1)",
      ),
    ]);
    expect(clean).toEqual([]);
    const dirty = scan_private_boundaries([
      source(
        "apps/ai/server/routers/products.ts",
        "leak: publicClientOrderProcedure.mutation(() => 1)",
      ),
    ]);
    expect(dirty.map((finding) => finding.code)).toEqual([
      "PUBLIC_BUSINESS_PROCEDURE",
    ]);
  });

  it("exempts the tRPC adapter, webhooks, and OPTIONS handlers from the route guard rule", () => {
    const findings = scan_private_boundaries([
      source(
        "apps/web/app/api/trpc/[trpc]/route.ts",
        "export async function POST(request: NextRequest) { return handler(request); }",
      ),
      source(
        "apps/web/app/api/webhooks/clerk/route.ts",
        "export async function POST(request: Request) { return handle_clerk_webhook(request, deps); }",
      ),
      source(
        "apps/web/app/api/example/route.ts",
        "export async function OPTIONS() { return new Response(null); }",
      ),
    ]);
    expect(findings).toEqual([]);
  });

  it("flags identity reads from query parameters", () => {
    const findings = scan_private_boundaries([
      source(
        "apps/web/app/api/example/route.ts",
        `export async function GET(request: NextRequest) {
  return with_request_principal(request, 'ai:run', async () => {
    const userId = new URL(request.url).searchParams.get('userId');
    return new Response(userId ?? '');
  });
}`,
      ),
    ]);
    expect(findings.map((finding) => finding.code)).toEqual([
      "CLIENT_IDENTITY_FIELD",
    ]);
  });

  it("flags localStorage auth token writes", () => {
    const findings = scan_private_boundaries([
      source(
        "apps/web/lib/example.tsx",
        "localStorage.setItem('auth_token', token);",
      ),
    ]);
    expect(findings.map((finding) => finding.code)).toEqual([
      "LOCALSTORAGE_AUTH_TOKEN",
    ]);
  });

  it("flags organization creation outside the provisioning service", () => {
    const findings = scan_private_boundaries([
      source(
        "apps/ai/server/routers/example.ts",
        'await db.collection("organizations").insertOne({ name });',
      ),
      source(
        "apps/ai/server/services/provisioning/create-university.ts",
        'await db.collection("organizations").insertOne({ name });',
      ),
    ]);
    expect(findings.map((finding) => finding.code)).toEqual([
      "ORG_CREATION_OUTSIDE_PROVISIONING",
    ]);
    expect(findings[0]?.file).toBe("apps/ai/server/routers/example.ts");
  });

  it("flags ignored build errors", () => {
    const findings = scan_private_boundaries([
      source(
        "apps/web/next.config.js",
        "module.exports = { typescript: { ignoreBuildErrors: true } };",
      ),
    ]);
    expect(findings.map((finding) => finding.code)).toEqual([
      "IGNORED_TYPE_ERRORS",
    ]);
  });
});

describe("production tree", () => {
  it("contains zero private-boundary violations", () => {
    const findings = scan_private_boundaries(collect_production_sources());
    expect(
      findings.map((f) => `${f.code} ${f.file}:${f.line}`),
    ).toEqual([]);
  });
});
