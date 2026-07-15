/**
 * G2.6 — legacy AI tool tenant isolation (integration).
 *
 * The ReAct tool handlers accept a model-supplied record ID or search query but
 * MUST pin every tenant collection access to the tenant of the trusted
 * execution context. These tests seed two tenants' formulas into an in-memory
 * MongoDB and prove that:
 *   - a tenant-A caller naming a tenant-B formula ID gets the generic
 *     "Formula not found" shape (no cross-tenant read, no existence oracle);
 *   - reference-formula search never returns another tenant's rows;
 *   - generate_formula stamps tenant provenance on every write;
 *   - mongo_query no longer accepts model-supplied collections/filters/stages —
 *     only server-authored, tenant-scoped named diagnostics run.
 *
 * The @rnd-ai/shared-database default export (a Promise of a MongoClient) is
 * mocked to a MongoMemoryServer-backed client so the handlers hit the same
 * in-memory database this file seeds. Qdrant/embedding services are mocked so
 * no network I/O occurs.
 *
 * The first block is the pure-helper contract (already green from 6ebb400); the
 * handler blocks below are RED until Task 6 converts the handlers.
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
  tenant_scoped_id_filter,
  tenant_scoped_query_filter,
} from "../../apps/ai/agents/react/tenant-tool-scope";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

/**
 * Deferred MongoClient promise shared with the hoisted module mock below.
 * Created before any module import; beforeAll resolves it once the in-memory
 * server is running.
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
}));

// Deterministic single-ingredient search result so generate_formula persists
// without touching Qdrant or an embedding provider.
vi.mock("../../apps/ai/services/vector/qdrant-service", () => ({
  get_qdrant_service: () => ({
    search: async () => [
      {
        payload: {
          inci_name: "Niacinamide",
          trade_name: "Nia-B3",
          rm_code: "RM0001",
          category: "active",
          benefits: "brightening",
          usage_min_pct: 2,
          usage_max_pct: 5,
        },
        score: 0.92,
      },
    ],
  }),
}));

vi.mock("../../apps/ai/services/embeddings/universal-embedding-service", () => ({
  createEmbeddingService: () => ({
    createEmbedding: async () => [0.1, 0.2, 0.3],
  }),
}));

import { handle_confirm_formula } from "../../apps/ai/agents/react/tool-handlers/confirm-formula-handler";
import { handle_get_formula_with_comments } from "../../apps/ai/agents/react/tool-handlers/get-formula-with-comments-handler";
import { handle_search_reference_formulas } from "../../apps/ai/agents/react/tool-handlers/search-reference-formulas-handler";
import { handle_revise_formula } from "../../apps/ai/agents/react/tool-handlers/revise-formula-handler";
import { handle_mongo_query } from "../../apps/ai/agents/react/tool-handlers/mongo-query-handler";
import type { ToolHandlerContext } from "../../apps/ai/agents/react/types";

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;

const TENANT_A = "507f1f77bcf86cd7994390a1";
const TENANT_B = "507f1f77bcf86cd7994390b1";
const USER_A = "507f1f77bcf86cd79943a001";
const FORMULA_A_ID = "00000000000000000000f0a1";
const FORMULA_B_ID = "00000000000000000000f0b1";

/**
 * Build a tenant-scoped tool handler context, mirroring what a converted route
 * handler injects from the verified principal's active tenant.
 *
 * @param tenant_id - Verified tenant ID from the execution context.
 * @param user_id - Acting user profile ID.
 * @returns ToolHandlerContext with tenant scope.
 */
function tool_context(tenant_id: string, user_id: string): ToolHandlerContext {
  return { user_id, organization_id: tenant_id, tenant_id };
}

/**
 * Seed one draft formula per tenant plus a comment on each, so cross-tenant
 * reads have a real record to (fail to) reach.
 */
