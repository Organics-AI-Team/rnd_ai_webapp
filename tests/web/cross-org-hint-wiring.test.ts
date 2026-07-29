/**
 * Plan 3 — static wiring for the cross-org NOT_FOUND hint (pattern:
 * tests/web/formulate-ui-wiring.test.ts).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Read a workspace file as UTF-8 source. */
function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("cross-org NOT_FOUND hint", () => {
  it("watches the query cache for NOT_FOUND and gates on multi-membership", () => {
    const hint = source("apps/web/components/cross_org_not_found_hint.tsx");
    expect(hint).toContain("getQueryCache().subscribe");
    expect(hint).toContain('"NOT_FOUND"');
    expect(hint).toContain("useOrganizationList");
    expect(hint).toContain("Not found in this organization");
  });

  it("is mounted in the authenticated layout, gated on Clerk mode", () => {
    const layout = source("apps/web/components/conditional-layout.tsx");
    expect(layout).toContain("<CrossOrgNotFoundHint />");
    expect(layout).toContain("clerk_enabled");
  });
});
