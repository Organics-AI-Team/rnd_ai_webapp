// tests/import/csv-stream.test.ts
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stream_csv_batches } from "../../apps/ai/scripts/import/lib/csv";
import { DATASETS, knowledge_ingest_config } from "../../apps/ai/scripts/import/import.config";

describe("stream_csv_batches", () => {
  it("streams records in batches, handling BOM and quoted newlines", async () => {
    const dir = mkdtempSync(join(tmpdir(), "csvs-"));
    const file = join(dir, "t.csv");
    // BOM prefix (the myskin export has one) + a quoted multi-line field.
    writeFileSync(
      file,
      '﻿name,desc\n"A","one, two"\n"B","line1\nline2"\n"C","x"\n',
    );
    const batches: Record<string, string>[][] = [];
    for await (const batch of stream_csv_batches(file, 2)) batches.push(batch);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(2);
    expect(batches[0]![0]).toEqual({ name: "A", desc: "one, two" });
    expect(batches[0]![1]!.desc).toContain("line2");
    expect(batches[1]).toEqual([{ name: "C", desc: "x" }]);
  });
});

describe("knowledge ingest config", () => {
  it("registers the myskin dataset under the export drop-in", () => {
    expect(DATASETS.myskin.source).toContain("myskin_scraping/raws/");
    expect(DATASETS.myskin.natural_key).toBe("sku");
  });

  it("reads embedding + batching settings with worker-matching defaults", () => {
    process.env.GEMINI_API_KEY = "test-key";
    delete process.env.AI_EMBEDDING_VERSION;
    delete process.env.AI_EMBEDDING_DIMENSIONS;
    const config = knowledge_ingest_config();
    expect(config.embedding_model).toBe("gemini-embedding-001");
    expect(config.embedding_version).toBe("v1");
    expect(config.embedding_dimensions).toBe(768);
    expect(config.batch_size).toBe(50);
    expect(config.batch_delay_ms).toBe(1000);
    expect(config.progress_file.length).toBeGreaterThan(0);
  });

  it("fails fast without GEMINI_API_KEY", () => {
    delete process.env.GEMINI_API_KEY;
    expect(() => knowledge_ingest_config()).toThrow(/GEMINI_API_KEY/);
  });
});
