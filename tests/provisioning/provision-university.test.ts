import { describe, expect, it } from "vitest";

import {
  provision_university,
  ClerkStateUnprovableError,
} from "../../apps/ai/server/services/provisioning/provision-university";
import type {
  CreateUniversityInput,
  ProvisioningPorts,
  TenantProvisioningRecord,
} from "../../apps/ai/server/services/provisioning/provisioning-types";
import { AuthorizationError } from "../../apps/ai/server/auth/errors";
import type { RequestPrincipal } from "../../packages/shared-types/src/auth";

const admin: RequestPrincipal = {
  auth_provider: "clerk",
  provider_user_id: "user_admin",
  internal_user_id: "507f1f77bcf86cd799439001",
  active_tenant_id: null,
  platform_role: "admin",
  tenant_role: null,
  permissions: ["platform:tenants:create", "platform:tenants:read"],
  membership_status: null,
};

const student: RequestPrincipal = {
  ...admin,
  platform_role: null,
  permissions: ["ai:run"],
};

const input: CreateUniversityInput = {
  name: "Chulalongkorn University",
  slug: "chula",
  region: "sgp",
  plan_key: "standard",
  initial_manager_email: "manager@chula.ac.th",
  idempotency_key: "5f6b2c9e-3a41-4b7e-9c11-8a2f0d4e5a61",
};

interface FailPoints {
  fail_in?:
    | "ensure_organization"
    | "attach_clerk_organization"
    | "ensure_manager_invitation"
    | "upsert_invitation";
  unprovable_in?: "ensure_organization";
}

/**
 * Build an in-memory provisioning world with optional injected failures.
 * State persists across calls so replay semantics can be asserted.
 */
function fake_world() {
  const tenants = new Map<string, TenantProvisioningRecord>();
  const created_organizations: Array<{ id: string; slug: string }> = [];
  const created_invitations: Array<{ id: string; email: string; role: string }> = [];
  const invitation_projections: unknown[] = [];
  const audit_events: unknown[] = [];
  const repair_marks: Array<{ tenant_id: string; correlation_id: string }> = [];
  let tenant_seq = 0;

  const build_ports = (fail: FailPoints = {}): ProvisioningPorts => ({
    tenants: {
      async begin_or_load(create_input, created_by_profile_id) {
        const existing = [...tenants.values()].find(
          (t) => t.provisioning_key === create_input.idempotency_key,
        );
        if (existing) return existing;
        const slug_taken = [...tenants.values()].some(
          (t) => t.slug === create_input.slug,
        );
        if (slug_taken) {
          const duplicate = Object.assign(new Error("duplicate slug"), {
            code: 11000,
          });
          throw duplicate;
        }
        tenant_seq += 1;
        const record: TenantProvisioningRecord = {
          id: `tenant_${tenant_seq}`,
          slug: create_input.slug,
          name: create_input.name,
          status: "provisioning",
          provisioning_key: create_input.idempotency_key,
          clerk_organization_id: null,
          created_by_profile_id,
        };
        tenants.set(record.id, record);
        return record;
      },
      async attach_clerk_organization(tenant_id, clerk_organization_id) {
        if (fail.fail_in === "attach_clerk_organization") {
          throw new Error("INJECTED_FAILURE");
        }
        const record = tenants.get(tenant_id);
        if (record && !record.clerk_organization_id) {
          record.clerk_organization_id = clerk_organization_id;
        }
      },
      async activate(tenant_id) {
        const record = tenants.get(tenant_id)!;
        record.status = "active";
        return {
          tenant_id,
          status: "active" as const,
          clerk_organization_id: record.clerk_organization_id!,
        };
      },
      async mark_repair_required(tenant_id, correlation_id) {
        const record = tenants.get(tenant_id);
        if (record) record.status = "repair_required";
        repair_marks.push({ tenant_id, correlation_id });
      },
    },
    clerk: {
      async ensure_organization(tenant) {
        if (fail.unprovable_in === "ensure_organization") {
          throw new ClerkStateUnprovableError("cannot verify organization state");
        }
        if (tenant.clerk_organization_id) {
          return { id: tenant.clerk_organization_id };
        }
        const existing = created_organizations.find((o) => o.slug === tenant.slug);
        if (existing) return { id: existing.id };
        if (fail.fail_in === "ensure_organization") {
          throw new Error("INJECTED_FAILURE");
        }
        const organization = {
          id: `org_${created_organizations.length + 1}`,
          slug: tenant.slug,
        };
        created_organizations.push(organization);
        return { id: organization.id };
      },
      async ensure_manager_invitation(clerk_organization_id, create_input) {
        const existing = created_invitations.find(
          (i) => i.email === create_input.initial_manager_email,
        );
        if (existing) return existing;
        if (fail.fail_in === "ensure_manager_invitation") {
          throw new Error("INJECTED_FAILURE");
        }
        const invitation = {
          id: `inv_${created_invitations.length + 1}`,
          email: create_input.initial_manager_email,
          role: "org:manager",
        };
        created_invitations.push(invitation);
        return invitation;
      },
    },
    invitations: {
      async upsert(tenant_id, invitation) {
        if (fail.fail_in === "upsert_invitation") {
          throw new Error("INJECTED_FAILURE");
        }
        if (
          !invitation_projections.some(
            (p: any) => p.clerk_invitation_id === invitation.id,
          )
        ) {
          invitation_projections.push({
            tenant_id,
            clerk_invitation_id: invitation.id,
          });
        }
      },
    },
    audit: {
      async record(event) {
        audit_events.push(event);
      },
    },
  });

  return {
    build_ports,
    tenants,
    created_organizations,
    created_invitations,
    invitation_projections,
    audit_events,
    repair_marks,
  };
}

