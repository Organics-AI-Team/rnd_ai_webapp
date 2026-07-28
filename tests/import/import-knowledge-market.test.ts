// tests/import/import-knowledge-market.test.ts
import { describe, it, expect } from "vitest";
import { import_market_knowledge } from "../../apps/ai/scripts/import/import-knowledge-market";
import type { KnowledgeQdrantPoint } from "../../apps/ai/server/services/knowledge/qdrant-collections";

/** Recording fake for the platform upsert port. */
function fake_vector_port() {
  const upserts: KnowledgeQdrantPoint[][] = [];
  return {
    upserts,
    port: {
      async upsert_platform(points: readonly KnowledgeQdrantPoint[]) {
        upserts.push([...points]);
      },
    },
  };
}

/** Deterministic fake embedder returning 3-dim vectors. */
function fake_embed_many(calls: string[][]) {
  return async (texts: string[]): Promise<number[][]> => {
    calls.push([...texts]);
    return texts.map((_, index) => [index + 1, 0, 0]);
  };
}

const row = (sku: string, name = `Product ${sku}`) => ({
  name,
  sku,
  url: `https://example.com/${sku}`,
  description: "desc",
  benefits: "",
  usage: "",
  inci_name: "",
  usage_percent_lo: "",
  usage_percent_hi: "",
  usage_percent_best: "",
  category: "",
  price: "",
});

describe("import_market_knowledge", () => {
  it("embeds and upserts batches, skipping unidentifiable and duplicate rows", async () => {
    const { upserts, port } = fake_vector_port();
    const embed_calls: string[][] = [];
    const batches = [
      [row("1"), row("2"), { ...row(""), url: "", id_product: "" }],
      [row("2"), row("3")], // duplicate sku 2 skipped
    ];
    const result = await import_market_knowledge(batches, {
      vector_port: port,
      embed_many: fake_embed_many(embed_calls),
      embedding_version: "v1",
      dry_run: false,
      start_row: 0,
    });
    expect(result.points_upserted).toBe(3);
    expect(upserts.flat().map((p) => p.payload.source_id)).toEqual([
      "myskin:1",
      "myskin:2",
      "myskin:3",
    ]);
    expect(embed_calls).toHaveLength(2);
    expect(result.report.summary()).toContain("skipped=2");
    expect(result.next_row).toBe(5);
  });

  it("resumes past start_row without re-embedding earlier rows", async () => {
    const { upserts, port } = fake_vector_port();
    const embed_calls: string[][] = [];
    const batches = [[row("1"), row("2")], [row("3"), row("4")]];
    const result = await import_market_knowledge(batches, {
      vector_port: port,
      embed_many: fake_embed_many(embed_calls),
      embedding_version: "v1",
      dry_run: false,
      start_row: 2,
    });
    expect(upserts.flat().map((p) => p.payload.source_id)).toEqual(["myskin:3", "myskin:4"]);
    expect(embed_calls).toHaveLength(1);
    expect(result.next_row).toBe(4);
  });

  it("dry_run parses and reports without embedding or upserting", async () => {
    const { upserts, port } = fake_vector_port();
    const embed_calls: string[][] = [];
    const progress: number[] = [];
    const result = await import_market_knowledge([[row("1"), row("2")]], {
      vector_port: port,
      embed_many: fake_embed_many(embed_calls),
      embedding_version: "v1",
      dry_run: true,
      start_row: 0,
      on_batch_done: (next_row) => {
        progress.push(next_row);
      },
    });
    expect(upserts).toHaveLength(0);
    expect(embed_calls).toHaveLength(0);
    expect(result.points_upserted).toBe(2); // would-upsert count
    expect(progress).toEqual([2]);
  });
});
