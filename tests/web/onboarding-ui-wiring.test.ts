/**
 * Plan 3 — static wiring for the onboarding states, the generalized
 * organization activator, and its authenticated-layout mount (pattern:
 * tests/web/formulate-ui-wiring.test.ts).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Read a workspace file as UTF-8 source. */
function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("onboarding states", () => {
  it("classifies through the pure state machine and renders the new states", () => {
    const page = source("apps/web/app/onboarding/page.tsx");
    expect(page).toContain("classify_onboarding_state");
    expect(page).toContain("access_suspended");
    expect(page).toContain("membership_removed");
    expect(page).toContain("choose_organization");
  });
});

describe("organization activator", () => {
  it("auto-activates only a sole membership and renders a picker otherwise", () => {
    const activator = source("apps/web/components/organization_activator.tsx");
    expect(activator).toContain("memberships.length !== 1");
    expect(activator).toContain("Select an organization to continue");
    expect(activator).toContain("setActive");
  });

  it("is mounted in the authenticated layout, gated on Clerk mode", () => {
    const layout = source("apps/web/components/conditional-layout.tsx");
    expect(layout).toContain("clerk_enabled");
    expect(layout).toContain("<OrganizationActivator />");
  });
});
