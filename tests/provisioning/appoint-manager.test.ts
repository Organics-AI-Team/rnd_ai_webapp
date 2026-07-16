import { describe, expect, it } from "vitest";

import {
  appoint_manager,
  AlreadyTenantMemberError,
  type AppointManagerPorts,
} from "../../apps/ai/server/services/provisioning/appoint-manager";
import { MultipleMembershipsDisabledError } from "../../apps/ai/server/services/provisioning/invite-tenant-user";
import { AuthorizationError } from "../../apps/ai/server/auth/errors";
import { TENANT_ROLE_PERMISSIONS } from "../../packages/shared-types/src/auth";
import type { RequestPrincipal } from "../../packages/shared-types/src/auth";

const TENANT = "507f1f77bcf86cd799439031";
const OTHER_TENANT = "507f1f77bcf86cd799439099";

const platform_admin: RequestPrincipal = {
  auth_provider: "clerk",
  provider_user_id: "user_platform",
  internal_user_id: "507f1f77bcf86cd799439001",
  active_tenant_id: null,
  platform_role: "admin",
  tenant_role: null,
  permissions: [],
  membership_status: null,
};

const tenant_manager: RequestPrincipal = {
  auth_provider: "clerk",
  provider_user_id: "user_mgr",
  internal_user_id: "507f1f77bcf86cd799439002",
  active_tenant_id: TENANT,
  platform_role: null,
  tenant_role: "manager",
  permissions: TENANT_ROLE_PERMISSIONS.manager,
  membership_status: "active",
};

/**
 * Build in-memory appointment ports.
 *
 * @param seed - Existing memberships/invitations by normalized email and
 *               optional Clerk organization / pending invitation overrides.
 */
function fake_ports(seed: {
  memberships_by_email?: Record<string, Array<{ tenant_id: string; status: string }>>;
  invitations_by_email?: Record<string, Array<{ tenant_id: string; status: string }>>;
  clerk_organization_id?: string | null;
  pending_invitation?: { id: string; email: string; role: string };
} = {}) {
  const clerk_invitations: Array<{ email: string; role: string; org: string }> = [];
  const projections: any[] = [];
  const audit_events: any[] = [];

  const ports: AppointManagerPorts = {
    memberships: {
      async find_memberships_by_email(email) {
        return (seed.memberships_by_email?.[email] ?? []) as any;
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
      async create_manager_invitation(clerk_organization_id, email) {
        if (seed.pending_invitation && seed.pending_invitation.email === email) {
          return seed.pending_invitation;
        }
        const invitation = {
          id: `inv_${clerk_invitations.length + 1}`,
          email,
          role: "org:manager",
        };
        clerk_invitations.push({ email, role: "org:manager", org: clerk_organization_id });
        return invitation;
      },
    },
    tenants: {
      async clerk_organization_id_for(tenant_id) {
        if (seed.clerk_organization_id === null) return null;
        return seed.clerk_organization_id ?? `org_for_${tenant_id}`;
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

describe("appoint_manager", () => {
  it("lets a platform admin appoint a manager with the manager role", async () => {
    const world = fake_ports();
    const result = await appoint_manager(
      platform_admin,
      { tenant_id: TENANT, email: "Dean@Chula.ac.th" },
      world.ports,
    );
    expect(result.invitation_id).toBe("inv_1");
    expect(result.role).toBe("org:manager");
    expect(world.clerk_invitations[0]).toMatchObject({
      email: "dean@chula.ac.th",
      role: "org:manager",
      org: `org_for_${TENANT}`,
    });
    expect(world.projections).toHaveLength(1);
    expect(world.audit_events[0]).toMatchObject({
      action: "appoint_manager",
      tenantId: TENANT,
      emailNormalized: "dean@chula.ac.th",
    });
  });

  it("replays onto the existing pending invitation without minting another", async () => {
    const world = fake_ports({
      pending_invitation: { id: "inv_existing", email: "dean@chula.ac.th", role: "org:manager" },
    });
    const result = await appoint_manager(
      platform_admin,
      { tenant_id: TENANT, email: "dean@chula.ac.th" },
      world.ports,
    );
    expect(result.invitation_id).toBe("inv_existing");
    expect(world.clerk_invitations).toHaveLength(0);
  });

  it("rejects a caller without a platform role before any lookup", async () => {
    const world = fake_ports();
    await expect(
      appoint_manager(
        tenant_manager,
        { tenant_id: TENANT, email: "dean@chula.ac.th" },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(world.clerk_invitations).toHaveLength(0);
    expect(world.projections).toHaveLength(0);
  });

  it("rejects an email that belongs to another university", async () => {
    const world = fake_ports({
      memberships_by_email: {
        "dean@chula.ac.th": [{ tenant_id: OTHER_TENANT, status: "active" }],
      },
    });
    await expect(
      appoint_manager(
        platform_admin,
        { tenant_id: TENANT, email: "dean@chula.ac.th" },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(MultipleMembershipsDisabledError);
    expect(world.clerk_invitations).toHaveLength(0);
  });

  it("rejects an email that is already an active member of this university", async () => {
    const world = fake_ports({
      memberships_by_email: {
        "dean@chula.ac.th": [{ tenant_id: TENANT, status: "active" }],
      },
    });
    await expect(
      appoint_manager(
        platform_admin,
        { tenant_id: TENANT, email: "dean@chula.ac.th" },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(AlreadyTenantMemberError);
    expect(world.clerk_invitations).toHaveLength(0);
  });

  it("fails when the tenant has no Clerk organization", async () => {
    const world = fake_ports({ clerk_organization_id: null });
    await expect(
      appoint_manager(
        platform_admin,
        { tenant_id: TENANT, email: "dean@chula.ac.th" },
        world.ports,
      ),
    ).rejects.toThrow(/no Clerk organization/);
    expect(world.projections).toHaveLength(0);
  });
});
