import { describe, expect, it } from "vitest";

import {
  invite_tenant_user,
  suspend_tenant_user,
  MultipleMembershipsDisabledError,
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
 * Build in-memory member-management ports.
 *
 * @param seed - Existing memberships/invitations by normalized email.
 */
function fake_ports(seed: {
  memberships_by_email?: Record<string, Array<{ tenant_id: string; status: string }>>;
  invitations_by_email?: Record<string, Array<{ tenant_id: string; status: string }>>;
} = {}) {
  const clerk_invitations: Array<{ email: string; role: string; org: string }> = [];
  const projections: any[] = [];
  const suspensions: Array<{ tenant_id: string; profile_id: string }> = [];
  const audit_events: any[] = [];

  const ports: TenantMemberPorts = {
    memberships: {
      async find_memberships_by_email(email) {
        return (seed.memberships_by_email?.[email] ?? []) as any;
      },
      async suspend_membership(tenant_id, user_profile_id) {
        suspensions.push({ tenant_id, profile_id: user_profile_id });
      },
    },
    invitations: {
      async find_invitations_by_email(email) {
        return (seed.invitations_by_email?.[email] ?? []) as any;
      },
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

  return { ports, clerk_invitations, projections, suspensions, audit_events };
}

describe("invite_tenant_user", () => {
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

  it("rejects a second active membership with MULTIPLE_MEMBERSHIPS_DISABLED", async () => {
    const world = fake_ports({
      memberships_by_email: {
        "taken@x.ac.th": [{ tenant_id: "tenant_other", status: "active" }],
      },
    });
    await expect(
      invite_tenant_user(manager, { email: "taken@x.ac.th" }, world.ports),
    ).rejects.toBeInstanceOf(MultipleMembershipsDisabledError);
    expect(world.clerk_invitations).toHaveLength(0);
  });

  it("rejects a pending invitation at another university", async () => {
    const world = fake_ports({
      invitations_by_email: {
        "pending@x.ac.th": [{ tenant_id: "tenant_other", status: "invited" }],
      },
    });
    await expect(
      invite_tenant_user(manager, { email: "pending@x.ac.th" }, world.ports),
    ).rejects.toBeInstanceOf(MultipleMembershipsDisabledError);
  });

  it("allows re-inviting into the same tenant idempotently", async () => {
    const world = fake_ports({
      invitations_by_email: {
        "same@x.ac.th": [
          { tenant_id: "507f1f77bcf86cd799439031", status: "invited" },
        ],
      },
    });
    const result = await invite_tenant_user(
      manager,
      { email: "same@x.ac.th" },
      world.ports,
    );
    expect(result.invitation_id).toBeTruthy();
  });
});

describe("suspend_tenant_user", () => {
  it("lets a manager suspend a tenant user", async () => {
    const world = fake_ports();
    await suspend_tenant_user(
      manager,
      { user_profile_id: "507f1f77bcf86cd799439099" },
      world.ports,
    );
    expect(world.suspensions).toHaveLength(1);
    expect(world.audit_events.some((e) => e.action === "suspend_tenant_user")).toBe(
      true,
    );
  });

  it("rejects a tenant user caller", async () => {
    const world = fake_ports();
    await expect(
      suspend_tenant_user(
        student,
        { user_profile_id: "507f1f77bcf86cd799439099" },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
