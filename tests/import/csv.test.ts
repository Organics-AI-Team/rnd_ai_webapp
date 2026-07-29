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
