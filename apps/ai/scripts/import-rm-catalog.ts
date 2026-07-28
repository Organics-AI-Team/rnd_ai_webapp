/**
 * Import the internal raw-material master into a tenant's `products` collection
 * (the ingredient-picker source used by /formulas/create).
 *
 * Source of record: the legacy R&D SQL export `internal_raw/sql_raw/rm_lines.csv`
 * (rm_code, trade_name, inci_name, supplier, rm_cost, company_name). Transform
 * that CSV to JSONL with map_rm_line_to_product() below, then run this importer.
 *
 * Idempotent: replaces the tenant's existing products with the provided set.
 * Usage:
 *   node apps/ai/scripts/import-rm-catalog.js --tenant=<id> --file=<products.jsonl>
 * (.env-free: reads MONGODB_URI / DATABASE_URL from the process env.)
 */
import { readFileSync } from "node:fs";
import { MongoClient } from "mongodb";

/** Map one rm_lines.csv row to a tenant product document. */
export function map_rm_line_to_product(
  row: Record<string, string>,
  tenant_id: string,
  actor_profile_id: string,
): Record<string, unknown> | null {
  const code = (row.rm_code || "").trim();
  const name = (row.trade_name || "").trim();
  if (!code || !name) return null;
  const cost = Number.parseFloat(row.rm_cost || "");
  const price = Number.isFinite(cost) ? Math.round(cost * 1e4) / 1e4 : 0;
  const inci = (row.inci_name || "").trim();
  return {
    tenantId: tenant_id,
    actorProfileId: actor_profile_id,
    ownerProfileId: actor_profile_id,
    productCode: code,
    rm_code: code,
    productName: name,
    trade_name: name,
    INCI_name: inci,
    inci_name: inci,
    supplier: (row.supplier || "").trim(),
    price,
    rm_cost: price,
    company_name: (row.company_name || "").trim(),
    benefits: [],
    usecase: [],
    stockQuantity: 0,
    lowStockThreshold: 10,
    isActive: (row.record_status || "").trim() !== "0",
  };
}

async function run(): Promise<void> {
  const arg = (k: string) =>
    process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? "";
  const tenant = arg("tenant");
  const file = arg("file");
  if (!tenant || !file) throw new Error("need --tenant=<id> --file=<products.jsonl>");
  const uri = process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!uri) throw new Error("MONGODB_URI/DATABASE_URL not set");

  const now = new Date();
  const docs = readFileSync(file, "utf8").trim().split("\n").map((l) => {
    const d = JSON.parse(l);
    return { ...d, tenantId: tenant, createdAt: now, updatedAt: now };
  });

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const products = client.db().collection("products");
    const deleted = (await products.deleteMany({ tenantId: tenant })).deletedCount;
    const inserted = (await products.insertMany(docs, { ordered: false })).insertedCount;
    const total = await products.countDocuments({ tenantId: tenant });
    console.log(`import-rm-catalog — deleted=${deleted} inserted=${inserted} total=${total}`);
  } finally {
    await client.close();
  }
}

if (process.argv[1]?.endsWith("import-rm-catalog.ts") || process.argv[1]?.endsWith("import-rm-catalog.js")) {
  run().catch((e) => { console.error("import-rm-catalog failed:", e.message ?? e); process.exitCode = 1; });
}
