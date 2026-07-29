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
  create_qdrant_knowledge_adapter,
  KNOWLEDGE_PAYLOAD_INDEXES,
  PLATFORM_FILTER,
  platform_collection,
  tenant_filter,
  tenant_collection,
  type KnowledgeQdrantDriver,
} from "../../apps/ai/server/services/knowledge/qdrant-collections";
import {
  create_ingestion_source_port,
  create_knowledge_source_repository,
} from "../../apps/ai/server/repositories/knowledge-source-repository";

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
        locator: "platform:1",
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
        locator: "tenant-a:1",
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
        locator: "tenant-b:1",
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
    async search_platform() {
      return platform;
    },
    async search_tenant() {
      return tenant;
    },
  };
}

const embedding_port = {
  async embed(): Promise<readonly number[]> {
    return [0.1, 0.2, 0.3];
  },
};

function gateway(
  access_policy = {
    async authorize() {},
  },
) {
  return create_knowledge_gateway({
    vector_port: make_leaky_vector_port(),
    embedding_port,
    access_policy,
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

  it("authorizes the requested scope before embedding or vector retrieval", async () => {
    let policy_calls = 0;
    const denied = gateway({
      async authorize(context, scope) {
        policy_calls += 1;
        expect(context.tenant_id).toBe(TENANT_A);
        expect(scope).toBe("tenant");
        throw new Error("tenant knowledge disabled by effective policy");
      },
    });

    await expect(
      denied.search(ctx(TENANT_A), { query: "niacinamide", scope: "tenant" }),
    ).rejects.toThrow("tenant knowledge disabled by effective policy");
    expect(policy_calls).toBe(1);
  });
});

/** A raw driver fake that records the server-authored Qdrant operations. */
function make_qdrant_driver() {
  const calls = {
    collections: [] as Array<Record<string, unknown>>,
    searches: [] as Array<{
      collection_name: string;
      options: Record<string, unknown>;
    }>,
    upserts: [] as Array<{
      collection_name: string;
      points: Array<Record<string, unknown>>;
    }>,
    deletes: [] as Array<{
      collection_name: string;
      filter: Record<string, unknown>;
    }>,
  };
  const driver: KnowledgeQdrantDriver = {
    async ensure_collection(definition) {
      calls.collections.push(definition as unknown as Record<string, unknown>);
    },
    async search(collection_name, _vector, options) {
      calls.searches.push({
        collection_name,
        options: options as unknown as Record<string, unknown>,
      });
      return [];
    },
    async upsert(collection_name, points) {
      calls.upserts.push({
        collection_name,
        points: points as unknown as Array<Record<string, unknown>>,
      });
    },
    async delete(collection_name, filter) {
      calls.deletes.push({ collection_name, filter });
    },
  };
  return { calls, driver };
}

/** Build a valid tenant knowledge point. */
function tenant_point(tenant_id = TENANT_A) {
  return {
    id: "point-a",
    vector: [0.1, 0.2, 0.3],
    payload: {
      tenant_id,
      is_tenant: true,
      source_id: "source-a",
      content_hash: "a".repeat(64),
      visibility: "managers",
      content: "tenant evidence",
      locator: "page:1",
    },
  };
}

describe("governed Qdrant adapter", () => {
  it("creates versioned collections with all keyword indexes and a tenant index", async () => {
    const { calls, driver } = make_qdrant_driver();
    const adapter = create_qdrant_knowledge_adapter({
      driver,
      embedding_version: EMBED_VERSION,
      vector_size: 3,
    });

    await adapter.ensure_collections();

    expect(calls.collections.map((definition) => definition.name)).toEqual([
      platform_collection(EMBED_VERSION),
      tenant_collection(EMBED_VERSION),
    ]);
    for (const definition of calls.collections) {
      expect(
        (definition.payload_indexes as Array<{ field_name: string }>).map(
          (index) => index.field_name,
        ),
      ).toEqual(KNOWLEDGE_PAYLOAD_INDEXES);
      expect(
        (definition.payload_indexes as Array<{ field_schema: unknown }>).every(
          (index) =>
            index.field_schema === "keyword" ||
            (index.field_schema as { type?: string }).type === "keyword",
        ),
      ).toBe(true);
    }
    const tenant_definition = calls.collections[1];
    const tenant_id_index = (
      tenant_definition.payload_indexes as Array<{
        field_name: string;
        field_schema: unknown;
      }>
    ).find((index) => index.field_name === "tenant_id");
    expect(tenant_id_index?.field_schema).toEqual({
      type: "keyword",
      is_tenant: true,
    });
  });

  it("authors collection names and filters internally for governed searches", async () => {
    const { calls, driver } = make_qdrant_driver();
    const adapter = create_qdrant_knowledge_adapter({
      driver,
      embedding_version: EMBED_VERSION,
      vector_size: 3,
    });

    await adapter.search_platform([0.1, 0.2, 0.3], 5);
    await adapter.search_tenant(ctx(TENANT_A), [0.1, 0.2, 0.3], 6);

    expect(calls.searches).toEqual([
      {
        collection_name: platform_collection(EMBED_VERSION),
        options: { topK: 5, filter: PLATFORM_FILTER, withPayload: true },
      },
      {
        collection_name: tenant_collection(EMBED_VERSION),
        options: {
          topK: 6,
          filter: tenant_filter(TENANT_A),
          withPayload: true,
        },
      },
    ]);
    expect(Object.keys(adapter).sort()).toEqual([
      "delete_platform_source",
      "delete_tenant_source",
      "ensure_collections",
      "search_platform",
      "search_tenant",
      "upsert_platform",
      "upsert_tenant",
    ]);
  });

  it("rejects payloads that violate the platform or tenant collection contract", async () => {
    const { calls, driver } = make_qdrant_driver();
    const adapter = create_qdrant_knowledge_adapter({
      driver,
      embedding_version: EMBED_VERSION,
      vector_size: 3,
    });

    await expect(
      adapter.upsert_tenant(ctx(TENANT_A), [tenant_point(TENANT_B)]),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_PAYLOAD_INVALID" });
    await expect(
      adapter.upsert_platform([
        {
          ...tenant_point(TENANT_A),
          payload: { ...tenant_point(TENANT_A).payload, is_tenant: false },
        },
      ]),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_PAYLOAD_INVALID" });
    await expect(
      adapter.upsert_platform([
        {
          ...tenant_point(TENANT_A),
          payload: {
            ...tenant_point(TENANT_A).payload,
            is_tenant: false,
            tenant_id: null,
          },
        },
      ]),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_PAYLOAD_INVALID" });
    expect(calls.upserts).toHaveLength(0);
  });

  it("upserts valid points and cleans up only source points in the verified tenant", async () => {
    const { calls, driver } = make_qdrant_driver();
    const adapter = create_qdrant_knowledge_adapter({
      driver,
      embedding_version: EMBED_VERSION,
      vector_size: 3,
    });

    await adapter.upsert_tenant(ctx(TENANT_A), [tenant_point()]);
    await adapter.delete_tenant_source(ctx(TENANT_A), "source-a");

    expect(calls.upserts[0]?.collection_name).toBe(
      tenant_collection(EMBED_VERSION),
    );
    expect(calls.deletes).toEqual([
      {
        collection_name: tenant_collection(EMBED_VERSION),
        filter: {
          must: [
            ...tenant_filter(TENANT_A).must,
            { key: "source_id", match: { value: "source-a" } },
          ],
        },
      },
    ]);
  });
});

describe("knowledge source repository tenant scoping", () => {
  let server: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  const SOURCE_A = new ObjectId();
  const SOURCE_B = new ObjectId();
  const SOURCE_PLATFORM = new ObjectId();
  const SOURCE_UPLOAD = new ObjectId();

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = new MongoClient(server.getUri());
    await client.connect();
    db = client.db("test");
    await db.collection("knowledge_sources").insertMany([
      { _id: SOURCE_A, scope: "tenant", tenantId: TENANT_A, name: "A doc", status: "ready", deletedAt: null },
      { _id: SOURCE_B, scope: "tenant", tenantId: TENANT_B, name: "B doc", status: "ready", deletedAt: null },
      { _id: SOURCE_PLATFORM, scope: "platform", name: "Platform doc", status: "active", deletedAt: null },
      {
        _id: SOURCE_UPLOAD,
        scope: "tenant",
        tenantId: TENANT_A,
        name: "Upload doc",
        status: "pending",
        contentHash: "a".repeat(64),
        visibility: "managers",
        provenance: { origin: "tenant upload" },
        consentBasis: "tenant-owned",
        deletedAt: null,
      },
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

  it("binds an upload only to the verified tenant and moves it into quarantine", async () => {
    const repo = create_knowledge_source_repository(db);
    const object_key = `tenants/${TENANT_A}/knowledge/${SOURCE_UPLOAD}/source`;
    await repo.bind_upload(
      { tenant_id: TENANT_A, actor_profile_id: "actor-a" },
      String(SOURCE_UPLOAD),
      object_key,
    );

    const stored = await db
      .collection("knowledge_sources")
      .findOne({ _id: SOURCE_UPLOAD });
    expect(stored).toMatchObject({
      tenantId: TENANT_A,
      objectKey: object_key,
      status: "quarantined",
    });
    await expect(
      repo.bind_upload(
        { tenant_id: TENANT_B, actor_profile_id: "actor-b" },
        String(SOURCE_UPLOAD),
        `tenants/${TENANT_B}/knowledge/${SOURCE_UPLOAD}/source`,
      ),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SOURCE_NOT_FOUND" });
  });

  it("persists the tenant-scoped ingestion claim and safe ready metadata", async () => {
    const repo = create_knowledge_source_repository(db);
    const ingestion_port = create_ingestion_source_port(repo);
    const tenant_context = ctx(TENANT_A);
    const versions = {
      parser_version: "pdf-parser-v2",
      chunker_version: "semantic-chunker-v3",
      embedding_version: "v1",
    };

    expect(
      await ingestion_port.claim_ingestion(
        tenant_context,
        String(SOURCE_UPLOAD),
        "request-0001",
        versions,
      ),
    ).toBe("claimed");
    await ingestion_port.mark_indexing(
      tenant_context,
      String(SOURCE_UPLOAD),
    );
    await ingestion_port.mark_ready(tenant_context, String(SOURCE_UPLOAD), {
      ...versions,
      indexed_points: 2,
      detected_mime: "application/pdf",
      byte_size: 500,
      content_hash: "a".repeat(64),
      idempotency_key: "request-0001",
    });

    const stored = await db
      .collection("knowledge_sources")
      .findOne({ _id: SOURCE_UPLOAD });
    expect(stored).toMatchObject({
      tenantId: TENANT_A,
      status: "ready",
      parserVersion: "pdf-parser-v2",
      chunkerVersion: "semantic-chunker-v3",
      embeddingVersion: "v1",
      ingestionIdempotencyKey: "request-0001",
      detectedMime: "application/pdf",
      indexedPoints: 2,
      errorCode: null,
    });
  });
});
