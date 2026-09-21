# Chem/Formula Data Pipeline (Plan 1 of 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ad-hoc catalog import with a versioned, idempotent, one-command Mongo data pipeline that loads and enriches raw materials, INCI/CosIng reference, and historical formulas from the legacy `rnd_ai` export into `rd_ai_gen2`'s tenant-scoped collections.

**Architecture:** A set of small, single-purpose TypeScript modules under `apps/ai/scripts/import/` (config + CSV/enrich/report libs + one importer per dataset + an ordered `import:all`). Every importer is idempotent (upsert by natural key), supports `--dry-run`, and prints an integrity report. Driven by `import.config.ts` (paths/tenant/actor from env), not hardcoding. Reuses the tenant-scoped `product-repository`/`formula-repository` and the `@rnd-ai/shared-database` mongo client.

**Tech Stack:** TypeScript (ESM), `tsx` runner, `csv-parse` (already a dep), `mongodb` driver via `@rnd-ai/shared-database`, `vitest` (`npm run test`), `mongodb-memory-server` for integration tests.

**Scope:** Plan 1 covers the Mongo relational data (spec §5 milestones M1–M2). Qdrant knowledge ingest (M3) and the agentic generator (M4–M5) are Plan 2.

**Spec:** `docs/superpowers/specs/2026-07-28-agentic-formula-generator-design.md`

---

## File Structure

```
apps/ai/scripts/import/
  import.config.ts        # dataset → {source path, natural key}; tenant/actor/paths from env
  lib/
    csv.ts                # read_csv_records(path) → Record<string,string>[] (robust, multiline-safe)
    enrich.ts             # build_inci_index(...) + enrich_material(...) (CAS, functions/benefits, restriction)
    report.ts             # ImportReport: counters + printable summary
  map-material.ts         # map_rm_line_to_product(row, enrichIndex, tenant, actor)
  map-formula.ts          # group_formula_lines(...) → header + linked lines (latest version per product)
  import-materials.ts     # M1: products (enriched), idempotent upsert, --dry-run
  import-reference.ts     # M2: inci_reference (platform-global), idempotent
  import-formulas.ts      # M2: formulas (+lines) linked to products by rm_code, latest version
  import-all.ts           # ordered: reference → materials → formulas; single report
docs/import/README.md     # runbook: where the export lives, commands, expected counts
tests/import/
  csv.test.ts
  enrich.test.ts
  map-material.test.ts
  map-formula.test.ts
  import-materials.test.ts   # integration (mongodb-memory-server)
  import-formulas.test.ts    # integration
```

**Config convention:** the legacy export is an external drop-in. `import.config.ts` reads its root from `RND_EXPORT_DIR` (default `../rnd_ai` relative to repo root) and the target tenant/actor from `IMPORT_TENANT_ID` / `IMPORT_ACTOR_PROFILE_ID`. Mongo connection comes from `MONGODB_URI`/`DATABASE_URL` (existing).

---

## Task 1: Import config + robust CSV reader

**Files:**
- Create: `apps/ai/scripts/import/import.config.ts`
- Create: `apps/ai/scripts/import/lib/csv.ts`
- Test: `tests/import/csv.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/import/csv.test.ts
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { read_csv_records } from "../../apps/ai/scripts/import/lib/csv";

describe("read_csv_records", () => {
  it("parses a quoted field containing commas and newlines", () => {
    const dir = mkdtempSync(join(tmpdir(), "csv-"));
    const file = join(dir, "t.csv");
    writeFileSync(
      file,
      'code,inci\n"RC1","Aqua, Butylene Glycol"\n"RC2","Line one\nline two"\n',
    );
    const rows = read_csv_records(file);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ code: "RC1", inci: "Aqua, Butylene Glycol" });
    expect(rows[1].inci).toContain("line two");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/import/csv.test.ts`
Expected: FAIL — cannot find module `.../lib/csv`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/ai/scripts/import/lib/csv.ts
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

/**
 * Read a CSV file into plain string records keyed by header.
 * Uses csv-parse in sync mode; handles quoted fields with embedded commas
 * and newlines (the legacy INCI columns rely on this).
 *
 * @param path - Absolute or repo-relative path to the CSV file.
 * @returns One object per data row, values as trimmed strings.
 */
