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
