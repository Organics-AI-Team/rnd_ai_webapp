// tests/import/map-knowledge.test.ts
import { describe, it, expect } from "vitest";
import {
  build_platform_knowledge_point,
  build_tenant_knowledge_point,
  knowledge_point_id,
  map_formula_doc,
  map_myskin_row,
} from "../../apps/ai/scripts/import/map-knowledge";
import {
  payload_is_platform,
  payload_is_tenant_owned,
} from "../../apps/ai/server/services/knowledge/qdrant-collections";

const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

describe("map_myskin_row", () => {
  const row = {
    name: "Niacinamide PC",
    sku: "224127",
    url: "https://example.com/p/224127",
    description: "Vitamin B3 active for brightening.",
    benefits: "brightening, barrier support",
    inci_name: "Niacinamide",
    usage_percent_lo: "2.0",
    usage_percent_hi: "5.0",
    usage_percent_best: "4.0",
    category: "actives",
    usage: "",
    price: "850",
  };

  it("builds a stable source id and a compact labeled text", () => {
    const doc = map_myskin_row(row)!;
    expect(doc.source_id).toBe("myskin:224127");
    expect(doc.locator).toContain("Niacinamide PC");
    expect(doc.text).toContain("Market product: Niacinamide PC");
    expect(doc.text).toContain("INCI: Niacinamide");
    expect(doc.text).toContain("Usage percent: 2.0–5.0 (best 4.0)");
    expect(doc.text.length).toBeLessThanOrEqual(6_000);
  });

  it("returns null without a sku/id/url key or a name", () => {
    expect(map_myskin_row({ ...row, sku: "", url: "", id_product: "" })).toBeNull();
    expect(map_myskin_row({ ...row, name: "" })).toBeNull();
  });
});

describe("map_formula_doc", () => {
  it("renders the formula header and its lines", () => {
    const doc = map_formula_doc({
      rd_formula_id: "11",
      name: "Serum A",
      version: 2,
      productKey: "P1",
      lines: [
        { rm_code: "RC1", inci_name: "Niacinamide", percentage: 4, amount: 4, line_number: 1 },
        { rm_code: "RC2", inci_name: "Aqua", percentage: 96, amount: 96, line_number: 2 },
      ],
    })!;
    expect(doc.source_id).toBe("formula:11");
    expect(doc.text).toContain("Internal formula: Serum A (v2)");
    expect(doc.text).toContain("- RC1 Niacinamide 4%");
    expect(map_formula_doc({ rd_formula_id: "", name: "x" })).toBeNull();
  });
});

describe("governed point builders", () => {
  const doc = { source_id: "myskin:1", locator: "A — https://x", text: "Market product: A" };
  const vector = [0.1, 0.2, 0.3];

  it("builds a platform point satisfying the platform payload contract", () => {
    const point = build_platform_knowledge_point(doc, vector, "v1");
    expect(point.id).toMatch(UUID_RE);
    expect(point.vector).toEqual(vector);
    expect(payload_is_platform(point.payload)).toBe(true);
    expect(point.payload).not.toHaveProperty("tenant_id");
    expect(point.payload.source_id).toBe("myskin:1");
    expect(String(point.payload.content_hash)).toMatch(/^[a-f0-9]{64}$/);
    expect(point.payload.visibility).toBe("all_members");
    expect(point.payload.content).toBe(doc.text);
    expect(point.payload.locator).toBe(doc.locator);
    expect(point.payload.embedding_version).toBe("v1");
  });

  it("builds a tenant point owned by exactly that tenant", () => {
    const point = build_tenant_knowledge_point("T1", doc, vector, "v1");
    expect(point.id).toMatch(UUID_RE);
    expect(payload_is_tenant_owned(point.payload, "T1")).toBe(true);
    expect(payload_is_tenant_owned(point.payload, "T2")).toBe(false);
  });

  it("derives deterministic ids (idempotent upsert key)", () => {
    expect(knowledge_point_id("myskin:1", 0)).toBe(knowledge_point_id("myskin:1", 0));
    expect(knowledge_point_id("myskin:1", 0)).not.toBe(knowledge_point_id("myskin:2", 0));
  });
});