async function seed_formulas(): Promise<void> {
  await db.collection("formulas").insertMany([
    {
      _id: new ObjectId(FORMULA_A_ID),
      tenantId: TENANT_A,
      organizationId: TENANT_A,
      formulaCode: "F000001",
      formulaName: "Tenant A Serum",
      status: "draft",
      version: 0,
      ingredients: [{ rm_code: "RM0001", inci_name: "Aqua", percentage: 80 }],
      targetBenefits: ["hydration"],
    },
    {
      _id: new ObjectId(FORMULA_B_ID),
      tenantId: TENANT_B,
      organizationId: TENANT_B,
      formulaCode: "F000002",
      formulaName: "Tenant B Cream",
      status: "draft",
      version: 0,
      ingredients: [{ rm_code: "RM0002", inci_name: "Glycerin", percentage: 5 }],
      targetBenefits: ["hydration"],
    },
  ]);
  await db.collection("formula_comments").insertMany([
    {
      formulaId: FORMULA_A_ID,
      version: 0,
      userName: "A",
      content: "looks good",
      commentType: "feedback",
      createdAt: new Date(),
    },
    {
      formulaId: FORMULA_B_ID,
      version: 0,
      userName: "B",
      content: "tenant B private note",
      commentType: "feedback",
      createdAt: new Date(),
    },
  ]);
}

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
  for (const name of ["formulas", "formula_comments", "formula_version_logs"]) {
    await db.collection(name).deleteMany({});
  }
  await seed_formulas();
});

describe("tenant_scoped_id_filter (G2.6)", () => {
  const formula_id = "507f1f77bcf86cd799439099";

  it("pins a record lookup to the caller's tenant", () => {
    const filter = tenant_scoped_id_filter(formula_id, TENANT_A);
    expect(filter).not.toBeNull();
    expect(filter!._id).toBeInstanceOf(ObjectId);
    expect(filter!._id.toString()).toBe(formula_id);
    expect(filter!.tenantId.$in.map(String)).toContain(TENANT_A);
    expect(filter!.tenantId.$in.some((v) => v instanceof ObjectId)).toBe(true);
  });

  it("a tenant-B record ID under a tenant-A scope still filters by tenant A", () => {
    const filter = tenant_scoped_id_filter(formula_id, TENANT_A);
    expect(filter!.tenantId.$in.map(String)).not.toContain(TENANT_B);
  });

  it("fails closed (null) when no tenant scope is present", () => {
    expect(tenant_scoped_id_filter(formula_id, undefined)).toBeNull();
    expect(tenant_scoped_id_filter(formula_id, "")).toBeNull();
  });

  it("fails closed (null) for a malformed record ID", () => {
    expect(tenant_scoped_id_filter("not-an-id", TENANT_A)).toBeNull();
  });

  it("query filter carries the tenant clause without an _id, or null when unscoped", () => {
    const scoped = tenant_scoped_query_filter(TENANT_A);
    expect(scoped!.tenantId.$in.map(String)).toContain(TENANT_A);
    expect((scoped as Record<string, unknown>)._id).toBeUndefined();
    expect(tenant_scoped_query_filter(undefined)).toBeNull();
  });
});

describe("confirm_formula tenant isolation", () => {
  it("a tenant-A caller cannot confirm a tenant-B formula", async () => {
    const raw = await handle_confirm_formula(
      { formula_id: FORMULA_B_ID },
      tool_context(TENANT_A, USER_A),
    );
    expect(JSON.parse(raw).error).toMatch(/not found/i);
    const b = await db
      .collection("formulas")
      .findOne({ _id: new ObjectId(FORMULA_B_ID) });
    expect(b?.status).toBe("draft"); // untouched
    expect(b?.version).toBe(0);
  });

  it("a tenant-A caller can confirm its own formula", async () => {
    const raw = await handle_confirm_formula(
      { formula_id: FORMULA_A_ID },
      tool_context(TENANT_A, USER_A),
    );
    expect(JSON.parse(raw).success).toBe(true);
  });
});

describe("get_formula_with_comments tenant isolation", () => {
  it("a tenant-A caller cannot read a tenant-B formula or its comments", async () => {
    const raw = await handle_get_formula_with_comments(
      { formula_id: FORMULA_B_ID },
      tool_context(TENANT_A, USER_A),
    );
    const parsed = JSON.parse(raw);
    expect(parsed.error).toMatch(/not found/i);
    expect(raw).not.toContain("tenant B private note");
  });

  it("a tenant-A caller reads its own formula with comments", async () => {
    const raw = await handle_get_formula_with_comments(
      { formula_id: FORMULA_A_ID },
      tool_context(TENANT_A, USER_A),
    );
    expect(JSON.parse(raw).formula.formula_name).toBe("Tenant A Serum");
  });
});

