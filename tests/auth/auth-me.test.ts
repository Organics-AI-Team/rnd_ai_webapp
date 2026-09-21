// tests/auth/auth-me.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { principal_display_view } from "../../apps/ai/server/routers/auth";
import { TENANT_ROLE_PERMISSIONS } from "../../packages/shared-types/src/auth";
import type { RequestPrincipal } from "../../packages/shared-types/src/auth";

const manager: RequestPrincipal = {
  auth_provider: "clerk",
  provider_user_id: "user_mgr",
  internal_user_id: "507f1f77bcf86cd799439001",
  active_tenant_id: "507f1f77bcf86cd799439031",
  platform_role: null,
  tenant_role: "manager",
  permissions: TENANT_ROLE_PERMISSIONS.manager,
  membership_status: "active",
};

describe("principal_display_view", () => {
  it("returns nulls for an anonymous session", () => {
    expect(principal_display_view(null)).toEqual({
      tenant_role: null,
      platform_role: null,
      membership_status: null,
    });
  });

  it("projects exactly the three display fields for a resolved principal", () => {
    expect(principal_display_view(manager)).toEqual({
      tenant_role: "manager",
      platform_role: null,
      membership_status: "active",
    });
  });
});

describe("auth.me wiring", () => {
  it("exposes me as a public display-only query on the auth router", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/ai/server/routers/auth.ts"),
      "utf8",
    );
    expect(source).toMatch(/me:\s*publicProcedure\.query/);
    expect(source).toContain("principal_display_view(ctx.principal)");
  });
});
