// tests/import/import-formulas.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { import_formulas } from "../../apps/ai/scripts/import/import-formulas";

let server: MongoMemoryServer;
let client: MongoClient;
beforeAll(async () => { server = await MongoMemoryServer.create(); client = new MongoClient(server.getUri()); await client.connect(); });
afterAll(async () => { await client.close(); await server.stop(); });

describe("import_formulas", () => {
  const formulas = [{ rd_formula_id: "11", product_details_id: "P1", rd_formula_version: "2", rd_formula_detail: "Serum A", record_status: "1" }];
  const lines = [
    { rd_formula_id: "11", rmit_code: "RC1", rmit_inci_name: "Niacinamide", rm_part: "4", line_number: "1" },
    { rd_formula_id: "11", rmit_code: "RC2", rmit_inci_name: "Aqua", rm_part: "96", line_number: "2" },
  ];

  it("upserts formulas idempotently and reports unmatched materials", async () => {
    const db = client.db("f1");
    await db.collection("products").insertOne({ tenantId: "T1", productCode: "RC1" }); // RC2 intentionally missing
    const opts = { db, tenant_id: "T1", actor_profile_id: "A1", dry_run: false };

    const r1 = await import_formulas(formulas, lines, opts);
    expect(await db.collection("formulas").countDocuments({ tenantId: "T1" })).toBe(1);
    expect(r1.report.summary()).toContain("unmatched rm_code");

    await import_formulas(formulas, lines, opts);
    expect(await db.collection("formulas").countDocuments({ tenantId: "T1" })).toBe(1); // idempotent
  });
});
