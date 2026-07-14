/**
 * G2.5 Step 1 — tenant router isolation contract (RED first).
 *
 * Asserts the POST-conversion behavior of the tRPC business routers: every
 * procedure reads and writes through the tenant-scoped repositories, so
 * cross-tenant IDs surface as generic NOT_FOUND, lists never leak another
 * tenant's rows, client-supplied organizationId/tenantId are ignored, and the
 * fine-grained permission catalogue gates each surface. The routers are NOT
 * converted yet, so most of these tests are EXPECTED TO FAIL until Task 5
 * lands — do not "fix" the failures by weakening the assertions.
 *
 * The @rnd-ai/shared-database default export (a Promise of a MongoClient) is
 * mocked to resolve to a MongoMemoryServer-backed client, so both the tenant
 * middleware in apps/ai/server/trpc.ts and the (still legacy) router bodies
 * hit the same in-memory database this file seeds.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  PLATFORM_ROLE_PERMISSIONS,
  TENANT_ROLE_PERMISSIONS,
} from "../../packages/shared-types/src/auth";
import type {
  RequestPrincipal,
  TenantRole,
} from "../../packages/shared-types/src/auth";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

/**
 * Deferred MongoClient promise shared with the hoisted module mock below.
 * The promise is created before any module import; beforeAll resolves it
 * once the in-memory server is running.
 */
const hoisted = vi.hoisted(() => {
  let resolve_client: (client: unknown) => void = () => {};
  const client_promise = new Promise((resolve) => {
    resolve_client = resolve;
  });
  return {
    client_promise,
    provide_client: (client: unknown) => resolve_client(client),
  };
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
  parseArrayField: (value: unknown): string[] =>
    Array.isArray(value)
      ? value.map(String)
      : typeof value === "string" && value.length > 0
        ? value.split(",").map((part) => part.trim())
        : [],
}));

// The legacy products router fires a background Qdrant auto-index on create;
// stub it so this isolation suite never attempts network I/O.
vi.mock("../../apps/ai/server/services/auto-index-service", () => ({
  auto_index_material: async () => true,
  auto_delete_material: async () => true,
}));

import {
  createCallerFactory,
  type TRPCContext,
} from "../../apps/ai/server/trpc";
import { appRouter } from "../../apps/ai/server/index";

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;

const TENANT_A = "507f1f77bcf86cd7994390a1";
const TENANT_B = "507f1f77bcf86cd7994390b1";
const PROFILE_A_USER = "507f1f77bcf86cd79943a001";
const PROFILE_A_MANAGER = "507f1f77bcf86cd79943a003";
const PROFILE_B_MANAGER = "507f1f77bcf86cd79943b001";
const PROFILE_PLATFORM_ADMIN = "507f1f77bcf86cd79943c001";
const MISSING_ID = "ffffffffffffffffffffffff";

const FORMULA_A_ID = "00000000000000000000f0a1";
const FORMULA_B_ID = "00000000000000000000f0b1";
const PRODUCT_A_ID = "00000000000000000000d0a1";
const PRODUCT_B_ID = "00000000000000000000d0b1";
const THREAD_A_ID = "00000000000000000000c0a1";
const THREAD_B_ID = "00000000000000000000c0b1";

/** Repository-canonical tenant collections wiped before every test. */
const TENANT_COLLECTIONS = [
  "formulas",
  "formula_comments",
  "formula_version_logs",
  "conversations",
  "chat_threads",
  "chat_messages",
  "products",
  "stock_entries",
  "orders",
  "price_calculations",
  "feedback",
  "tenant_audit_events",
  // Legacy collections the unconverted routers still write into; wiped so
  // forged-input assertions can inspect exactly what one call created.
  "raw_materials_console",
  "users",
  "organizations",
  "user_logs",
];

/**
 * Build a tenant-member RequestPrincipal with the real per-role permission
 * catalogue from @rnd-ai/shared-types (fine-grained plus G0 transitional).
 *
 * @param tenant_id - Active tenant string ID (24-hex).
 * @param profile_id - Internal user profile ID (24-hex).
 * @param role - Tenant role deciding the permission catalogue.
 * @returns Verified-principal fixture for caller construction.
 */
function tenant_principal(
  tenant_id: string,
  profile_id: string,
  role: TenantRole,
): RequestPrincipal {
  return {
    auth_provider: "clerk",
    provider_user_id: `user_${profile_id}`,
    internal_user_id: profile_id,
    active_tenant_id: tenant_id,
    platform_role: null,
    tenant_role: role,
    permissions: TENANT_ROLE_PERMISSIONS[role],
    membership_status: "active",
  };
}

