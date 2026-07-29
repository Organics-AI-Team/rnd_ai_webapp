// tests/web/org-switch-ui-wiring.test.ts
/**
 * Plan 3 — static wiring for the org switcher, the org-switch cache guard,
 * and the role-gated navigation links (pattern:
 * tests/web/formulate-ui-wiring.test.ts).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Read a workspace file as UTF-8 source. */
function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("org switcher panel", () => {
  it("wraps OrganizationSwitcher with the cache-clearing switch guard", () => {
    const panel = source("apps/web/components/org_switcher_panel.tsx");
    expect(panel).toContain("<OrganizationSwitcher");
    expect(panel).toContain("hidePersonal");
    expect(panel).toContain("queryClient.clear()");
    // First-render guard: never clear on mount, only on a real switch.
    expect(panel).toContain("previous_org.current === undefined");
    // In-app member admin: Clerk's own manage/create surfaces are hidden.
    expect(panel).toContain("organizationSwitcherPopoverActionButton__manageOrganization");
    expect(panel).toContain("organizationSwitcherPopoverActionButton__createOrganization");
  });
});

describe("navigation", () => {
  it("gates the switcher on Clerk mode and the links on auth.me roles", () => {
    const nav = source("apps/web/components/navigation.tsx");
    expect(nav).toContain("clerk_enabled &&");
    expect(nav).toContain("<OrgSwitcherPanel");
    expect(nav).toContain("trpc.auth.me.useQuery");
    expect(nav).toContain('"/settings/members"');
    expect(nav).toContain('"/platform/tenants"');
    expect(nav).toContain("is_tenant_manager");
    expect(nav).toContain("has_platform_role");
  });
});
