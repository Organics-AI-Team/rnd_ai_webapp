/**
 * Legacy identity import into Clerk (G1.6).
 *
 * Imports legacy bcrypt accounts as Clerk users (passwordHasher="bcrypt",
 * externalId = legacy Account ObjectId) so valid users sign in without a
 * forced password reset. Replay safe at every step; never creates a
 * university from a legacy organization; never emits a password digest in
 * results or reports.
 */

/** Legacy account view consumed by the importer. */
export interface LegacyAccountView {
  readonly _id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly isActive: boolean;
}

/** Result of importing one account. Never carries the digest. */
export interface ImportAccountResult {
  readonly legacy_account_id: string;
  readonly status: "imported" | "linked_existing" | "replayed" | "skipped" | "failed";
  readonly reason?:
    | "invalid_digest"
    | "missing_user"
    | "inactive_account"
    | "duplicate_email";
  readonly clerk_user_id?: string;
}

/** Legacy organization resolution entry. */
export interface LegacyOrgResolution {
  readonly legacy_organization_id: string;
  readonly matched_tenant_id: string | null;
  readonly unresolved_reason?: "no_tenant_mapping";
}

/** Import report. Counts and stable IDs only. */
export interface LegacyImportReport {
  readonly apply: boolean;
  readonly counts: {
    total_accounts: number;
    would_import: number;
    imported: number;
    replayed: number;
    linked_existing: number;
    skipped: number;
    failed: number;
  };
  readonly results: ImportAccountResult[];
  readonly legacy_org_resolution: LegacyOrgResolution[];
}

/** Injected ports; MongoDB/@clerk/backend in production, fakes in tests. */
export interface LegacyImportPorts {
  readonly legacy: {
    list_accounts(): Promise<LegacyAccountView[]>;
    find_user_by_account_id(
      account_id: string,
    ): Promise<{ name: string; organizationId: string } | null>;
  };
  readonly clerk: {
    find_user_by_external_id(external_id: string): Promise<{ id: string } | null>;
    create_user(input: {
      email: string;
      password_digest: string;
      password_hasher: "bcrypt";
      external_id: string;
      display_name: string;
    }): Promise<{ id: string }>;
  };
  readonly profiles: {
    find_by_legacy_account_id(
      legacy_account_id: string,
    ): Promise<{ clerk_user_id: string } | null>;
    link_legacy_identity(link: {
      clerk_user_id: string;
      legacy_account_id: string;
      email: string;
      display_name: string;
    }): Promise<void>;
  };
  readonly tenants: {
    find_tenant_by_legacy_organization_id(
      legacy_organization_id: string,
    ): Promise<{ tenant_id: string } | null>;
  };
}

const BCRYPT_DIGEST_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

/**
 * Import one legacy account into Clerk, replay safe:
 * an already-linked profile short-circuits; an existing Clerk user with the
 * same externalId is linked without a second createUser call.
 *
 * @param account - Legacy account (digest is consumed, never re-emitted).
 * @param ports - Import ports.
 * @returns Digest-free import result.
 */