describe("provision_university", () => {
  it("provisions one organization, tenant, and manager invitation", async () => {
    const world = fake_world();
    const result = await provision_university(admin, input, world.build_ports());
    expect(result.status).toBe("active");
    expect(world.created_organizations).toHaveLength(1);
    expect(world.created_invitations).toHaveLength(1);
    expect(world.invitation_projections).toHaveLength(1);
    expect(world.audit_events).toHaveLength(1);
  });

  it("rejects a non-platform caller before any side effect", async () => {
    const world = fake_world();
    await expect(
      provision_university(student, input, world.build_ports()),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(world.tenants.size).toBe(0);
    expect(world.created_organizations).toHaveLength(0);
  });

  it("rejects a duplicate slug under a different idempotency key", async () => {
    const world = fake_world();
    await provision_university(admin, input, world.build_ports());
    await expect(
      provision_university(
        admin,
        { ...input, idempotency_key: "0f6b2c9e-3a41-4b7e-9c11-8a2f0d4e5a62" },
        world.build_ports(),
      ),
    ).rejects.toThrow(/slug/i);
  });

  it.each([
    "ensure_organization",
    "attach_clerk_organization",
    "ensure_manager_invitation",
    "upsert_invitation",
  ] as const)("replays provisioning after a failure in %s", async (fail_in) => {
    const world = fake_world();
    await expect(
      provision_university(admin, input, world.build_ports({ fail_in })),
    ).rejects.toThrow("INJECTED_FAILURE");
    const result = await provision_university(admin, input, world.build_ports());
    expect(result.status).toBe("active");
    expect(world.created_organizations).toHaveLength(1);
    expect(world.created_invitations).toHaveLength(1);
  });

  it("replays provisioning without duplicate Clerk objects", async () => {
    const world = fake_world();
    await expect(
      provision_university(
        admin,
        input,
        world.build_ports({ fail_in: "upsert_invitation" }),
      ),
    ).rejects.toThrow("INJECTED_FAILURE");
    const result = await provision_university(admin, input, world.build_ports());
    expect(result.status).toBe("active");
    expect(world.created_organizations).toHaveLength(1);
    expect(world.created_invitations).toHaveLength(1);
  });

  it("marks repair_required with a correlation ID when external state is unprovable", async () => {
    const world = fake_world();
    await expect(
      provision_university(
        admin,
        input,
        world.build_ports({ unprovable_in: "ensure_organization" }),
      ),
    ).rejects.toThrow(/repair/i);
    expect(world.repair_marks).toHaveLength(1);
    expect(world.repair_marks[0]?.correlation_id).toBeTruthy();
    const record = [...world.tenants.values()][0];
    expect(record?.status).toBe("repair_required");
  });

  it("validates and normalizes input", async () => {
    const world = fake_world();
    const result = await provision_university(
      admin,
      { ...input, slug: "ChULa " as any },
      world.build_ports(),
    );
    expect(result.status).toBe("active");
    const record = [...world.tenants.values()][0];
    expect(record?.slug).toBe("chula");
    await expect(
      provision_university(
        admin,
        { ...input, region: "mars" as any, idempotency_key: "1f6b2c9e-3a41-4b7e-9c11-8a2f0d4e5a63" },
        world.build_ports(),
      ),
    ).rejects.toThrow(/region/i);
  });
});
