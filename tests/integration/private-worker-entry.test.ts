import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { create_production_legacy_run_executor } from "../../apps/ai/server/legacy-run-executor";
import { run_private_worker } from "../../apps/ai/server/worker";

const root = resolve(import.meta.dirname, "../..");

describe("private AI worker entry", () => {
  it("is import-safe and exposes both the worker and rollback factory", () => {
    expect(run_private_worker).toBeTypeOf("function");
    expect(create_production_legacy_run_executor).toBeTypeOf("function");
  });

  it("has dedicated development and built-process package commands", async () => {
    const package_json = JSON.parse(
      await readFile(resolve(root, "apps/ai/package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(package_json.scripts?.worker).toBe("tsx server/worker.ts");
    expect(package_json.scripts?.["build:worker"]).toContain("esbuild server/worker.ts");
    expect(package_json.scripts?.["build:worker"]).toContain("--alias:@/ai=.");
    expect(package_json.scripts?.["start:worker"]).toBe("node dist/server/worker.js");
  });

  it("does not expose an HTTP listener from the worker boundary", async () => {
    const source = await readFile(resolve(root, "apps/ai/server/worker.ts"), "utf8");

    expect(source).not.toMatch(/\.listen\s*\(/);
    expect(source).not.toMatch(/createServer\s*\(/);
    expect(source).toContain("process_one_job");
    expect(source).toContain("create_pinned_run_executor");
    expect(source).toContain("credentials.google_search_api_key");
    expect(source).toContain("credentials.google_search_cse_id");
  });
});
