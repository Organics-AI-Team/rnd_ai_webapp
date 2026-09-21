// tests/web/member-management-ui-wiring.test.ts
/**
 * Plan 3 — static wiring for the members page tabs (pattern:
 * tests/web/formulate-ui-wiring.test.ts). Pins every action to the
 * tenantMembers router procedures.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Read a workspace file as UTF-8 source. */
function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("members page wiring", () => {
  const page = () => source("apps/web/app/settings/members/page.tsx");

  it("drives every member/invitation action through the tenantMembers router", () => {
    const content = page();
    expect(content).toContain("trpc.tenantMembers.list.useQuery");
    expect(content).toContain("trpc.tenantMembers.listInvitations.useQuery");
    expect(content).toContain("trpc.tenantMembers.inviteUser.useMutation");
    expect(content).toContain("trpc.tenantMembers.suspendUser.useMutation");
    expect(content).toContain("trpc.tenantMembers.reactivateUser.useMutation");
    expect(content).toContain("trpc.tenantMembers.removeUser.useMutation");
    expect(content).toContain("trpc.tenantMembers.revokeInvitation.useMutation");
    expect(content).toContain("trpc.tenantMembers.resendInvitation.useMutation");
  });

  it("renders the expired display state and confirms destructive removal", () => {
    const content = page();
    expect(content).toContain("isExpired");
    expect(content).toContain("window.confirm");
  });

  it("offers row actions on user-role members only (manager lifecycle is platform-scope)", () => {
    expect(page()).toContain('member.tenantRole === "user"');
  });
});