/**
 * Build a platform administrator principal with NO tenant membership and no
 * support-access grant. Post-conversion, tenant surfaces must reject it.
 *
 * @returns Platform-admin principal fixture.
 */
function platform_admin_principal(): RequestPrincipal {
  return {
    auth_provider: "clerk",
    provider_user_id: `user_${PROFILE_PLATFORM_ADMIN}`,
    internal_user_id: PROFILE_PLATFORM_ADMIN,
    active_tenant_id: null,
    platform_role: "admin",
    tenant_role: null,
    permissions: PLATFORM_ROLE_PERMISSIONS.admin,
    membership_status: null,
  };
}

/**
 * Build a TRPCContext for a verified principal, mirroring the shape produced
 * by createTRPCContext (see tests/auth/trpc-procedures.test.ts).
 *
 * @param principal - Verified principal fixture.
 * @returns Context consumed by the caller factory.
 */
function build_ctx(principal: RequestPrincipal): TRPCContext {
  return {
    principal,
    auth_error: null,
    resolver_used: "clerk",
    legacy_user: {
      id: principal.internal_user_id,
      accountId: principal.provider_user_id,
      organizationId: principal.active_tenant_id ?? "",
      name: "Test User",
      email: "test@example.com",
      role: principal.tenant_role === "manager" ? "admin" : "shopper",
      status: "active",
      isActive: true,
    },
  };
}

const create_caller = createCallerFactory(appRouter);

const a_user_caller = () =>
  create_caller(build_ctx(tenant_principal(TENANT_A, PROFILE_A_USER, "user")));
const a_manager_caller = () =>
  create_caller(
    build_ctx(tenant_principal(TENANT_A, PROFILE_A_MANAGER, "manager")),
  );
const platform_admin_caller = () =>
  create_caller(build_ctx(platform_admin_principal()));

/**
 * Capture a rejected tRPC call's error for code assertions.
 *
 * @param promise - Promise expected to reject with a TRPCError.
 * @returns The rejection error, narrowed to its code/message surface.
 * @throws Error when the promise unexpectedly resolves.
 */
async function capture_trpc_error(
  promise: Promise<unknown>,
): Promise<{ code?: string; message?: string }> {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string; message?: string };
  }
  throw new Error("expected the call to reject, but it resolved");
}

/**
 * Seed two-tenant fixture data using the repository-canonical conventions:
 * tenantId stored as a STRING, ownerProfileId/actorProfileId strings.
 *
 * @param database - In-memory database handle shared with the routers.
 */
