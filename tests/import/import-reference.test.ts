// tests/import/import-reference.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { import_reference } from "../../apps/ai/scripts/import/import-reference";

let server: MongoMemoryServer;
let client: MongoClient;
beforeAll(async () => { server = await MongoMemoryServer.create(); client = new MongoClient(server.getUri()); await client.connect(); });
afterAll(async () => { await client.close(); await server.stop(); });

describe("import_reference", () => {
  const cosing = [{ INCI_name: "NIACINAMIDE", CAS_No: "98-92-0", Function: "SKIN CONDITIONING", Restriction: "", Chem_IUPAC_Name_Description: "Vitamin B3" }];
  const inci_lines = [{ en_name: "Ethyl alcohol", cas_no: "64-17-5", fda_number: "AP-1" }];

  it("upserts a merged INCI reference and is idempotent", async () => {
    const db = client.db("r1");
    const opts = { db, dry_run: false };
    await import_reference(cosing, inci_lines, opts);
    expect(await db.collection("inci_reference").countDocuments()).toBe(2);
    const nia = await db.collection("inci_reference").findOne({ inci: "niacinamide" });
    expect(nia?.cas_no).toBe("98-92-0");
    expect(nia?.functions).toEqual(["skin conditioning"]);
    await import_reference(cosing, inci_lines, opts);
    expect(await db.collection("inci_reference").countDocuments()).toBe(2); // no dup
  });
});
