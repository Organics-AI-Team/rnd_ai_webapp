import { NextRequest } from "next/server";
import { afterAll, describe, expect, it, vi } from "vitest";

import type { LegacyIdentityStore } from "../../apps/ai/server/auth/legacy-principal-resolver";
import {
  find_identity_field,
  set_identity_store_for_testing,
  with_request_principal,
} from "../../apps/web/lib/server/with-request-principal";

const future = new Date("2027-01-01T00:00:00.000Z");
const past = new Date("2020-01-01T00:00:00.000Z");

/**
 * In-memory identity store: one valid manager session ("valid-token") and one
 * expired session ("expired-token").
 */
const fake_store: LegacyIdentityStore = {
  find_session_by_token: async (token) => {
    if (token === "valid-token") {
      return { id: "s1", accountId: "acc-1", token, expiresAt: future };
    }
    if (token === "expired-token") {
      return { id: "s2", accountId: "acc-1", token, expiresAt: past };
    }
    return null;
  },
  find_account_by_id: async (account_id) =>
    account_id === "acc-1"
      ? { id: "acc-1", email: "manager@example.com", isActive: true }
      : null,
  find_user_by_account_id: async (account_id) =>
    account_id === "acc-1"
      ? {
          id: "507f1f77bcf86cd799439011",
          accountId: "acc-1",
          organizationId: "507f1f77bcf86cd799439012",
          name: "Manager",
          email: "manager@example.com",
          role: "admin" as const,
          status: "active" as const,
          isActive: true,
        }
      : null,
  find_organization_by_id: async (organization_id) =>
    organization_id === "507f1f77bcf86cd799439012"
      ? { id: "507f1f77bcf86cd799439012", isActive: true }
      : null,
};

set_identity_store_for_testing(fake_store);
afterAll(() => set_identity_store_for_testing(null));

/**
 * Build a NextRequest for a guarded route invocation.
 *
 * @param options - Method, cookie token, and JSON body for the request.
 * @returns NextRequest targeting a placeholder URL.
 */
function build_request(options: {
  method?: string;
  token?: string;
  body?: unknown;
}): NextRequest {
  const headers = new Headers();
  if (options.token) headers.set("cookie", `auth_token=${options.token}`);
  const init: RequestInit = { method: options.method ?? "POST", headers };
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(options.body);
  }
  return new NextRequest("http://localhost/api/test", init);
}

describe("with_request_principal", () => {
  it("rejects a forged tenant field before invoking the handler", async () => {
    const handler = vi.fn();
    const response = await with_request_principal(
      build_request({
        token: "valid-token",
        body: { message: "x", tenantId: "tenant-b" },
      }),
      "ai:run",
      handler,
    );
    expect(response.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it("finds identity fields nested in objects and arrays", () => {
    expect(find_identity_field({ a: [{ deep: { user_id: "x" } }] })).toBe(
      "a[0].deep.user_id",
    );
    expect(find_identity_field({ context: { organizationId: "x" } })).toBe(
      "context.organizationId",
    );
    expect(find_identity_field({ message: "hi", sessionId: "s" })).toBeNull();
  });

  it("passes the verified principal and parsed body to the handler", async () => {
    const handler = vi.fn(async () => new Response("ok"));
    const response = await with_request_principal(
      build_request({ token: "valid-token", body: { message: "hi" } }),
      "ai:run",
      handler,
    );
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        internal_user_id: "507f1f77bcf86cd799439011",
        active_tenant_id: "507f1f77bcf86cd799439012",
        tenant_role: "manager",
      }),
      { message: "hi" },
    );
  });
});

interface RouteCase {
  name: string;
  load: () => Promise<Record<string, unknown>>;
  invoke: (
    module: Record<string, any>,
    request: NextRequest,
  ) => Promise<Response>;
  method: string;
  body?: unknown;
}

