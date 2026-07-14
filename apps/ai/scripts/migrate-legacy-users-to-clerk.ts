/**
 * Legacy → Clerk identity migration CLI (G1.6).
 *
 * Dry-run is the default; writes require BOTH --apply and --report=<path>.
 * The report contains counts and stable record IDs only — never a password
 * digest. Universities are never created from legacy organizations; the
 * report's legacy_org_resolution section lists unresolved mappings for
 * explicit platform-admin approval.
 *
 * Usage:
 *   npm run migrate:clerk -w apps/ai                       # dry run
 *   npm run migrate:clerk -w apps/ai -- --apply --report=./clerk-migration-report.json
 */

import { writeFileSync } from "node:fs";

import {
  run_legacy_import,
  type LegacyImportPorts,
} from "../server/services/provisioning/legacy-import";

/**
 * Build production import ports over MongoDB and @clerk/backend.
 *
 * @returns Ports plus a close handle for the database client.
 */
async function production_ports(): Promise<{
  ports: LegacyImportPorts;
  close: () => Promise<void>;
}> {
  const { createClerkClient } = await import("@clerk/backend");
  const secret = process.env.CLERK_SECRET_KEY?.trim();
  if (!secret) throw new Error("CLERK_SECRET_KEY is not configured.");
  const clerk = createClerkClient({ secretKey: secret });
  const { default: client_promise } = await import("@rnd-ai/shared-database");
  const client = await client_promise;
  const db = client.db();

  const ports: LegacyImportPorts = {
    legacy: {
      async list_accounts() {
        const accounts = await db.collection("accounts").find({}).toArray();
        return accounts.map((account) => ({
          _id: account._id.toString(),
          email: String(account.email ?? ""),
          passwordHash: String(account.passwordHash ?? ""),
          isActive: account.isActive !== false,
        }));
      },
      async find_user_by_account_id(account_id) {
        const user = await db.collection("users").findOne({ accountId: account_id });
        return user
          ? {
              name: String(user.name ?? ""),
              organizationId: String(user.organizationId ?? ""),
            }
          : null;
      },
    },
    clerk: {
      async find_user_by_external_id(external_id) {
        const response = await clerk.users.getUserList({
          externalId: [external_id],
          limit: 1,
        });
        const user = response.data[0];
        return user ? { id: user.id } : null;
      },
      async create_user(input) {
        const created = await clerk.users.createUser({
          emailAddress: [input.email],
          passwordDigest: input.password_digest,
          passwordHasher: "bcrypt",
          externalId: input.external_id,
        });
        return { id: created.id };
      },
    },
    profiles: {
      async find_by_legacy_account_id(legacy_account_id) {
        const profile = await db
          .collection("user_profiles")
          .findOne({ legacyAccountId: legacy_account_id });
        return profile ? { clerk_user_id: String(profile.clerkUserId) } : null;
      },
      async link_legacy_identity(link) {
        const now = new Date();
        await db.collection("user_profiles").updateOne(
          { clerkUserId: link.clerk_user_id },
          {
            $setOnInsert: {
              clerkUserId: link.clerk_user_id,
              platformRole: null,
              status: "active",
              clerkSyncVersion: 0,
              clerkSyncedAt: null,
              createdAt: now,
            },
            $set: {
              legacyAccountId: link.legacy_account_id,
              primaryEmail: link.email,
              displayName: link.display_name,
              updatedAt: now,
            },
          },
          { upsert: true },
        );
      },
    },
    tenants: {
      async find_tenant_by_legacy_organization_id(legacy_organization_id) {
        const tenant = await db
          .collection("tenants")
          .findOne({ legacyOrganizationId: legacy_organization_id });
        return tenant ? { tenant_id: tenant._id.toString() } : null;
      },
    },
  };

  return { ports, close: () => client.close() };
}

/**
 * CLI entry: run the import and write/print the digest-free report.
 */
async function run_cli(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const report_path = process.argv
    .find((argument) => argument.startsWith("--report="))
    ?.slice("--report=".length);

  if (apply && !report_path) {
    throw new Error("--apply requires --report=<path> for the audit trail.");
  }

  const { ports, close } = await production_ports();
  try {
    const report = await run_legacy_import(ports, { apply });
    const summary = {
      apply: report.apply,
      counts: report.counts,
      unresolved_organizations: report.legacy_org_resolution.filter(
        (entry) => entry.matched_tenant_id === null,
      ).length,
    };
    if (report_path) {
      writeFileSync(report_path, JSON.stringify(report, null, 2));
      console.log(`migrate:clerk — report written to ${report_path}`);
    }
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await close();
  }
}

const invoked_directly =
  process.argv[1]?.endsWith("migrate-legacy-users-to-clerk.ts") ?? false;

if (invoked_directly) {
  run_cli().catch((error) => {
    console.error("migrate:clerk failed:", error.message ?? error);
    process.exitCode = 1;
  });
}
