import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { is_credential_free_commercial_test_runtime } from "../../apps/web/lib/server/commercial-test-run-adapter";

const root = path.resolve(import.meta.dirname, "../..");

describe("credential-free browser runtime boundary", () => {
  it("can never activate in a production process", () => {
    vi.stubEnv("COMMERCIAL_TEST_ADAPTER_MODE", "credential_free");
    vi.stubEnv("NODE_ENV", "production");
    expect(is_credential_free_commercial_test_runtime()).toBe(false);
    vi.stubEnv("NODE_ENV", "test");
    expect(is_credential_free_commercial_test_runtime()).toBe(true);
    vi.unstubAllEnvs();
  });

  it("keeps the real run routes guarded and branches only through the explicit test predicate", async () => {
    const route_paths = [
      "apps/web/app/api/ai/runs/route.ts",
      "apps/web/app/api/ai/runs/[runId]/events/route.ts",
      "apps/web/app/api/ai/runs/[runId]/resume/route.ts",
    ];
    for (const route_path of route_paths) {
      const source = await readFile(path.join(root, route_path), "utf8");
      expect(source).toContain("with_request_principal(");
      expect(source).toContain("is_credential_free_commercial_test_runtime()");
    }
  });

  it("publishes the test console only under the same non-production predicate", async () => {
    const source = await readFile(
      path.join(root, "apps/web/app/commercial-test/agentic/page.tsx"),
      "utf8",
    );
    expect(source).toContain("is_credential_free_commercial_test_runtime()");
    expect(source).toContain("notFound()");
  });
});