const route_cases: RouteCase[] = [
  {
    name: "agents/list GET",
    load: () => import("../../apps/web/app/api/agents/list/route"),
    invoke: (m, request) => m.GET(request),
    method: "GET",
  },
  {
    name: "agents/execute POST",
    load: () => import("../../apps/web/app/api/agents/execute/route"),
    invoke: (m, request) => m.POST(request),
    method: "POST",
    body: { agentId: "general-assistant", request: "hello" },
  },
  {
    name: "agents/[agentId]/chat POST",
    load: () => import("../../apps/web/app/api/agents/[agentId]/chat/route"),
    invoke: (m, request) =>
      m.POST(request, { params: Promise.resolve({ agentId: "raw-materials-ai" }) }),
    method: "POST",
    body: { message: "hello" },
  },
  {
    name: "ai-chat POST",
    load: () => import("../../apps/web/app/api/ai-chat/route"),
    invoke: (m, request) => m.POST(request),
    method: "POST",
    body: { messages: [{ role: "user", content: "hi" }] },
  },
  {
    name: "ai-chat/refresh POST",
    load: () => import("../../apps/web/app/api/ai-chat/refresh/route"),
    invoke: (m, request) => m.POST(request),
    method: "POST",
    body: { action: "status" },
  },
  {
    name: "ai/cosmetic-enhanced POST",
    load: () => import("../../apps/web/app/api/ai/cosmetic-enhanced/route"),
    invoke: (m, request) => m.POST(request),
    method: "POST",
    body: { prompt: "hi" },
  },
  {
    name: "ai/enhanced-chat POST",
    load: () => import("../../apps/web/app/api/ai/enhanced-chat/route"),
    invoke: (m, request) => m.POST(request),
    method: "POST",
    body: { prompt: "hi" },
  },
  {
    name: "ai/raw-materials-agent POST",
    load: () => import("../../apps/web/app/api/ai/raw-materials-agent/route"),
    invoke: (m, request) => m.POST(request),
    method: "POST",
    body: { prompt: "hi" },
  },
  {
    name: "ai/raw-materials-agent langgraph POST",
    load: () =>
      import("../../apps/web/app/api/ai/raw-materials-agent/langgraph-route"),
    invoke: (m, request) => m.POST(request),
    method: "POST",
    body: { prompt: "hi" },
  },
  {
    name: "index-data POST",
    load: () => import("../../apps/web/app/api/index-data/route"),
    invoke: (m, request) => m.POST(request),
    method: "POST",
    body: { indexType: "all" },
  },
  {
    name: "rag/hybrid-search POST",
    load: () => import("../../apps/web/app/api/rag/hybrid-search/route"),
    invoke: (m, request) => m.POST(request),
    method: "POST",
    body: { query: "hi" },
  },
  {
    name: "rag/searchRawMaterials POST",
    load: () => import("../../apps/web/app/api/rag/searchRawMaterials/route"),
    invoke: (m, request) => m.POST(request),
    method: "POST",
    body: { query: "hi" },
  },
  {
    name: "rag/unified-search POST",
    load: () => import("../../apps/web/app/api/rag/unified-search/route"),
    invoke: (m, request) => m.POST(request),
    method: "POST",
    body: { query: "hi" },
  },
];

describe.each(route_cases)("route guard: $name", (route_case) => {
  it("returns 401 without a session cookie", async () => {
    const module = await route_case.load();
    const response = await route_case.invoke(
      module,
      build_request({ method: route_case.method, body: route_case.body }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 401 with an expired session cookie", async () => {
    const module = await route_case.load();
    const response = await route_case.invoke(
      module,
      build_request({
        method: route_case.method,
        token: "expired-token",
        body: route_case.body,
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 400 IDENTITY_FIELD_NOT_ALLOWED for client identity fields", async () => {
    if (route_case.method === "GET") return;
    const module = await route_case.load();
    const response = await route_case.invoke(
      module,
      build_request({
        method: route_case.method,
        token: "valid-token",
        body: { ...(route_case.body as object), userId: "someone-else" },
      }),
    );
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error?: string };
    expect(payload.error).toBe("IDENTITY_FIELD_NOT_ALLOWED");
  });
});

describe("authenticated pass-through", () => {
  it("agents/list GET returns a non-auth result for a valid principal", async () => {
    const module = await import("../../apps/web/app/api/agents/list/route");
    const response = await (module as any).GET(
      build_request({ method: "GET", token: "valid-token" }),
    );
    expect([401, 403]).not.toContain(response.status);
  });
});