export function read_csv_records(path: string): Record<string, string>[] {
  const text = readFileSync(path, "utf8");
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as Record<string, string>[];
  return records;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/import/csv.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Write the config module**

```typescript
// apps/ai/scripts/import/import.config.ts
import { resolve } from "node:path";

/** Natural-key field used to upsert each dataset idempotently. */
export interface DatasetConfig {
  readonly source: string; // absolute path to the CSV
  readonly natural_key: string; // logical key (for docs/report only)
}

/** Repo-root-relative default location of the legacy rnd_ai export. */
const EXPORT_DIR = resolve(process.env.RND_EXPORT_DIR ?? resolve(process.cwd(), "..", "rnd_ai"));

/** Absolute source paths for each migrated dataset. */
export const DATASETS = {
  rm_lines: { source: resolve(EXPORT_DIR, "internal_raw/sql_raw/rm_lines.csv"), natural_key: "rm_code" },
  inci_lines: { source: resolve(EXPORT_DIR, "internal_raw/sql_raw/inci_lines.csv"), natural_key: "en_name" },
  cosing: { source: resolve(EXPORT_DIR, "inci_datasets/cosing_ingredients_clean_final.csv"), natural_key: "INCI_name" },
  rd_formulas: { source: resolve(EXPORT_DIR, "internal_raw/sql_raw/rd_formulas.csv"), natural_key: "rd_formula_id" },
  rd_formula_lines: { source: resolve(EXPORT_DIR, "internal_raw/sql_raw/rd_formula_lines.csv"), natural_key: "id" },
  formula_masters: { source: resolve(EXPORT_DIR, "internal_raw/sql_raw/formula_masters.csv"), natural_key: "formula_masters_id" },
} as const satisfies Record<string, DatasetConfig>;

/** Required target identity for tenant-scoped imports. */
export function target_identity(): { tenant_id: string; actor_profile_id: string } {
  const tenant_id = process.env.IMPORT_TENANT_ID?.trim();
  const actor_profile_id = process.env.IMPORT_ACTOR_PROFILE_ID?.trim();
  if (!tenant_id || !actor_profile_id) {
    throw new Error("IMPORT_TENANT_ID and IMPORT_ACTOR_PROFILE_ID must be set");
  }
  return { tenant_id, actor_profile_id };
}

/** Mongo connection string from the standard env vars. */
export function mongo_uri(): string {
  const uri = process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!uri) throw new Error("MONGODB_URI or DATABASE_URL must be set");
  return uri;
}

/** True when --dry-run is present on the CLI. */
export function is_dry_run(): boolean {
  return process.argv.includes("--dry-run");
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/ai/scripts/import/import.config.ts apps/ai/scripts/import/lib/csv.ts tests/import/csv.test.ts
git commit -m "feat(import): config + robust CSV reader for the chem data pipeline"
```

---

## Task 2: Enrichment index (CosIng + inci_lines → CAS, functions, restriction)

**Files:**
- Create: `apps/ai/scripts/import/lib/enrich.ts`
- Test: `tests/import/enrich.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/import/enrich.test.ts
import { describe, it, expect } from "vitest";
import { build_enrichment_index, enrich_material } from "../../apps/ai/scripts/import/lib/enrich";

describe("enrichment", () => {
  const cosing = [
    { INCI_name: "NIACINAMIDE", CAS_No: "98-92-0", Function: "SKIN CONDITIONING", Restriction: "", Chem_IUPAC_Name_Description: "Vitamin B3" },
  ];
  const inci_lines = [{ en_name: "Ethyl alcohol", cas_no: "64-17-5" }];

  it("resolves CAS + functions from CosIng by INCI (case-insensitive)", () => {
    const index = build_enrichment_index(cosing, inci_lines);
    const e = enrich_material("Niacinamide", index);
    expect(e.cas_no).toBe("98-92-0");
    expect(e.functions).toEqual(["skin conditioning"]);
    expect(e.description).toBe("Vitamin B3");
  });

  it("falls back to inci_lines CAS when CosIng has none", () => {
    const index = build_enrichment_index([], inci_lines);
    expect(enrich_material("ethyl alcohol", index).cas_no).toBe("64-17-5");
  });

  it("returns empty enrichment for unknown INCI without throwing", () => {
    const index = build_enrichment_index([], []);
    const e = enrich_material("Unobtanium", index);
    expect(e.cas_no).toBe("");
    expect(e.functions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/import/enrich.test.ts`
Expected: FAIL — cannot find module `.../lib/enrich`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/ai/scripts/import/lib/enrich.ts

/** Enrichment fields derived for a material from reference data. */
export interface MaterialEnrichment {
  cas_no: string;
  functions: string[];
  benefits: string[];
  usecase: string[];
  restriction: string;
  description: string;
}

/** Lookup tables keyed by normalized INCI name. */
export interface EnrichmentIndex {
  cosing: Map<string, { cas: string; functions: string[]; restriction: string; description: string }>;
  inci_cas: Map<string, string>;
}

/** Normalize an INCI name for matching (lowercase, collapse spaces). */
function norm(inci: string): string {
  return inci.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Split a CosIng Function cell ("SKIN CONDITIONING, HUMECTANT") into lowercased terms. */
function split_functions(fn: string): string[] {
  return fn
    .split(/[,;/]/)
    .map((f) => f.trim().toLowerCase())
    .filter((f) => f.length > 0);
}

/**
 * Build the enrichment index from CosIng and inci_lines rows.
 *
 * @param cosing - CosIng rows (INCI_name, CAS_No, Function, Restriction, Chem_IUPAC_Name_Description).
 * @param inci_lines - Legacy INCI rows (en_name, cas_no). cas_no "-" is treated as empty.
 * @returns Index consumed by enrich_material.
 */
export function build_enrichment_index(
  cosing: Record<string, string>[],
  inci_lines: Record<string, string>[],
): EnrichmentIndex {
  const cosing_map = new Map<string, { cas: string; functions: string[]; restriction: string; description: string }>();
  for (const r of cosing) {
    const key = norm(r.INCI_name || "");
    if (!key) continue;
    cosing_map.set(key, {
      cas: (r.CAS_No || "").split(",")[0].trim(),
      functions: split_functions(r.Function || ""),
      restriction: (r.Restriction || "").trim(),
      description: (r.Chem_IUPAC_Name_Description || "").trim(),
    });
  }
  const inci_cas = new Map<string, string>();
  for (const r of inci_lines) {
    const key = norm(r.en_name || "");
    const cas = (r.cas_no || "").trim();
    if (key && cas && cas !== "-") inci_cas.set(key, cas);
  }
  return { cosing: cosing_map, inci_cas };
}

/**
 * Enrich one material's INCI name against the index.
 * The material's `inci_name` may hold multiple comma-separated INCIs; the first
 * is used for the primary CAS/function match (multi-INCI blends keep the blend
 * string as-is on the product).
 *
 * @param inci_name - The material's INCI string.
 * @param index - Index from build_enrichment_index.
 * @returns Enrichment fields (empty strings/arrays when unmatched).
 */
export function enrich_material(inci_name: string, index: EnrichmentIndex): MaterialEnrichment {
  const primary = norm((inci_name || "").split(",")[0]);
  const c = index.cosing.get(primary);
  const cas = c?.cas || index.inci_cas.get(primary) || "";
  const functions = c?.functions ?? [];
  return {
    cas_no: cas,
    functions,
    benefits: functions,
    usecase: [],
    restriction: c?.restriction ?? "",
    description: c?.description ?? "",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/import/enrich.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/ai/scripts/import/lib/enrich.ts tests/import/enrich.test.ts
git commit -m "feat(import): enrichment index (CosIng + inci_lines → CAS, functions)"
```

---

## Task 3: Material mapping (rm_lines row + enrichment → product document)

**Files:**
- Create: `apps/ai/scripts/import/map-material.ts`
- Test: `tests/import/map-material.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/import/map-material.test.ts
import { describe, it, expect } from "vitest";
import { map_rm_line_to_product } from "../../apps/ai/scripts/import/map-material";
import { build_enrichment_index } from "../../apps/ai/scripts/import/lib/enrich";

describe("map_rm_line_to_product", () => {
  const index = build_enrichment_index(
    [{ INCI_name: "NIACINAMIDE", CAS_No: "98-92-0", Function: "SKIN CONDITIONING", Restriction: "", Chem_IUPAC_Name_Description: "" }],
    [],
  );
  const base = { rm_code: "RC1", trade_name: "Niacinamide PC", inci_name: "Niacinamide", supplier: "DSM", rm_cost: "850.0", company_name: "Organics", record_status: "1" };

  it("maps canonical + legacy fields and applies enrichment", () => {
    const doc = map_rm_line_to_product(base, index, "T1", "A1")!;
    expect(doc.tenantId).toBe("T1");
    expect(doc.productCode).toBe("RC1");
    expect(doc.productName).toBe("Niacinamide PC");
    expect(doc.INCI_name).toBe("Niacinamide");
    expect(doc.price).toBe(850);
    expect(doc.cas_no).toBe("98-92-0");
    expect(doc.benefits).toEqual(["skin conditioning"]);
    expect(doc.isActive).toBe(true);
  });

  it("returns null when rm_code or trade_name is missing", () => {
    expect(map_rm_line_to_product({ ...base, rm_code: "" }, index, "T1", "A1")).toBeNull();
    expect(map_rm_line_to_product({ ...base, trade_name: "" }, index, "T1", "A1")).toBeNull();
  });

  it("marks record_status 0 inactive", () => {
    const doc = map_rm_line_to_product({ ...base, record_status: "0" }, index, "T1", "A1")!;
    expect(doc.isActive).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/import/map-material.test.ts`
Expected: FAIL — cannot find module `.../map-material`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/ai/scripts/import/map-material.ts
import type { EnrichmentIndex } from "./lib/enrich";
import { enrich_material } from "./lib/enrich";

/** A tenant product document ready for upsert (canonical + legacy aliases). */
export interface ProductImportDoc {
  tenantId: string;
  actorProfileId: string;
  ownerProfileId: string;
  productCode: string;
  rm_code: string;
  productName: string;
  trade_name: string;
  INCI_name: string;
  inci_name: string;
  supplier: string;
  price: number;
  rm_cost: number;
  company_name: string;
  cas_no: string;
  benefits: string[];
  usecase: string[];
  functions: string[];
  restriction: string;
  description: string;
  stockQuantity: number;
  lowStockThreshold: number;
  isActive: boolean;
}

/** Parse a decimal cost string, defaulting to 0. */
function parse_cost(raw: string): number {
  const n = Number.parseFloat(raw || "");
  return Number.isFinite(n) ? Math.round(n * 1e4) / 1e4 : 0;
}

/**
 * Map one rm_lines.csv row to a tenant product document, applying enrichment.
 *
 * @param row - rm_lines row (rm_code, trade_name, inci_name, supplier, rm_cost, company_name, record_status).
 * @param index - Enrichment index (CAS/functions by INCI).
 * @param tenant_id - Target tenant.
 * @param actor_profile_id - Importing actor (stamp).
 * @returns A product doc, or null when rm_code/trade_name is missing.
 */
export function map_rm_line_to_product(
  row: Record<string, string>,
  index: EnrichmentIndex,
  tenant_id: string,
  actor_profile_id: string,
): ProductImportDoc | null {
  const code = (row.rm_code || "").trim();
  const name = (row.trade_name || "").trim();
  if (!code || !name) return null;
  const inci = (row.inci_name || "").trim();
  const price = parse_cost(row.rm_cost);
  const e = enrich_material(inci, index);
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
    cas_no: e.cas_no,
    benefits: e.benefits,
    usecase: e.usecase,
    functions: e.functions,
    restriction: e.restriction,
    description: e.description,
    stockQuantity: 0,
    lowStockThreshold: 10,
    isActive: (row.record_status || "").trim() !== "0",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/import/map-material.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/ai/scripts/import/map-material.ts tests/import/map-material.test.ts
git commit -m "feat(import): rm_lines → enriched tenant product mapping"
```

---

## Task 4: Integrity report utility

**Files:**
- Create: `apps/ai/scripts/import/lib/report.ts`
- Test: `tests/import/report.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/import/report.test.ts
import { describe, it, expect } from "vitest";
import { ImportReport } from "../../apps/ai/scripts/import/lib/report";

describe("ImportReport", () => {
  it("counts and renders a summary", () => {
    const r = new ImportReport("materials");
    r.read(3);
    r.upserted(2);
    r.skipped("missing rm_code");
    const text = r.summary();
    expect(text).toContain("materials");
    expect(text).toContain("read=3");
    expect(text).toContain("upserted=2");
    expect(text).toContain("skipped=1");
    expect(text).toContain("missing rm_code");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/import/report.test.ts`
Expected: FAIL — cannot find module `.../lib/report`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/ai/scripts/import/lib/report.ts

/** Accumulates per-import counters and renders a printable integrity summary. */
export class ImportReport {
  private read_count = 0;
  private upserted_count = 0;
  private readonly skip_reasons = new Map<string, number>();

  /** @param label - Dataset label shown in the summary. */
  constructor(private readonly label: string) {}

  /** Record N rows read from source. */
  read(n: number): void {
    this.read_count += n;
  }

  /** Record N rows upserted to the target. */
  upserted(n: number): void {
    this.upserted_count += n;
  }

  /** Record one skipped row with a reason (reasons are tallied). */
  skipped(reason: string): void {
    this.skip_reasons.set(reason, (this.skip_reasons.get(reason) ?? 0) + 1);
  }

  /** Total number of skipped rows across all reasons. */
  private skip_total(): number {
    let t = 0;
    for (const n of this.skip_reasons.values()) t += n;
    return t;
  }

  /** Render a one-block human-readable summary. */
  summary(): string {
    const reasons = [...this.skip_reasons.entries()].map(([r, n]) => `    - ${r}: ${n}`).join("\n");
    return [
      `[import:${this.label}] read=${this.read_count} upserted=${this.upserted_count} skipped=${this.skip_total()}`,
      reasons,
    ]
      .filter(Boolean)
      .join("\n");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/import/report.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/ai/scripts/import/lib/report.ts tests/import/report.test.ts
git commit -m "feat(import): integrity report utility"
```

---

## Task 5: Materials importer (idempotent upsert, dry-run) — M1

**Files:**
- Create: `apps/ai/scripts/import/import-materials.ts`
- Modify: `apps/ai/package.json` (add `import:materials` script)
- Test: `tests/import/import-materials.test.ts`

- [ ] **Step 1: Write the failing integration test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/import/import-materials.test.ts`
Expected: FAIL — cannot find module `.../import-materials`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/ai/scripts/import/import-materials.ts
import type { Db } from "mongodb";
import type { EnrichmentIndex } from "./lib/enrich";
import { build_enrichment_index } from "./lib/enrich";
import { map_rm_line_to_product } from "./map-material";
import { read_csv_records } from "./lib/csv";
import { ImportReport } from "./lib/report";
import { DATASETS, target_identity, mongo_uri, is_dry_run } from "./import.config";

/** Options for a materials import run. */
export interface MaterialImportOptions {
  db: Db;
  tenant_id: string;
  actor_profile_id: string;
  dry_run: boolean;
}

/** Result of a materials import run. */
export interface MaterialImportResult {
  upserted_total: number;
  report: ImportReport;
}

/**
 * Import raw-material rows into the tenant `products` collection.
 * Idempotent: upsert by (tenantId, productCode). Skips rows missing code/name.
 *
 * @param rows - rm_lines.csv records.
 * @param index - Enrichment index (CAS/functions).
 * @param opts - Target db, tenant/actor, dry-run flag.
 * @returns Upsert total and the integrity report.
 */
export async function import_materials(
  rows: Record<string, string>[],
  index: EnrichmentIndex,
  opts: MaterialImportOptions,
): Promise<MaterialImportResult> {
  const report = new ImportReport("materials");
  report.read(rows.length);
  const products = opts.db.collection("products");
  const now = new Date();
  let upserted_total = 0;
  const seen = new Set<string>();

  for (const row of rows) {
    const doc = map_rm_line_to_product(row, index, opts.tenant_id, opts.actor_profile_id);
    if (!doc) {
      report.skipped("missing rm_code/trade_name");
      continue;
    }
    if (seen.has(doc.productCode)) {
      report.skipped("duplicate rm_code in source");
      continue;
    }
    seen.add(doc.productCode);
    if (!opts.dry_run) {
      await products.updateOne(
        { tenantId: opts.tenant_id, productCode: doc.productCode },
        { $set: { ...doc, updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true },
      );
    }
    upserted_total += 1;
    report.upserted(1);
  }
  return { upserted_total, report };
}

/** CLI entry: read rm_lines + reference, enrich, import, print report. */
async function run_cli(): Promise<void> {
  const { default: client_promise } = await import("@rnd-ai/shared-database");
  void mongo_uri(); // validate env early
  const { tenant_id, actor_profile_id } = target_identity();
  const cosing = read_csv_records(DATASETS.cosing.source);
  const inci_lines = read_csv_records(DATASETS.inci_lines.source);
  const index = build_enrichment_index(cosing, inci_lines);
  const rows = read_csv_records(DATASETS.rm_lines.source);
  const client = await client_promise;
  try {
    const { report } = await import_materials(rows, index, {
      db: client.db(),
      tenant_id,
      actor_profile_id,
      dry_run: is_dry_run(),
    });
    console.log(report.summary());
    if (is_dry_run()) console.log("[import:materials] dry-run — no writes performed");
  } finally {
    await client.close();
  }
}

if (process.argv[1]?.includes("import-materials")) {
  run_cli().catch((e) => {
    console.error("[import:materials] failed:", e?.message ?? e);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/import/import-materials.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the npm script**

In `apps/ai/package.json`, add to `"scripts"`:

```json
"import:materials": "tsx scripts/import/import-materials.ts"
```

- [ ] **Step 6: Verify the script resolves (dry-run against env)**

Run: `IMPORT_TENANT_ID=x IMPORT_ACTOR_PROFILE_ID=y MONGODB_URI=mongodb://localhost:1 npm run import:materials -w apps/ai -- --dry-run`
Expected: prints an `[import:materials] read=… upserted=… skipped=…` summary from the real `rm_lines.csv` (requires the `rnd_ai` export present at `RND_EXPORT_DIR`), then "dry-run — no writes performed". If the export is absent, it fails fast with a clear path error — acceptable for this step.

- [ ] **Step 7: Commit**

```bash
git add apps/ai/scripts/import/import-materials.ts apps/ai/package.json tests/import/import-materials.test.ts
git commit -m "feat(import): idempotent enriched materials importer (npm run import:materials)"
```

---

## Task 6: INCI/CosIng reference importer (platform-global) — M2

**Files:**
- Create: `apps/ai/scripts/import/import-reference.ts`
- Modify: `apps/ai/package.json` (add `import:reference`)
- Test: `tests/import/import-reference.test.ts`

- [ ] **Step 1: Write the failing integration test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/import/import-reference.test.ts`
Expected: FAIL — cannot find module `.../import-reference`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/ai/scripts/import/import-reference.ts
import type { Db } from "mongodb";
import { read_csv_records } from "./lib/csv";
import { ImportReport } from "./lib/report";
import { DATASETS, mongo_uri, is_dry_run } from "./import.config";

/** Options for a reference import run. */
export interface ReferenceImportOptions {
  db: Db;
  dry_run: boolean;
}

/** Normalize an INCI name (lowercase, collapse spaces). */
function norm(s: string): string {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Import the platform-global `inci_reference` collection from CosIng + inci_lines.
 * Keyed by normalized INCI; CosIng is authoritative, inci_lines fills CAS gaps.
 * Not tenant-scoped (public reference data).
 *
 * @param cosing - CosIng rows.
 * @param inci_lines - Legacy INCI rows.
 * @param opts - Target db, dry-run flag.
 * @returns The integrity report.
 */
export async function import_reference(
  cosing: Record<string, string>[],
  inci_lines: Record<string, string>[],
  opts: ReferenceImportOptions,
): Promise<ImportReport> {
  const report = new ImportReport("reference");
  report.read(cosing.length + inci_lines.length);
  const col = opts.db.collection("inci_reference");
  const now = new Date();
  const merged = new Map<string, Record<string, unknown>>();

  for (const r of cosing) {
    const inci = norm(r.INCI_name || "");
    if (!inci) { report.skipped("missing INCI"); continue; }
    merged.set(inci, {
      inci,
      inci_name: (r.INCI_name || "").trim(),
      cas_no: (r.CAS_No || "").split(",")[0].trim(),
      functions: (r.Function || "").split(/[,;/]/).map((f) => f.trim().toLowerCase()).filter(Boolean),
      restriction: (r.Restriction || "").trim(),
      description: (r.Chem_IUPAC_Name_Description || "").trim(),
      fda_number: "",
    });
  }
  for (const r of inci_lines) {
    const inci = norm(r.en_name || "");
    if (!inci) { report.skipped("missing INCI"); continue; }
    const existing = merged.get(inci) ?? { inci, inci_name: (r.en_name || "").trim(), cas_no: "", functions: [], restriction: "", description: "", fda_number: "" };
    const cas = (r.cas_no || "").trim();
    if (!existing.cas_no && cas && cas !== "-") existing.cas_no = cas;
    existing.fda_number = (r.fda_number || "").trim();
    merged.set(inci, existing);
  }

  if (!opts.dry_run) {
    for (const [inci, doc] of merged) {
      await col.updateOne({ inci }, { $set: { ...doc, updatedAt: now } }, { upsert: true });
      report.upserted(1);
    }
  } else {
    for (const _ of merged) report.upserted(1);
  }
  return report;
}

/** CLI entry. */
async function run_cli(): Promise<void> {
  const { default: client_promise } = await import("@rnd-ai/shared-database");
  void mongo_uri();
  const cosing = read_csv_records(DATASETS.cosing.source);
  const inci_lines = read_csv_records(DATASETS.inci_lines.source);
  const client = await client_promise;
  try {
    const report = await import_reference(cosing, inci_lines, { db: client.db(), dry_run: is_dry_run() });
    console.log(report.summary());
  } finally {
    await client.close();
  }
}

if (process.argv[1]?.includes("import-reference")) {
  run_cli().catch((e) => { console.error("[import:reference] failed:", e?.message ?? e); process.exitCode = 1; });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/import/import-reference.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Add the npm script**

In `apps/ai/package.json` `"scripts"`:

```json
"import:reference": "tsx scripts/import/import-reference.ts"
```

- [ ] **Step 6: Commit**

```bash
git add apps/ai/scripts/import/import-reference.ts apps/ai/package.json tests/import/import-reference.test.ts
git commit -m "feat(import): platform-global inci_reference importer (npm run import:reference)"
```

---

## Task 7: Formulas importer (latest version per product, linked by rm_code) — M2

**Files:**
- Create: `apps/ai/scripts/import/map-formula.ts`
- Create: `apps/ai/scripts/import/import-formulas.ts`
- Modify: `apps/ai/package.json` (add `import:formulas`)
- Test: `tests/import/map-formula.test.ts`, `tests/import/import-formulas.test.ts`

- [ ] **Step 1: Write the failing mapping test**

```typescript
// tests/import/map-formula.test.ts
import { describe, it, expect } from "vitest";
import { group_latest_formulas } from "../../apps/ai/scripts/import/map-formula";

describe("group_latest_formulas", () => {
  const formulas = [
    { rd_formula_id: "10", product_details_id: "P1", rd_formula_version: "1", rd_formula_detail: "Serum A v1" },
    { rd_formula_id: "11", product_details_id: "P1", rd_formula_version: "2", rd_formula_detail: "Serum A v2" },
  ];
  const lines = [
    { rd_formula_id: "10", rmit_code: "RC1", rmit_inci_name: "Niacinamide", rm_part: "5", line_number: "1" },
    { rd_formula_id: "11", rmit_code: "RC1", rmit_inci_name: "Niacinamide", rm_part: "4", line_number: "1" },
    { rd_formula_id: "11", rmit_code: "RC2", rmit_inci_name: "Aqua", rm_part: "96", line_number: "2" },
  ];

  it("keeps only the latest version per product and links its lines", () => {
    const out = group_latest_formulas(formulas, lines, "T1", "A1");
    expect(out).toHaveLength(1);
    expect(out[0].rd_formula_id).toBe("11");
    expect(out[0].version).toBe(2);
    expect(out[0].lines).toHaveLength(2);
    expect(out[0].lines[0]).toMatchObject({ rm_code: "RC1", percentage: 4 });
    expect(out[0].lines[1]).toMatchObject({ rm_code: "RC2", percentage: 96 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/import/map-formula.test.ts`
Expected: FAIL — cannot find module `.../map-formula`.

- [ ] **Step 3: Write the mapping implementation**

```typescript
// apps/ai/scripts/import/map-formula.ts

/** One linked formula line (percentage = rm_part normalized to the formula total). */
export interface FormulaLineDoc {
  rm_code: string;
  inci_name: string;
  amount: number;
  percentage: number;
  line_number: number;
}

/** A formula header with its linked lines, ready for upsert. */
export interface FormulaImportDoc {
  tenantId: string;
  actorProfileId: string;
  ownerProfileId: string;
  rd_formula_id: string;
  productKey: string;
  name: string;
  version: number;
  status: string;
  lines: FormulaLineDoc[];
}

/** Parse a numeric string, defaulting to 0. */
function num(raw: string): number {
  const n = Number.parseFloat(raw || "");
  return Number.isFinite(n) ? n : 0;
}

/**
 * Group formula headers + lines into one doc per product, keeping the latest
 * version. Lines are linked by rmit_code (→ rm_code); percentage is rm_part
 * normalized so the formula totals 100 (rm_part is the part-per-formula value).
 *
 * @param formulas - rd_formulas rows (rd_formula_id, product_details_id, rd_formula_version, rd_formula_detail).
 * @param lines - rd_formula_lines rows (rd_formula_id, rmit_code, rmit_inci_name, rm_part, line_number).
 * @param tenant_id - Target tenant.
 * @param actor_profile_id - Importing actor.
 * @returns One FormulaImportDoc per product (latest version), with linked lines.
 */
export function group_latest_formulas(
  formulas: Record<string, string>[],
  lines: Record<string, string>[],
  tenant_id: string,
  actor_profile_id: string,
): FormulaImportDoc[] {
  // latest version per product
  const latest = new Map<string, Record<string, string>>();
  for (const f of formulas) {
    const key = (f.product_details_id || "").trim();
    if (!key) continue;
    const v = num(f.rd_formula_version);
    const cur = latest.get(key);
    if (!cur || v > num(cur.rd_formula_version)) latest.set(key, f);
  }
  const kept_ids = new Set([...latest.values()].map((f) => (f.rd_formula_id || "").trim()));

  // lines grouped by rd_formula_id
  const lines_by_formula = new Map<string, Record<string, string>[]>();
  for (const l of lines) {
    const fid = (l.rd_formula_id || "").trim();
    if (!kept_ids.has(fid)) continue;
    const arr = lines_by_formula.get(fid) ?? [];
    arr.push(l);
    lines_by_formula.set(fid, arr);
  }

  const out: FormulaImportDoc[] = [];
  for (const f of latest.values()) {
    const fid = (f.rd_formula_id || "").trim();
    const raw_lines = lines_by_formula.get(fid) ?? [];
    const total = raw_lines.reduce((s, l) => s + num(l.rm_part), 0) || 1;
    const linked: FormulaLineDoc[] = raw_lines
      .filter((l) => (l.rmit_code || "").trim())
      .map((l) => ({
        rm_code: (l.rmit_code || "").trim(),
        inci_name: (l.rmit_inci_name || "").trim(),
        amount: num(l.rm_part),
        percentage: Math.round((num(l.rm_part) / total) * 1e6) / 1e4,
        line_number: num(l.line_number),
      }))
      .sort((a, b) => a.line_number - b.line_number);
    out.push({
      tenantId: tenant_id,
      actorProfileId: actor_profile_id,
      ownerProfileId: actor_profile_id,
      rd_formula_id: fid,
      productKey: (f.product_details_id || "").trim(),
      name: (f.rd_formula_detail || `Formula ${fid}`).trim(),
      version: num(f.rd_formula_version),
      status: (f.record_status || "1").trim(),
      lines: linked,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/import/map-formula.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Write the failing importer test**

```typescript
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
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm run test -- tests/import/import-formulas.test.ts`
Expected: FAIL — cannot find module `.../import-formulas`.

- [ ] **Step 7: Write the importer implementation**

```typescript
// apps/ai/scripts/import/import-formulas.ts
import type { Db } from "mongodb";
import { group_latest_formulas } from "./map-formula";
import { read_csv_records } from "./lib/csv";
import { ImportReport } from "./lib/report";
import { DATASETS, target_identity, mongo_uri, is_dry_run } from "./import.config";

/** Options for a formulas import run. */
export interface FormulaImportOptions {
  db: Db;
  tenant_id: string;
  actor_profile_id: string;
  dry_run: boolean;
}

/** Result of a formulas import run. */
export interface FormulaImportResult {
  upserted_total: number;
  report: ImportReport;
}

/**
 * Import historical formulas (latest version per product) into the tenant
 * `formulas` collection. Idempotent by (tenantId, rd_formula_id). Lines whose
 * rm_code has no matching product are counted as "unmatched rm_code" in the
 * report but retained on the formula (so the record is complete).
 *
 * @param formulas - rd_formulas rows.
 * @param lines - rd_formula_lines rows.
 * @param opts - Target db, tenant/actor, dry-run.
 * @returns Upsert total and the integrity report.
 */
export async function import_formulas(
  formulas: Record<string, string>[],
  lines: Record<string, string>[],
  opts: FormulaImportOptions,
): Promise<FormulaImportResult> {
  const report = new ImportReport("formulas");
  report.read(formulas.length);
  const docs = group_latest_formulas(formulas, lines, opts.tenant_id, opts.actor_profile_id);
  const col = opts.db.collection("formulas");
  const products = opts.db.collection("products");
  const now = new Date();

  const known = new Set(
    (await products.find({ tenantId: opts.tenant_id }, { projection: { productCode: 1 } }).toArray()).map(
      (p) => p.productCode as string,
    ),
  );

  let upserted_total = 0;
  for (const doc of docs) {
    for (const line of doc.lines) {
      if (!known.has(line.rm_code)) report.skipped("unmatched rm_code");
    }
    if (!opts.dry_run) {
      await col.updateOne(
        { tenantId: opts.tenant_id, rd_formula_id: doc.rd_formula_id },
        { $set: { ...doc, updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true },
      );
    }
    upserted_total += 1;
    report.upserted(1);
  }
  return { upserted_total, report };
}

/** CLI entry. */
async function run_cli(): Promise<void> {
  const { default: client_promise } = await import("@rnd-ai/shared-database");
  void mongo_uri();
  const { tenant_id, actor_profile_id } = target_identity();
  const formulas = read_csv_records(DATASETS.rd_formulas.source);
  const lines = read_csv_records(DATASETS.rd_formula_lines.source);
  const client = await client_promise;
  try {
    const { report } = await import_formulas(formulas, lines, {
      db: client.db(),
      tenant_id,
      actor_profile_id,
      dry_run: is_dry_run(),
    });
    console.log(report.summary());
  } finally {
    await client.close();
  }
}

if (process.argv[1]?.includes("import-formulas")) {
  run_cli().catch((e) => { console.error("[import:formulas] failed:", e?.message ?? e); process.exitCode = 1; });
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run test -- tests/import/import-formulas.test.ts tests/import/map-formula.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Add the npm script**

In `apps/ai/package.json` `"scripts"`:

```json
"import:formulas": "tsx scripts/import/import-formulas.ts"
```

- [ ] **Step 10: Commit**

```bash
git add apps/ai/scripts/import/map-formula.ts apps/ai/scripts/import/import-formulas.ts apps/ai/package.json tests/import/map-formula.test.ts tests/import/import-formulas.test.ts
git commit -m "feat(import): historical formulas importer, latest version linked by rm_code"
```

---

## Task 8: `import:all` orchestrator + runbook, and retire the ad-hoc script

**Files:**
- Create: `apps/ai/scripts/import/import-all.ts`
- Create: `docs/import/README.md`
- Delete: `apps/ai/scripts/import-rm-catalog.ts` (superseded by `import/import-materials.ts`)
- Modify: `apps/ai/package.json` (add `import:all`)

- [ ] **Step 1: Write the ordered orchestrator**

```typescript
// apps/ai/scripts/import/import-all.ts
import { build_enrichment_index } from "./lib/enrich";
import { import_materials } from "./import-materials";
import { import_reference } from "./import-reference";
import { import_formulas } from "./import-formulas";
import { read_csv_records } from "./lib/csv";
import { DATASETS, target_identity, mongo_uri, is_dry_run } from "./import.config";

/**
 * Run the full Mongo relational import in dependency order:
 * reference → materials (enriched) → formulas (linked). Prints each report.
 */
async function run_cli(): Promise<void> {
  const { default: client_promise } = await import("@rnd-ai/shared-database");
  void mongo_uri();
  const { tenant_id, actor_profile_id } = target_identity();
  const dry_run = is_dry_run();

  const cosing = read_csv_records(DATASETS.cosing.source);
  const inci_lines = read_csv_records(DATASETS.inci_lines.source);
  const rm_rows = read_csv_records(DATASETS.rm_lines.source);
  const formulas = read_csv_records(DATASETS.rd_formulas.source);
  const formula_lines = read_csv_records(DATASETS.rd_formula_lines.source);

  const client = await client_promise;
  try {
    const db = client.db();
    const ref = await import_reference(cosing, inci_lines, { db, dry_run });
    console.log(ref.summary());
    const index = build_enrichment_index(cosing, inci_lines);
    const mat = await import_materials(rm_rows, index, { db, tenant_id, actor_profile_id, dry_run });
    console.log(mat.report.summary());
    const fml = await import_formulas(formulas, formula_lines, { db, tenant_id, actor_profile_id, dry_run });
    console.log(fml.report.summary());
    if (dry_run) console.log("[import:all] dry-run — no writes performed");
  } finally {
    await client.close();
  }
}

if (process.argv[1]?.includes("import-all")) {
  run_cli().catch((e) => { console.error("[import:all] failed:", e?.message ?? e); process.exitCode = 1; });
}
```

- [ ] **Step 2: Add the npm script**

In `apps/ai/package.json` `"scripts"`:

```json
"import:all": "tsx scripts/import/import-all.ts"
```

- [ ] **Step 3: Write the runbook**

```markdown
<!-- docs/import/README.md -->
# Chem/Formula Data Import

Loads raw materials (enriched), INCI reference, and historical formulas from the
legacy `rnd_ai` export into `rd_ai_gen2`'s tenant-scoped Mongo collections.
Idempotent — safe to re-run.

## Prerequisites
- The `rnd_ai` export present. Default location: sibling folder `../rnd_ai`.
  Override with `RND_EXPORT_DIR=/abs/path/to/rnd_ai`.
- Env: `MONGODB_URI` (or `DATABASE_URL`), `IMPORT_TENANT_ID`,
  `IMPORT_ACTOR_PROFILE_ID` (the tenant's bootstrapped super-admin profile id).

## Commands
```bash
# validate + report, no writes
IMPORT_TENANT_ID=<tenant> IMPORT_ACTOR_PROFILE_ID=<profile> \
  npm run import:all -w apps/ai -- --dry-run

# run for real (order: reference → materials → formulas)
IMPORT_TENANT_ID=<tenant> IMPORT_ACTOR_PROFILE_ID=<profile> \
  npm run import:all -w apps/ai

# individual datasets
npm run import:reference -w apps/ai
npm run import:materials -w apps/ai
npm run import:formulas  -w apps/ai
```

## Expected counts (Organics AI tenant)
- products: ~3,049 (enriched with CAS/functions where INCI matched)
- inci_reference: ~30k
- formulas: ~474 (latest version per product)

Re-running produces the same counts (upsert by natural key).
```

- [ ] **Step 4: Delete the superseded ad-hoc script**

```bash
git rm apps/ai/scripts/import-rm-catalog.ts
```

- [ ] **Step 5: Verify the whole suite is green + typecheck**

Run: `npm run test -- tests/import && npm run typecheck`
Expected: all import tests PASS; typecheck exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/ai/scripts/import/import-all.ts apps/ai/package.json docs/import/README.md
git commit -m "feat(import): import:all orchestrator + runbook; retire ad-hoc import-rm-catalog"
```

---

## Task 9: Live re-import on the production tenant (verification)

**Files:** none (operational verification of the new pipeline).

- [ ] **Step 1: Dry-run against the production tenant**

Run (from repo root, with the droplet's Mongo URI and the Organics AI tenant/profile):
```bash
RND_EXPORT_DIR=<path> MONGODB_URI=<prod-uri> \
IMPORT_TENANT_ID=6a68a51a665f1a13e6bffffe \
IMPORT_ACTOR_PROFILE_ID=6a68a4510bf347fa493d6033 \
  npm run import:all -w apps/ai -- --dry-run
```
Expected: reference ~30k, materials ~3,049, formulas ~474; "dry-run — no writes".

- [ ] **Step 2: Real run**

Re-run without `--dry-run`. Expected: same counts upserted; re-running a second time changes nothing (idempotent).

- [ ] **Step 3: Verify in the app**

Confirm `/formulas/create` picker shows enriched materials (CAS/benefits now populated, not `-`) and `/formulas` lists the imported formulas. Record counts in `CHANGELOG.md`.

- [ ] **Step 4: Commit the changelog entry**

```bash
git add CHANGELOG.md
git commit -m "ops: re-import chem/formula data via the sustainable pipeline; enriched picker + formulas live"
```

---

## Self-Review

**Spec coverage (§5 M1–M2):**
- Materials + enrich (CAS/functions/benefits) → Tasks 2,3,5,9 ✓
- INCI/CosIng reference → Task 6 ✓
- Formulas linked to products, latest version → Task 7 ✓
- Idempotent, dry-run, integrity report, one command, config-driven → Tasks 1,4,5,6,7,8 ✓
- Retire ad-hoc script / runbook / docs → Task 8 ✓
- Qdrant knowledge (M3) + generator (M4–M5) → **Plan 2** (out of scope here, stated) ✓

**Placeholder scan:** no TBD/TODO; every code step contains complete code; every command has expected output. ✓

**Type consistency:** `read_csv_records`, `build_enrichment_index`/`enrich_material`, `EnrichmentIndex`, `map_rm_line_to_product`/`ProductImportDoc`, `ImportReport` (`read`/`upserted`/`skipped`/`summary`), `import_materials`/`MaterialImportOptions`/`MaterialImportResult`, `import_reference`/`ReferenceImportOptions`, `group_latest_formulas`/`FormulaImportDoc`/`FormulaLineDoc`, `import_formulas`/`FormulaImportOptions`/`FormulaImportResult` — names and signatures are consistent across tasks and reused by `import-all`. ✓

**Note:** `import_formulas` writes to a plain `formulas` collection with tenant stamps for simplicity of migration. If the app must read these through `formula-repository` invariants (extra required fields), Task 7 Step 7 is the single place to align the document shape — verify against `apps/ai/server/repositories/formula-repository.ts` during execution and extend the `$set` doc if the repository's `list_formulas` projection needs more fields.
