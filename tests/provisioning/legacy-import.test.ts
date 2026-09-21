import { describe, expect, it } from "vitest";

import {
  import_legacy_account,
  resolve_legacy_organization,
  run_legacy_import,
  type LegacyImportPorts,
} from "../../apps/ai/server/services/provisioning/legacy-import";

interface FakeAccount {
  _id: string;
  email: string;
  passwordHash: string;
  isActive: boolean;
}

/**
 * Build an in-memory legacy-import world with optional Clerk failures.
 */
function fake_world(options: { duplicate_emails?: string[] } = {}) {
  const accounts: FakeAccount[] = [];
  const users = new Map<string, { name: string; organizationId: string }>();
  const organizations = new Map<string, { name: string }>();
  const tenants_by_legacy_org = new Map<string, string>();
  const clerk_users = new Map<string, { id: string; external_id: string }>();
  const create_user_calls: Array<{
    email: string;
    passwordHasher: string;
    externalId: string;
  }> = [];
  const linked: Array<{ clerk_user_id: string; legacy_account_id: string }> = [];
  const profiles_by_legacy = new Map<string, { clerk_user_id: string }>();

  const ports: LegacyImportPorts = {
    legacy: {
      async list_accounts() {
        return accounts as any;
      },
      async find_user_by_account_id(account_id) {
        return (users.get(account_id) as any) ?? null;
      },
    },
    clerk: {
      async find_user_by_external_id(external_id) {
        return clerk_users.get(external_id) ?? null;
      },
      async create_user(input) {
        if (options.duplicate_emails?.includes(input.email)) {
          throw Object.assign(new Error("email address is taken"), {
            code: "form_identifier_exists",
          });
        }
        create_user_calls.push({
          email: input.email,
          passwordHasher: input.password_hasher,
          externalId: input.external_id,
        });
        const clerk_user = {
          id: `clerk_${input.external_id}`,
          external_id: input.external_id,
        };
        clerk_users.set(input.external_id, clerk_user);
        return { id: clerk_user.id };
      },
    },
    profiles: {
      async find_by_legacy_account_id(legacy_account_id) {
        return profiles_by_legacy.get(legacy_account_id) ?? null;
      },
      async link_legacy_identity(link) {
        profiles_by_legacy.set(link.legacy_account_id, {
          clerk_user_id: link.clerk_user_id,
        });
        linked.push(link);
      },
    },
    tenants: {
      async find_tenant_by_legacy_organization_id(legacy_organization_id) {
        const tenant_id = tenants_by_legacy_org.get(legacy_organization_id);
        return tenant_id ? { tenant_id } : null;
      },
    },
  };

  return {
    ports,
    accounts,
    users,
    organizations,
    tenants_by_legacy_org,
    clerk_users,
    create_user_calls,
    linked,
    profiles_by_legacy,
  };
}

const account_fixture: FakeAccount = {
  _id: "acc0000000000000000000001",
  email: "manager@chula.ac.th",
  passwordHash: "$2b$10$abcdefghijklmnopqrstuvILWjBB0mZ3TrbBKA1PYzSTLZFLyxYm2",
  isActive: true,
};

describe("import_legacy_account", () => {
  it("imports an existing bcrypt digest and is replay safe", async () => {
    const world = fake_world();
    world.users.set(account_fixture._id, { name: "Manager", organizationId: "org1" });
    const first = await import_legacy_account(account_fixture as any, world.ports);
    const second = await import_legacy_account(account_fixture as any, world.ports);
    expect(first.clerk_user_id).toBe(second.clerk_user_id);
    expect(world.create_user_calls[0]?.passwordHasher).toBe("bcrypt");
    expect(world.create_user_calls).toHaveLength(1);
    expect(world.create_user_calls[0]?.externalId).toBe(account_fixture._id);
  });

  it("links a partially created Clerk user without creating a second one", async () => {
    const world = fake_world();
    world.users.set(account_fixture._id, { name: "Manager", organizationId: "org1" });
    world.clerk_users.set(account_fixture._id, {
      id: "clerk_partial",
      external_id: account_fixture._id,
    });
    const result = await import_legacy_account(account_fixture as any, world.ports);
    expect(result.status).toBe("linked_existing");
    expect(result.clerk_user_id).toBe("clerk_partial");
    expect(world.create_user_calls).toHaveLength(0);
    expect(world.linked).toHaveLength(1);
  });

  it("reports a duplicate email without linking", async () => {
    const world = fake_world({ duplicate_emails: [account_fixture.email] });
    world.users.set(account_fixture._id, { name: "Manager", organizationId: "org1" });
    const result = await import_legacy_account(account_fixture as any, world.ports);
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("duplicate_email");
    expect(world.linked).toHaveLength(0);
  });

  it("skips an invalid digest without calling Clerk", async () => {
    const world = fake_world();
    world.users.set(account_fixture._id, { name: "M", organizationId: "org1" });
    const result = await import_legacy_account(
      { ...account_fixture, passwordHash: "plaintext-oops" } as any,
      world.ports,
    );
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("invalid_digest");
    expect(world.create_user_calls).toHaveLength(0);
  });

  it("skips an account without a user profile", async () => {
    const world = fake_world();
    const result = await import_legacy_account(account_fixture as any, world.ports);
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("missing_user");
  });

  it("never includes the password digest in its result", async () => {
    const world = fake_world();
    world.users.set(account_fixture._id, { name: "M", organizationId: "org1" });
    const result = await import_legacy_account(account_fixture as any, world.ports);
    expect(JSON.stringify(result)).not.toContain(account_fixture.passwordHash);
  });
});

describe("resolve_legacy_organization", () => {
  it("matches a tenant by legacy organization id", async () => {
    const world = fake_world();
    world.tenants_by_legacy_org.set("legacyorg1", "tenant_1");
    const resolution = await resolve_legacy_organization("legacyorg1", world.ports);
    expect(resolution).toMatchObject({ matched_tenant_id: "tenant_1" });
  });

  it("reports unresolved organizations instead of creating universities", async () => {
    const world = fake_world();
    const resolution = await resolve_legacy_organization("legacyorg2", world.ports);
    expect(resolution).toMatchObject({
      matched_tenant_id: null,
      unresolved_reason: "no_tenant_mapping",
    });
  });
});

describe("run_legacy_import", () => {
  it("dry-run reports without writing; apply writes", async () => {
    const world = fake_world();
    world.accounts.push(account_fixture);
    world.users.set(account_fixture._id, { name: "M", organizationId: "org1" });

    const dry = await run_legacy_import(world.ports, { apply: false });
    expect(dry.counts.would_import).toBe(1);
    expect(world.create_user_calls).toHaveLength(0);

    const applied = await run_legacy_import(world.ports, { apply: true });
    expect(applied.counts.imported).toBe(1);
    expect(world.create_user_calls).toHaveLength(1);
    expect(JSON.stringify(applied)).not.toContain(account_fixture.passwordHash);
  });
});
