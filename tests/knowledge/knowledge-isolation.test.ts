/**
 * G3.5 — knowledge gateway tenant isolation.
 *
 * The fake vector port deliberately IGNORES the enforced filter and returns
 * every point in a collection, simulating a permissive/compromised backend, so
 * these tests prove the gateway's own post-retrieval validation is what
 * guarantees isolation: a tenant-A caller never sees tenant-B or mislabeled
 * points, regardless of what the store returns. A second block checks the
 * source repository tenant scoping against an in-memory MongoDB.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { TenantExecutionContext } from "@rnd-ai/shared-types";
import {
  create_knowledge_gateway,
  type RawVectorResult,
  type VectorSearchPort,
} from "../../apps/ai/server/services/knowledge/knowledge-gateway";
import {
  platform_collection,
  tenant_collection,
} from "../../apps/ai/server/services/knowledge/qdrant-collections";
import { create_knowledge_source_repository } from "../../apps/ai/server/repositories/knowledge-source-repository";

const TENANT_A = "507f1f77bcf86cd7994390a1";
const TENANT_B = "507f1f77bcf86cd7994390b1";
const EMBED_VERSION = "v1";

/**
 * Build a context stub — the gateway only reads `tenant_id`.
 *
 * @param tenant_id - The tenant scope.
 * @returns A context cast to TenantExecutionContext.
 */
function ctx(tenant_id: string): TenantExecutionContext {
  return { tenant_id } as unknown as TenantExecutionContext;
}

/**
 * A deliberately leaky vector port: it returns EVERY seeded point for the named
 * collection, ignoring the filter, so the gateway's validation is under test.
 */
function make_leaky_vector_port(): VectorSearchPort {
  const platform: RawVectorResult[] = [
    {
      id: "p1",
      score: 0.9,
      payload: {
        is_tenant: false,
        source_id: "ps1",
        content: "platform niacinamide guidance",
        content_hash: "h-p1",
      },
    },
    // mislabeled: a tenant-B point sitting in the platform collection.
    {
      id: "p-bad",
      score: 0.95,
      payload: {
        is_tenant: true,
        tenant_id: TENANT_B,
        source_id: "leak",
        content: "SHOULD NOT SURFACE",
        content_hash: "h-bad",
      },
    },
  ];
  const tenant: RawVectorResult[] = [
    {
      id: "a1",
      score: 0.8,
      payload: {
        is_tenant: true,
        tenant_id: TENANT_A,
        source_id: "as1",
        content: "tenant A niacinamide note",
        content_hash: "h-a1",
      },
    },
    {
      id: "b1",
      score: 0.99,
      payload: {
        is_tenant: true,
        tenant_id: TENANT_B,
        source_id: "bs1",
        content: "tenant B SECRET note",
        content_hash: "h-b1",
      },
    },
    // mislabeled: a platform-looking point in the tenant collection.
    {
      id: "t-bad",
      score: 0.97,
      payload: {
        is_tenant: false,
        source_id: "tbad",
        content: "SHOULD NOT SURFACE EITHER",
        content_hash: "h-tbad",
      },
    },
  ];
  return {
    async search(collection_name) {
      if (collection_name === platform_collection(EMBED_VERSION)) return platform;
      if (collection_name === tenant_collection(EMBED_VERSION)) return tenant;
      return [];
    },
  };
}

const embedding_port = {
  async embed(): Promise<readonly number[]> {
    return [0.1, 0.2, 0.3];
  },
};

function gateway() {
  return create_knowledge_gateway({
    vector_port: make_leaky_vector_port(),
    embedding_port,
    embedding_version: EMBED_VERSION,
  });
}

describe("knowledge gateway isolation", () => {
  it("never returns tenant B evidence to tenant A (scope both)", async () => {
    const results = await gateway().search(ctx(TENANT_A), {
      query: "niacinamide",
      scope: "both",
    });
    expect(results.some((r) => r.tenant_id === TENANT_B)).toBe(false);
    expect(
      results.every((r) => r.scope === "platform" || r.tenant_id === TENANT_A),
    ).toBe(true);
    // The mislabeled points never surface.
    expect(results.map((r) => r.point_id)).not.toContain("p-bad");
    expect(results.map((r) => r.point_id)).not.toContain("t-bad");
    expect(results.map((r) => r.point_id)).not.toContain("b1");
  });

  it("tenant scope returns only the caller's own points", async () => {
    const results = await gateway().search(ctx(TENANT_A), {
      query: "niacinamide",
      scope: "tenant",
    });
    expect(results.map((r) => r.point_id)).toEqual(["a1"]);
  });

  it("platform scope returns only genuine platform points", async () => {
    const results = await gateway().search(ctx(TENANT_A), {
      query: "niacinamide",
      scope: "platform",
    });
    expect(results.map((r) => r.point_id)).toEqual(["p1"]);
  });

  it("rejects an empty query", async () => {
    await expect(
      gateway().search(ctx(TENANT_A), { query: "  ", scope: "both" }),
    ).rejects.toMatchObject({ code: "TOOL_INPUT_INVALID" });
  });
});

describe("knowledge source repository tenant scoping", () => {
  let server: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  const SOURCE_A = new ObjectId();
  const SOURCE_B = new ObjectId();
  const SOURCE_PLATFORM = new ObjectId();

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = new MongoClient(server.getUri());
    await client.connect();
    db = client.db("test");
    await db.collection("knowledge_sources").insertMany([
      { _id: SOURCE_A, scope: "tenant", tenantId: TENANT_A, name: "A doc", status: "ready", deletedAt: null },
      { _id: SOURCE_B, scope: "tenant", tenantId: TENANT_B, name: "B doc", status: "ready", deletedAt: null },
      { _id: SOURCE_PLATFORM, scope: "platform", name: "Platform doc", status: "active", deletedAt: null },
    ]);
  });

  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });

  it("returns a tenant-A source to tenant A but never tenant B's", async () => {
    const repo = create_knowledge_source_repository(db);
    expect(await repo.get_source(String(SOURCE_A), "tenant", TENANT_A)).not.toBeNull();
    expect(await repo.get_source(String(SOURCE_B), "tenant", TENANT_A)).toBeNull();
  });

  it("resolves a platform source without a tenant", async () => {
    const repo = create_knowledge_source_repository(db);
    const source = await repo.get_source(String(SOURCE_PLATFORM), "platform", null);
    expect(source?.scope).toBe("platform");
    expect(source?.status).toBe("active");
  });
});
