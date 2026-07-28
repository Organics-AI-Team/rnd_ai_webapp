// tests/web/platform-tenant-detail-wiring.test.ts
/**
 * Plan 3 — static wiring for the platform tenant detail page (pattern:
 * tests/web/formulate-ui-wiring.test.ts).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Read a workspace file as UTF-8 source. */
function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("platform tenant detail wiring", () => {
  it("drives members/appoint/demote through the platformTenants router", () => {
    const page = source("apps/web/app/platform/tenants/[tenantId]/page.tsx");
    expect(page).toContain("trpc.platformTenants.listMembers.useQuery");
    expect(page).toContain("trpc.platformTenants.appointManager.useMutation");
    expect(page).toContain("trpc.platformTenants.demoteManager.useMutation");
    expect(page).toContain('member.tenantRole === "manager"');
    expect(page).toContain("window.confirm");
  });

  it("links tenant rows to the detail page", () => {
    const list = source("apps/web/app/platform/tenants/page.tsx");
    expect(list).toContain("/platform/tenants/${tenant._id}");
  });
});
