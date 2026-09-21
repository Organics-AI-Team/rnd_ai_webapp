import { describe, expect, it } from "vitest";

import {
  TENANT_ROLE_PERMISSIONS,
  type Permission,
} from "../../packages/shared-types/src/auth";

describe("tenant:members:remove_user permission (Plan 3)", () => {
  it("exists in the Permission union and is granted to managers only", () => {
    // The annotation itself is a compile-time assertion that the literal is
    // part of the Permission union.
    const removal: Permission = "tenant:members:remove_user";
    expect(TENANT_ROLE_PERMISSIONS.manager).toContain(removal);
    expect(TENANT_ROLE_PERMISSIONS.user).not.toContain(removal);
  });
});