export async function import_legacy_account(
  account: LegacyAccountView,
  ports: LegacyImportPorts,
): Promise<ImportAccountResult> {
  const legacy_account_id = String(account._id);

  const existing_profile =
    await ports.profiles.find_by_legacy_account_id(legacy_account_id);
  if (existing_profile) {
    return {
      legacy_account_id,
      status: "replayed",
      clerk_user_id: existing_profile.clerk_user_id,
    };
  }

  const legacy_user = await ports.legacy.find_user_by_account_id(legacy_account_id);
  if (!legacy_user) {
    return { legacy_account_id, status: "skipped", reason: "missing_user" };
  }
  if (!account.isActive) {
    return { legacy_account_id, status: "skipped", reason: "inactive_account" };
  }
  if (!BCRYPT_DIGEST_PATTERN.test(account.passwordHash)) {
    return { legacy_account_id, status: "skipped", reason: "invalid_digest" };
  }

  const partially_created =
    await ports.clerk.find_user_by_external_id(legacy_account_id);
  if (partially_created) {
    await ports.profiles.link_legacy_identity({
      clerk_user_id: partially_created.id,
      legacy_account_id,
      email: account.email.toLowerCase(),
      display_name: legacy_user.name,
    });
    return {
      legacy_account_id,
      status: "linked_existing",
      clerk_user_id: partially_created.id,
    };
  }

  let clerk_user: { id: string };
  try {
    clerk_user = await ports.clerk.create_user({
      email: account.email.toLowerCase(),
      password_digest: account.passwordHash,
      password_hasher: "bcrypt",
      external_id: legacy_account_id,
      display_name: legacy_user.name,
    });
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    const message = error instanceof Error ? error.message : "";
    if (code === "form_identifier_exists" || /taken|exists/i.test(message)) {
      return { legacy_account_id, status: "failed", reason: "duplicate_email" };
    }
    throw error;
  }

  await ports.profiles.link_legacy_identity({
    clerk_user_id: clerk_user.id,
    legacy_account_id,
    email: account.email.toLowerCase(),
    display_name: legacy_user.name,
  });
  return { legacy_account_id, status: "imported", clerk_user_id: clerk_user.id };
}

/**
 * Resolve a legacy organization to an existing tenant. Universities are
 * never created automatically here: unresolved mappings await explicit
 * platform-admin approval.
 *
 * @param legacy_organization_id - Legacy organization ObjectId string.
 * @param ports - Import ports.
 * @returns Resolution entry for the migration report.
 */
export async function resolve_legacy_organization(
  legacy_organization_id: string,
  ports: LegacyImportPorts,
): Promise<LegacyOrgResolution> {
  const match = await ports.tenants.find_tenant_by_legacy_organization_id(
    legacy_organization_id,
  );
  if (match) {
    return { legacy_organization_id, matched_tenant_id: match.tenant_id };
  }
  return {
    legacy_organization_id,
    matched_tenant_id: null,
    unresolved_reason: "no_tenant_mapping",
  };
}

/**
 * Run the full import. Dry-run (apply=false) is the default posture: it
 * counts what would happen without any Clerk or profile write.
 *
 * @param ports - Import ports.
 * @param options - apply=true performs writes.
 * @returns Digest-free migration report.
 */
export async function run_legacy_import(
  ports: LegacyImportPorts,
  options: { apply: boolean },
): Promise<LegacyImportReport> {
  const accounts = await ports.legacy.list_accounts();
  const results: ImportAccountResult[] = [];
  const org_ids = new Set<string>();
  const counts = {
    total_accounts: accounts.length,
    would_import: 0,
    imported: 0,
    replayed: 0,
    linked_existing: 0,
    skipped: 0,
    failed: 0,
  };

  for (const account of accounts) {
    const legacy_account_id = String(account._id);
    const legacy_user = await ports.legacy.find_user_by_account_id(legacy_account_id);
    if (legacy_user?.organizationId) org_ids.add(String(legacy_user.organizationId));

    if (!options.apply) {
      const already =
        await ports.profiles.find_by_legacy_account_id(legacy_account_id);
      if (
        !already &&
        legacy_user &&
        account.isActive &&
        BCRYPT_DIGEST_PATTERN.test(account.passwordHash)
      ) {
        counts.would_import += 1;
      }
      continue;
    }

    const result = await import_legacy_account(account, ports);
    results.push(result);
    if (result.status === "imported") counts.imported += 1;
    else if (result.status === "replayed") counts.replayed += 1;
    else if (result.status === "linked_existing") counts.linked_existing += 1;
    else if (result.status === "skipped") counts.skipped += 1;
    else counts.failed += 1;
  }

  const legacy_org_resolution: LegacyOrgResolution[] = [];
  for (const org_id of org_ids) {
    legacy_org_resolution.push(await resolve_legacy_organization(org_id, ports));
  }

  return { apply: options.apply, counts, results, legacy_org_resolution };
}
