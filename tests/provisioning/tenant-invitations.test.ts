// tests/provisioning/tenant-invitations.test.ts
import { describe, expect, it } from "vitest";

import {
  invite_tenant_user,
  type TenantMemberPorts,
} from "../../apps/ai/server/services/provisioning/invite-tenant-user";
import { AuthorizationError } from "../../apps/ai/server/auth/errors";
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

const student: RequestPrincipal = {
  ...manager,
  tenant_role: "user",
  permissions: TENANT_ROLE_PERMISSIONS.user,
};

/**
 * Build in-memory member-management ports. Plan 3 removed the cross-tenant
 * email lookups from this contract — compiling this fake without them is
 * itself the guard-lift regression assertion.
 */
function fake_ports() {
  const clerk_invitations: Array<{ email: string; role: string; org: string }> = [];
  const projections: any[] = [];
  const audit_events: any[] = [];

  const ports: TenantMemberPorts = {
    invitations: {
      async upsert(tenant_id, invitation, invited_by_profile_id) {
        projections.push({ tenant_id, invitation, invited_by_profile_id });
      },
    },
    clerk: {
      async create_user_invitation(clerk_organization_id, email) {
        const invitation = {
          id: `inv_${clerk_invitations.length + 1}`,
          email,
          role: "org:member",
        };
        clerk_invitations.push({ email, role: "org:member", org: clerk_organization_id });
        return invitation;
      },
    },
    tenants: {
      async clerk_organization_id_for(tenant_id) {
        return `org_for_${tenant_id}`;
      },
    },
    audit: {
      async record(event) {
        audit_events.push(event);
      },
    },
  };

  return { ports, clerk_invitations, projections, audit_events };
}

describe("invite_tenant_user (multi-org permitted)", () => {
  it("lets a manager invite a tenant user with the user role only", async () => {
    const world = fake_ports();
    const result = await invite_tenant_user(
      manager,
      { email: "Student@Chula.ac.th" },
      world.ports,
    );
    expect(result.invitation_id).toBe("inv_1");
    expect(world.clerk_invitations[0]).toMatchObject({
      email: "student@chula.ac.th",
      role: "org:member",
    });
    expect(world.projections).toHaveLength(1);
    expect(world.audit_events).toHaveLength(1);
  });

  it("rejects a tenant user caller", async () => {
    const world = fake_ports();
    await expect(
      invite_tenant_user(student, { email: "x@chula.ac.th" }, world.ports),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(world.clerk_invitations).toHaveLength(0);
  });

  it("invites an email that already belongs to another university (guard lifted)", async () => {
    const world = fake_ports();
    await expect(
      invite_tenant_user(manager, { email: "second-org@x.ac.th" }, world.ports),
    ).resolves.toMatchObject({ invitation_id: "inv_1" });
    expect(world.clerk_invitations).toHaveLength(1);
  });
});
