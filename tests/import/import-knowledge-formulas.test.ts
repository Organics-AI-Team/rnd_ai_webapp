// tests/import/import-knowledge-formulas.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { import_formula_knowledge } from "../../apps/ai/scripts/import/import-knowledge-formulas";
import type { KnowledgeQdrantPoint } from "../../apps/ai/server/services/knowledge/qdrant-collections";

let server: MongoMemoryServer;
let client: MongoClient;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
});
afterAll(async () => {
  await client.close();
  await server.stop();
});

/** Recording fake for the governed tenant upsert port. */
function fake_tenant_port() {
  const upserts: Array<{ tenant_id: string; points: KnowledgeQdrantPoint[] }> = [];
  return {
    upserts,
    port: {
      async upsert_tenant(
        context: { readonly tenant_id: string },
        points: readonly KnowledgeQdrantPoint[],
      ) {
        upserts.push({ tenant_id: context.tenant_id, points: [...points] });
      },
    },
  };
}

describe("import_formula_knowledge", () => {
  it("ingests ONLY the target tenant's formulas as tenant-scoped points", async () => {
    const db = client.db("fk1");
    await db.collection("formulas").insertMany([
      { tenantId: "T1", rd_formula_id: "11", name: "Serum A", version: 2, productKey: "P1", lines: [{ rm_code: "RC1", inci_name: "Niacinamide", percentage: 4 }] },
      { tenantId: "T1", rd_formula_id: "12", name: "Cream B", version: 1, productKey: "P2", lines: [] },
      { tenantId: "T2", rd_formula_id: "99", name: "Other tenant", version: 1, productKey: "PX", lines: [] },
      { tenantId: "T1", rd_formula_id: "", name: "no id", version: 1, productKey: "P3", lines: [] },
    ]);
    const { upserts, port } = fake_tenant_port();
    const embed_calls: string[][] = [];
    const result = await import_formula_knowledge(db, {
      vector_port: port,
      embed_many: async (texts) => {
        embed_calls.push([...texts]);
        return texts.map(() => [1, 0]);
      },
      embedding_version: "v1",
      tenant_id: "T1",
      batch_size: 10,
      dry_run: false,
    });
    expect(result.points_upserted).toBe(2);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.tenant_id).toBe("T1");
    const source_ids = upserts[0]!.points.map((p) => p.payload.source_id).sort();
    expect(source_ids).toEqual(["formula:11", "formula:12"]);
    expect(upserts[0]!.points.every((p) => p.payload.tenant_id === "T1")).toBe(true);
    expect(result.report.summary()).toContain("skipped=1");
    expect(embed_calls).toHaveLength(1);
  });

  it("dry_run reads and reports without embedding or upserting", async () => {
    const db = client.db("fk1");
    const { upserts, port } = fake_tenant_port();
    const result = await import_formula_knowledge(db, {
      vector_port: port,
      embed_many: async () => {
        throw new Error("must not embed in dry-run");
      },
      embedding_version: "v1",
      tenant_id: "T1",
      batch_size: 10,
      dry_run: true,
    });
    expect(upserts).toHaveLength(0);
    expect(result.points_upserted).toBe(2);
  });
});