describe("revise_formula tenant isolation", () => {
  it("a tenant-A caller cannot revise a tenant-B formula", async () => {
    const raw = await handle_revise_formula(
      { formula_id: FORMULA_B_ID },
      tool_context(TENANT_A, USER_A),
    );
    expect(JSON.parse(raw).error).toMatch(/not found/i);
    const b = await db
      .collection("formulas")
      .findOne({ _id: new ObjectId(FORMULA_B_ID) });
    expect(b?.formulaName).toBe("Tenant B Cream"); // untouched
  });
});

describe("search_reference_formulas tenant isolation", () => {
  it("never returns another tenant's formulas", async () => {
    const raw = await handle_search_reference_formulas(
      { query: "hydration" },
      tool_context(TENANT_A, USER_A),
    );
    const parsed = JSON.parse(raw);
    const names = parsed.formulas.map((f: { formula_name: string }) => f.formula_name);
    expect(names).toContain("Tenant A Serum");
    expect(names).not.toContain("Tenant B Cream");
  });

  it("fails closed (no results) when no tenant scope is present", async () => {
    const raw = await handle_search_reference_formulas({ query: "hydration" });
    const parsed = JSON.parse(raw);
    expect(parsed.result_count).toBe(0);
  });
});

describe("generate_formula tenant provenance", () => {
  it("stamps the caller's tenant on every persisted formula", async () => {
    await handle_generate_formula_wrapper();
    const created = await db
      .collection("formulas")
      .findOne({ aiGenerated: true });
    expect(created).not.toBeNull();
    expect(created?.tenantId).toBe(TENANT_A);
    expect(created?.organizationId).toBe(TENANT_A);
  });
});

/**
 * Thin wrapper so the dynamic import of the generate handler (which pulls the
 * mocked qdrant/embedding services) resolves lazily inside the test body.
 */
async function handle_generate_formula_wrapper(): Promise<void> {
  const { handle_generate_formula } = await import(
    "../../apps/ai/agents/react/tool-handlers/generate-formula-handler"
  );
  await handle_generate_formula(
    { product_type: "serum", target_benefits: ["brightening"] },
    tool_context(TENANT_A, USER_A),
  );
}

describe("mongo_query is a locked-down named-diagnostic surface", () => {
  it("rejects a model-supplied collection/filter (legacy free-form shape)", async () => {
    const raw = await handle_mongo_query(
      {
        collection: "formulas",
        database: "rnd_ai",
        operation: "find",
        filter: { tenantId: TENANT_B },
      } as unknown as Parameters<typeof handle_mongo_query>[0],
      tool_context(TENANT_A, USER_A),
    );
    expect(raw).toMatch(/query_name|not allowed|unknown/i);
    expect(raw).not.toContain("Tenant B Cream");
  });

  it("runs an allowlisted diagnostic scoped to the caller's tenant", async () => {
    const raw = await handle_mongo_query(
      { query_name: "tenant_formula_count" } as unknown as Parameters<
        typeof handle_mongo_query
      >[0],
      tool_context(TENANT_A, USER_A),
    );
    // Only tenant A's single seeded formula is counted, never tenant B's.
    expect(raw).toMatch(/"count":\s*1/);
  });

  it("rejects an unknown diagnostic name", async () => {
    const raw = await handle_mongo_query(
      { query_name: "drop_everything" } as unknown as Parameters<
        typeof handle_mongo_query
      >[0],
      tool_context(TENANT_A, USER_A),
    );
    expect(raw).toMatch(/unknown|not allowed/i);
  });

  it("fails closed when a tenant-scoped diagnostic has no tenant scope", async () => {
    const raw = await handle_mongo_query({
      query_name: "tenant_formula_count",
    } as unknown as Parameters<typeof handle_mongo_query>[0]);
    expect(raw).toMatch(/tenant/i);
  });
});
