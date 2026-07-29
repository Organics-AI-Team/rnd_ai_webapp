// tests/import/import-materials.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { import_materials } from "../../apps/ai/scripts/import/import-materials";
import { build_enrichment_index } from "../../apps/ai/scripts/import/lib/enrich";

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

describe("import_materials", () => {
  const rows = [
    { rm_code: "RC1", trade_name: "Niacinamide PC", inci_name: "Niacinamide", supplier: "DSM", rm_cost: "850", record_status: "1", company_name: "Org" },
    { rm_code: "", trade_name: "bad", inci_name: "", supplier: "", rm_cost: "", record_status: "1", company_name: "" },
  ];
  const index = build_enrichment_index(
    [{ INCI_name: "NIACINAMIDE", CAS_No: "98-92-0", Function: "SKIN CONDITIONING", Restriction: "", Chem_IUPAC_Name_Description: "" }],
    [],
  );

  it("upserts valid rows, skips invalid, and is idempotent", async () => {
    const db = client.db("t1");
    const opts = { db, tenant_id: "T1", actor_profile_id: "A1", dry_run: false };

    const first = await import_materials(rows, index, opts);
    expect(first.upserted_total).toBe(1);
    expect(await db.collection("products").countDocuments({ tenantId: "T1" })).toBe(1);
    const doc = await db.collection("products").findOne({ productCode: "RC1" });
    expect(doc?.cas_no).toBe("98-92-0");

    const second = await import_materials(rows, index, opts);
    expect(await db.collection("products").countDocuments({ tenantId: "T1" })).toBe(1); // no dup
    expect(second.upserted_total).toBe(1);
  });

  it("dry_run writes nothing", async () => {
    const db = client.db("t2");
    await import_materials(rows, index, { db, tenant_id: "T2", actor_profile_id: "A1", dry_run: true });
    expect(await db.collection("products").countDocuments({ tenantId: "T2" })).toBe(0);
  });
});
