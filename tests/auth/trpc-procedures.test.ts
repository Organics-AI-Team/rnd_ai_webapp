import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { RequestPrincipal } from "../../packages/shared-types/src/auth";
import {
  createCallerFactory,
  type TRPCContext,
} from "../../apps/ai/server/trpc";
import { appRouter } from "../../apps/ai/server/index";

const routers_dir = resolve(
  fileURLToPath(new URL("../../", import.meta.url)),
  "apps/ai/server/routers",
);

/**
 * Build a tRPC context for caller tests without any transport or database.
 *
 * @param principal - Verified principal, or null when unauthenticated.
 * @param auth_error - Stable resolution failure code when principal is null.
 * @returns A context object matching createTRPCContext's shape.
 */
function build_ctx(
  principal: RequestPrincipal | null,
  auth_error: "UNAUTHENTICATED" | "MEMBERSHIP_INACTIVE" | null,
): TRPCContext {
  return {
    principal,
    auth_error,
    resolver_used: "legacy",
    legacy_user: principal
      ? {
          id: principal.internal_user_id,
          accountId: principal.provider_user_id,
          organizationId: principal.active_tenant_id ?? "org-1",
          name: "Test User",
          email: "test@example.com",
          role: principal.tenant_role === "manager" ? "admin" : "shopper",
          status: "active",
          isActive: true,
        }
      : null,
  };
}

/**
 * Build an active tenant principal for a given role.
 *
 * @param tenant_role - Tenant role the principal should carry.
 * @returns A principal with that role's permission set.
 */
function tenant_principal(tenant_role: "manager" | "user"): RequestPrincipal {
  return {
    auth_provider: "legacy",
    provider_user_id: "account-1",
    internal_user_id: "507f1f77bcf86cd799439011",
    active_tenant_id: "507f1f77bcf86cd799439012",
    platform_role: null,
    tenant_role,
    permissions:
      tenant_role === "manager"
        ? [
            "tenant:read",
            "tenant:members:invite",
            "tenant:settings:write",
            "formula:draft",
            "formula:confirm",
            "ai:run",
          ]
        : ["tenant:read", "formula:draft", "ai:run"],
    membership_status: "active",
  };
}

const create_caller = createCallerFactory(appRouter);

describe("router architecture", () => {
  it("uses no publicProcedure outside auth.ts", () => {
    const violations: string[] = [];
    for (const file of readdirSync(routers_dir)) {
      if (!file.endsWith(".ts") || file === "auth.ts") continue;
      const content = readFileSync(resolve(routers_dir, file), "utf8");
      if (/\bpublicProcedure\b/.test(content)) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });

  it("restricts the public client-order ingress to one procedure in orders.ts", () => {
    for (const file of readdirSync(routers_dir)) {
      if (!file.endsWith(".ts")) continue;
      const content = readFileSync(resolve(routers_dir, file), "utf8");
      const usages = content.match(/\bpublicClientOrderProcedure\b/g) ?? [];
      if (file === "orders.ts") {
        expect(usages.length, "import + exactly one usage in orders.ts").toBe(2);
      } else {
        expect(usages.length, `no public ingress in ${file}`).toBe(0);
      }
    }
  });
});

describe("anonymous access", () => {
  const anonymous = create_caller(build_ctx(null, "UNAUTHENTICATED"));

  it("rejects anonymous business router calls", async () => {
    await expect(anonymous.organizations.list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects anonymous list/create/update/delete calls with UNAUTHORIZED", async () => {
    await expect(anonymous.users.list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      anonymous.users.create({
        accountId: "x",
        organizationId: "x",
        email: "x@example.com",
        name: "x",
        role: "shopper",
        status: "active",
        isActive: true,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonymous.orders.updateStatus({ id: "x", status: "pending" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonymous.organizations.addCredits({
        amount: 100,
        description: "x",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonymous.formulas.list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("keeps the client order form public but schema-validated", async () => {
    await expect(
      anonymous.orders.submitClientOrder({
        organizationId: "",
        productName: "",
        price: -1,
        quantity: 0,
        channel: "line",
        customerName: "",
        customerContact: "",
        shippingAddress: "",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("replaces signup with an explicit closed-provisioning error", async () => {
    await expect(
      anonymous.auth.signup({
        email: "new@example.com",
        password: "password",
        name: "New User",
        organizationName: "New University",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("suspended membership", () => {
  it("fails with FORBIDDEN instead of UNAUTHORIZED", async () => {
    const suspended = create_caller(build_ctx(null, "MEMBERSHIP_INACTIVE"));
    await expect(suspended.users.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("permission gates", () => {
  it("denies formula confirmation to a tenant user without formula:confirm", async () => {
    const student = create_caller(build_ctx(tenant_principal("user"), null));
    await expect(
      student.formulas.confirm({ id: "507f1f77bcf86cd799439099" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("denies credit administration to a tenant user", async () => {
    const student = create_caller(build_ctx(tenant_principal("user"), null));
    await expect(
      student.organizations.addCredits({ amount: 10, description: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