async function seed_fixtures(database: Db): Promise<void> {
  const now = new Date();

  await database.collection("formulas").insertMany([
    {
      _id: new ObjectId(FORMULA_A_ID),
      tenantId: TENANT_A,
      ownerProfileId: PROFILE_A_USER,
      name: "Formula Alpha A",
      formulaName: "Formula Alpha A",
      status: "draft",
      version: 0,
      ingredients: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: new ObjectId(FORMULA_B_ID),
      tenantId: TENANT_B,
      ownerProfileId: PROFILE_B_MANAGER,
      name: "Formula Beta B",
      formulaName: "Formula Beta B",
      status: "draft",
      version: 0,
      ingredients: [],
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await database.collection("formula_comments").insertMany([
    {
      tenantId: TENANT_A,
      formulaId: FORMULA_A_ID,
      actorProfileId: PROFILE_A_USER,
      body: "Comment Alpha A",
      content: "Comment Alpha A",
      commentType: "feedback",
      createdAt: now,
      updatedAt: now,
    },
    {
      tenantId: TENANT_B,
      formulaId: FORMULA_B_ID,
      actorProfileId: PROFILE_B_MANAGER,
      body: "Comment Beta B",
      content: "Comment Beta B",
      commentType: "feedback",
      createdAt: now,
      updatedAt: now,
    },
    // Forged cross-tenant row: parented to formula A but owned by tenant B.
    // Post-conversion tenant filters must exclude it from tenant A reads.
    {
      tenantId: TENANT_B,
      formulaId: FORMULA_A_ID,
      actorProfileId: PROFILE_B_MANAGER,
      body: "Intruder comment from B",
      content: "Intruder comment from B",
      commentType: "feedback",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await database.collection("formula_version_logs").insertMany([
    {
      tenantId: TENANT_A,
      formulaId: FORMULA_A_ID,
      actorProfileId: PROFILE_A_USER,
      note: "Version log Alpha A",
      remarks: "Version log Alpha A",
      createdAt: now,
    },
    {
      tenantId: TENANT_B,
      formulaId: FORMULA_B_ID,
      actorProfileId: PROFILE_B_MANAGER,
      note: "Version log Beta B",
      remarks: "Version log Beta B",
      createdAt: now,
    },
  ]);

  await database.collection("products").insertMany([
    {
      _id: new ObjectId(PRODUCT_A_ID),
      tenantId: TENANT_A,
      actorProfileId: PROFILE_A_MANAGER,
      name: "Product Alpha A",
      productName: "Product Alpha A",
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: new ObjectId(PRODUCT_B_ID),
      tenantId: TENANT_B,
      actorProfileId: PROFILE_B_MANAGER,
      name: "Product Beta B",
      productName: "Product Beta B",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await database.collection("orders").insertMany([
    {
      tenantId: TENANT_A,
      actorProfileId: PROFILE_A_USER,
      name: "Order Alpha A",
      productName: "Order Alpha A",
      status: "pending",
      quantity: 1,
      price: 10,
      createdAt: now,
      updatedAt: now,
    },
    {
      tenantId: TENANT_B,
      actorProfileId: PROFILE_B_MANAGER,
      name: "Order Beta B",
      productName: "Order Beta B",
      status: "pending",
      quantity: 1,
      price: 10,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await database.collection("chat_threads").insertMany([
    {
      _id: new ObjectId(THREAD_A_ID),
      tenantId: TENANT_A,
      ownerProfileId: PROFILE_A_USER,
      agentType: "sales_rnd_ai",
      title: "Thread Alpha A",
      messageCount: 1,
      isArchived: false,
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: new ObjectId(THREAD_B_ID),
      tenantId: TENANT_B,
      ownerProfileId: PROFILE_B_MANAGER,
      agentType: "sales_rnd_ai",
      title: "Thread Beta B",
      messageCount: 1,
      isArchived: false,
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await database.collection("chat_messages").insertMany([
    {
      tenantId: TENANT_A,
      threadId: THREAD_A_ID,
      role: "user",
      content: "Message Alpha A",
      body: "Message Alpha A",
      createdAt: now,
    },
    {
      tenantId: TENANT_B,
      threadId: THREAD_B_ID,
      role: "user",
      content: "Message Beta B",
      body: "Message Beta B",
      createdAt: now,
    },
  ]);
}

/**
 * Assert a cross-tenant parented read either rejects with NOT_FOUND or
 * resolves without leaking the other tenant's content.
 *
 * @param promise - The router call under test.
 * @param leaked_marker - Content that must never appear in a resolved result.
 */
async function expect_not_found_or_clean(
  promise: Promise<unknown>,
  leaked_marker: string,
): Promise<void> {
  let result: unknown;
  try {
    result = await promise;
  } catch (error) {
    expect((error as { code?: string }).code).toBe("NOT_FOUND");
    return;
  }
  expect(JSON.stringify(result)).not.toContain(leaked_marker);
}

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db();
  hoisted.provide_client(client);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

beforeEach(async () => {
  for (const name of TENANT_COLLECTIONS) {
    await db.collection(name).deleteMany({});
  }
  await seed_fixtures(db);
});

describe("ID enumeration is indistinguishable from missing IDs", () => {
  it("formulas.getById with a tenant-B id rejects NOT_FOUND like a missing id", async () => {
    const caller = a_user_caller();
    const cross_error = await capture_trpc_error(
      caller.formulas.getById({ id: FORMULA_B_ID }),
    );
    const missing_error = await capture_trpc_error(
      caller.formulas.getById({ id: MISSING_ID }),
    );
    expect(cross_error).toMatchObject({ code: "NOT_FOUND" });
    expect(missing_error.code).toBe(cross_error.code);
  });

  it("products.getById with a tenant-B id rejects NOT_FOUND like a missing id", async () => {
    const caller = a_user_caller();
    const cross_error = await capture_trpc_error(
      caller.products.getById({ id: PRODUCT_B_ID }),
    );
    const missing_error = await capture_trpc_error(
      caller.products.getById({ id: MISSING_ID }),
    );
    expect(cross_error).toMatchObject({ code: "NOT_FOUND" });
    expect(missing_error.code).toBe(cross_error.code);
  });
});

describe("lists never leak other tenants", () => {
  it("formulas.list returns tenant A records and no tenant B records", async () => {
    const result = await a_user_caller().formulas.list();
    const text = JSON.stringify(result);
    expect(text).toContain("Formula Alpha A");
    expect(text).not.toContain("Formula Beta B");
  });

  it("products.list returns tenant A records and no tenant B records", async () => {
    const result = await a_user_caller().products.list();
    const text = JSON.stringify(result);
    expect(text).toContain("Product Alpha A");
    expect(text).not.toContain("Product Beta B");
  });

  it("orders.list returns tenant A records and no tenant B records", async () => {
    const result = await a_user_caller().orders.list();
    const text = JSON.stringify(result);
    expect(text).toContain("Order Alpha A");
    expect(text).not.toContain("Order Beta B");
  });
});

describe("nested formula resources are tenant-scoped", () => {
  it("formulaComments.list for a tenant-B formula rejects NOT_FOUND or returns nothing of B's", async () => {
    await expect_not_found_or_clean(
      a_user_caller().formulaComments.list({ formulaId: FORMULA_B_ID }),
      "Comment Beta B",
    );
  });

  it("formulaComments.list on an own formula excludes tenant-B comment rows", async () => {
    const comments = await a_user_caller().formulaComments.list({
      formulaId: FORMULA_A_ID,
    });
    const text = JSON.stringify(comments);
    expect(text).toContain("Comment Alpha A");
    expect(text).not.toContain("Intruder comment from B");
  });

  it("formulaVersionLogs.list for a tenant-B formula rejects NOT_FOUND or returns nothing of B's", async () => {
    await expect_not_found_or_clean(
      a_user_caller().formulaVersionLogs.list({ formulaId: FORMULA_B_ID }),
      "Version log Beta B",
    );
  });
});

describe("chat threads and messages are tenant-scoped", () => {
  it("chatThreads.getMessages for a tenant-B thread rejects NOT_FOUND", async () => {
    const error = await capture_trpc_error(
      a_user_caller().chatThreads.getMessages({ threadId: THREAD_B_ID }),
    );
    expect(error).toMatchObject({ code: "NOT_FOUND" });
  });

  it("chatThreads.list returns tenant A threads and excludes tenant B threads", async () => {
    const threads = await a_user_caller().chatThreads.list({
      agentType: "sales_rnd_ai",
    });
    const text = JSON.stringify(threads);
    expect(text).toContain("Thread Alpha A");
    expect(text).not.toContain("Thread Beta B");
  });
});

describe("forged tenant identifiers in input are ignored", () => {
  it("products.create with forged organizationId/tenantId never creates a tenant-B document", async () => {
    let rejected = false;
    try {
      await a_manager_caller().products.create({
        productName: "Forged Product",
        organizationId: TENANT_B,
        tenantId: TENANT_B,
      } as never);
    } catch {
      // Rejecting the forged input outright satisfies the contract.
      rejected = true;
    }

    const created = [
      ...(await db
        .collection("products")
        .find({
          $or: [{ name: "Forged Product" }, { productName: "Forged Product" }],
        })
        .toArray()),
      ...(await db
        .collection("raw_materials_console")
        .find({ trade_name: "Forged Product" })
        .toArray()),
    ];

    if (rejected) {
      expect(created).toHaveLength(0);
    } else {
      expect(created.length).toBeGreaterThan(0);
      for (const doc of created) {
        expect(doc.tenantId).toBe(TENANT_A);
      }
    }
  });
});

describe("fine-grained permission gates", () => {
  it("formulas.confirm as a tenant user rejects FORBIDDEN (needs formula:confirm)", async () => {
    await expect(
      a_user_caller().formulas.confirm({ id: FORMULA_A_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("tenantMembers.inviteUser as a tenant user rejects FORBIDDEN", async () => {
    await expect(
      a_user_caller().tenantMembers.inviteUser({
        email: "student@example.com",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("users.list as a tenant user rejects FORBIDDEN (needs tenant:members:read)", async () => {
    await expect(a_user_caller().users.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("products.create as a tenant user rejects FORBIDDEN (needs tenant:knowledge:manage)", async () => {
    await expect(
      a_user_caller().products.create({ productName: "User Product" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("platform admin without a support grant cannot read tenant formulas", async () => {
    const error = await capture_trpc_error(platform_admin_caller().formulas.list());
    expect(["FORBIDDEN", "UNAUTHORIZED"]).toContain(error.code);
  });
});

describe("positive controls: legitimate tenant access works", () => {
  it("tenant A user reads their own seeded formula by id", async () => {
    const formula = await a_user_caller().formulas.getById({
      id: FORMULA_A_ID,
    });
    expect(JSON.stringify(formula)).toContain("Formula Alpha A");
  });

  it("tenant A manager creates a product that lands with tenantId TENANT_A (string)", async () => {
    await a_manager_caller().products.create({
      productName: "Managed Product",
    });
    const doc = await db.collection("products").findOne({
      $or: [{ name: "Managed Product" }, { productName: "Managed Product" }],
    });
    expect(doc).toBeTruthy();
    expect(doc?.tenantId).toBe(TENANT_A);
  });
});
