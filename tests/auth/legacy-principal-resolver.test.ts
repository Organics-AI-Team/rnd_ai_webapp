import { describe, expect, it } from "vitest";

import {
  resolve_legacy_principal,
  type LegacyAccountRecord,
  type LegacyIdentityStore,
  type LegacyOrganizationRecord,
  type LegacySessionRecord,
  type LegacyUserRecord,
} from "../../apps/ai/server/auth/legacy-principal-resolver";
import { AuthorizationError } from "../../apps/ai/server/auth/errors";

const now = new Date("2026-07-15T00:00:00.000Z");
const future = new Date("2026-07-16T00:00:00.000Z");
const past = new Date("2026-07-14T00:00:00.000Z");

/**
 * Build an in-memory LegacyIdentityStore fake seeded with optional records.
 *
 * @param records - Partial record sets keyed by collection name.
 * @returns Store whose lookups resolve only the seeded records.
 */
function fake_store(records: {
  sessions?: LegacySessionRecord[];
  accounts?: LegacyAccountRecord[];
  users?: LegacyUserRecord[];
  organizations?: LegacyOrganizationRecord[];
}): LegacyIdentityStore {
  return {
    find_session_by_token: async (token) =>
      records.sessions?.find((session) => session.token === token) ?? null,
    find_account_by_id: async (account_id) =>
      records.accounts?.find((account) => account.id === account_id) ?? null,
    find_user_by_account_id: async (account_id) =>
      records.users?.find((user) => user.accountId === account_id) ?? null,
    find_organization_by_id: async (organization_id) =>
      records.organizations?.find(
        (organization) => organization.id === organization_id,
      ) ?? null,
  };
}

const valid_session: LegacySessionRecord = {
  id: "session-1",
  accountId: "account-1",
  token: "token-1",
  expiresAt: future,
};

const valid_account: LegacyAccountRecord = {
  id: "account-1",
  email: "manager@example.com",
  isActive: true,
};

const valid_user: LegacyUserRecord = {
  id: "user-1",
  accountId: "account-1",
  organizationId: "org-1",
  role: "admin",
  status: "active",
  isActive: true,
};

const valid_organization: LegacyOrganizationRecord = {
  id: "org-1",
  isActive: true,
};

const complete_store = () =>
  fake_store({
    sessions: [valid_session],
    accounts: [valid_account],
    users: [valid_user],
    organizations: [valid_organization],
  });

/**
 * Resolve with the provided store and capture the thrown AuthorizationError.
 *
 * @param store - Identity store fake for the scenario.
 * @param token - Session token presented by the caller.
 * @returns The thrown AuthorizationError.
 */
async function expect_authorization_error(
  store: LegacyIdentityStore,
  token: string,
): Promise<AuthorizationError> {
  try {
    await resolve_legacy_principal(token, store, now);
  } catch (error) {
    expect(error).toBeInstanceOf(AuthorizationError);
    return error as AuthorizationError;
  }
  throw new Error("expected resolve_legacy_principal to reject");
}

describe("resolve_legacy_principal", () => {
  it("rejects a missing session token", async () => {
    const error = await expect_authorization_error(complete_store(), "");
    expect(error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects an unknown session token", async () => {
    const error = await expect_authorization_error(
      complete_store(),
      "unknown-token",
    );
    expect(error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects an expired session", async () => {
    const store = fake_store({
      sessions: [{ ...valid_session, expiresAt: past }],
      accounts: [valid_account],
      users: [valid_user],
      organizations: [valid_organization],
    });
    const error = await expect_authorization_error(store, "token-1");
    expect(error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects an inactive account", async () => {
    const store = fake_store({
      sessions: [valid_session],
      accounts: [{ ...valid_account, isActive: false }],
      users: [valid_user],
      organizations: [valid_organization],
    });
    const error = await expect_authorization_error(store, "token-1");
    expect(error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a suspended user with a membership error", async () => {
    const store = fake_store({
      sessions: [valid_session],
      accounts: [valid_account],
      users: [{ ...valid_user, status: "suspend" }],
      organizations: [valid_organization],
    });
    const error = await expect_authorization_error(store, "token-1");
    expect(error.code).toBe("MEMBERSHIP_INACTIVE");
  });

  it("rejects a missing organization", async () => {
    const store = fake_store({
      sessions: [valid_session],
      accounts: [valid_account],
      users: [valid_user],
      organizations: [],
    });
    const error = await expect_authorization_error(store, "token-1");
    expect(error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects an inactive organization with a membership error", async () => {
    const store = fake_store({
      sessions: [valid_session],
      accounts: [valid_account],
      users: [valid_user],
      organizations: [{ ...valid_organization, isActive: false }],
    });
    const error = await expect_authorization_error(store, "token-1");
    expect(error.code).toBe("MEMBERSHIP_INACTIVE");
  });

  it("resolves a valid session into a provider-neutral principal", async () => {
    const principal = await resolve_legacy_principal(
      "token-1",
      complete_store(),
      now,
    );
    expect(principal).toMatchObject({
      auth_provider: "legacy",
      provider_user_id: "account-1",
      internal_user_id: "user-1",
      active_tenant_id: "org-1",
      platform_role: null,
      tenant_role: "manager",
      membership_status: "active",
    });
  });

  it("never grants a platform role from a legacy tenant role", async () => {
    const principal = await resolve_legacy_principal(
      "token-1",
      complete_store(),
      now,
    );
    expect(principal.tenant_role).toBe("manager");
    expect(principal.platform_role).toBeNull();
    expect(principal.permissions).not.toContain("platform:tenants:create");
    expect(principal.permissions).not.toContain("platform:roles:grant");
  });
});
