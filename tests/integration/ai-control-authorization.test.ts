/**
 * G3.6 — tenant AI administration authorization.
 *
 * Asserts the permission matrix for the AI governance surfaces: a tenant user
 * cannot read/configure AI or upload knowledge; a manager can configure within
 * plan/platform ceilings but cannot expand them or edit platform defaults; a
 * platform admin manages constraints but cannot flip the emergency kill switch;
 * only a super admin can emergency-disable AI. Runs against an in-memory MongoDB
 * so the authorized paths execute end-to-end (including the narrowing guard).
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PLATFORM_ROLE_PERMISSIONS,
  TENANT_ROLE_PERMISSIONS,
  type RequestPrincipal,
} from "../../packages/shared-types/src/auth";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const hoisted = vi.hoisted(() => {
  let resolve_client: (client: unknown) => void = () => {};
  const client_promise = new Promise((resolve) => {
    resolve_client = resolve;
  });
  return { client_promise, provide_client: (c: unknown) => resolve_client(c) };
});

vi.mock("@rnd-ai/shared-database", () => ({
  default: hoisted.client_promise,
  main_client_promise: hoisted.client_promise,
  raw_materials_client_promise: hoisted.client_promise,
  get_main_client_promise: () => hoisted.client_promise,
  get_raw_materials_client_promise: () => hoisted.client_promise,
  create_mongodb_client: () => hoisted.client_promise,
  get_database_name_from_uri: () => "test",
  prisma: {},
  PrismaClient: class {},
  parseArrayField: (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []),
}));

import { createCallerFactory, type TRPCContext } from "../../apps/ai/server/trpc";
import { appRouter } from "../../apps/ai/server/index";

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;

const TENANT = "507f1f77bcf86cd7994390a1";
const MANAGER = "507f1f77bcf86cd79943a003";
const USER = "507f1f77bcf86cd79943a001";
const PLATFORM_ADMIN = "507f1f77bcf86cd79943c001";
const SUPER_ADMIN = "507f1f77bcf86cd79943c002";

const create_caller = createCallerFactory(appRouter);

/**
 * Build a caller context for a principal (no transport/DB stubbing needed;
 * the tenant middleware builds the scope from the principal).
 *
 * @param principal - Verified principal.
 * @returns TRPCContext.
 */
function ctx(principal: RequestPrincipal): TRPCContext {
  return {
    principal,
    auth_error: null,
    resolver_used: "clerk",
    legacy_user: {
      id: principal.internal_user_id,
      accountId: principal.provider_user_id,
      organizationId: principal.active_tenant_id ?? "",
      name: "T",
      email: "t@example.com",
      role: principal.tenant_role === "manager" ? "admin" : "shopper",
      status: "active",
      isActive: true,
    },
  };
}

function tenant_principal(role: "manager" | "user", profile_id: string): RequestPrincipal {
  return {
    auth_provider: "clerk",
    provider_user_id: `user_${profile_id}`,
    internal_user_id: profile_id,
    active_tenant_id: TENANT,
    platform_role: null,
    tenant_role: role,
    permissions: TENANT_ROLE_PERMISSIONS[role],
    membership_status: "active",
  };
}

function platform_principal(role: "admin" | "super_admin", profile_id: string): RequestPrincipal {
  return {
    auth_provider: "clerk",
    provider_user_id: `user_${profile_id}`,
    internal_user_id: profile_id,
    active_tenant_id: null,
    platform_role: role,
    tenant_role: null,
    permissions: PLATFORM_ROLE_PERMISSIONS[role],
    membership_status: null,
  };
}

const as_user = () => create_caller(ctx(tenant_principal("user", USER)));
const as_manager = () => create_caller(ctx(tenant_principal("manager", MANAGER)));
const as_admin = () => create_caller(ctx(platform_principal("admin", PLATFORM_ADMIN)));
const as_super = () => create_caller(ctx(platform_principal("super_admin", SUPER_ADMIN)));

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db("test");
  hoisted.provide_client(client);
});

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

beforeEach(async () => {
  await db.collection("tenant_ai_profiles").deleteMany({});
  await db.collection("platform_ai_state").deleteMany({});
  await db.collection("knowledge_sources").deleteMany({});
  await db.collection("tenant_ai_profiles").insertOne({
    tenantId: new ObjectId(TENANT),
    status: "active",
    planKey: "starter", // starter max_iterations = 8
    policyVersion: 1,
    allowedProviders: ["google"],
    allowedModels: ["gemini-2.5-flash"],
    allowedTools: ["formula.search", "knowledge.search"],
    maxIterations: 8,
    defaultLocale: "th-TH",
  });
});

describe("tenant AI settings authorization", () => {
  it("denies AI read and configure to a tenant user", async () => {
    await expect(as_user().tenantAiSettings.read()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      as_user().tenantAiSettings.update({ max_iterations: 5 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets a manager read and narrow settings within the plan", async () => {
    const view = await as_manager().tenantAiSettings.read();
    expect(view.provisioned).toBe(true);
    const result = await as_manager().tenantAiSettings.update({ max_iterations: 5 });
    expect(result.policy_version).toBe(2);
  });

  it("prevents a manager from expanding beyond the plan/platform maximum", async () => {
    await expect(
      as_manager().tenantAiSettings.update({ max_iterations: 50 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      as_manager().tenantAiSettings.update({ allowed_models: ["gemini-3.1-pro-preview"] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("knowledge sources authorization", () => {
  it("lets a user list but not upload; a manager can upload", async () => {
    await expect(as_user().knowledgeSources.list()).resolves.toEqual([]);
    await expect(
      as_user().knowledgeSources.requestUpload({
        name: "doc",
        source_type: "document",
        content_hash: "abc",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const created = await as_manager().knowledgeSources.requestUpload({
      name: "doc",
      source_type: "document",
      content_hash: "abc",
    });
    expect(created.status).toBe("pending");
  });
});

describe("platform AI settings authorization", () => {
  it("denies platform surfaces to a manager", async () => {
    await expect(as_manager().platformAiSettings.getConstraints()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("lets a platform admin read constraints but not emergency-disable", async () => {
    const constraints = await as_admin().platformAiSettings.getConstraints();
    expect(constraints.plans).toContain("starter");
    await expect(
      as_admin().platformAiSettings.emergencyDisable({ disabled: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets only a super admin emergency-disable AI", async () => {
    const result = await as_super().platformAiSettings.emergencyDisable({ disabled: true });
    expect(result.emergency_disabled).toBe(true);
    const state = await db.collection("platform_ai_state").findOne({ key: "singleton" });
    expect(state?.emergencyDisabled).toBe(true);
  });
});
