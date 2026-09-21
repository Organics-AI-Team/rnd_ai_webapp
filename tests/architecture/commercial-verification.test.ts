import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

describe("commercial verification architecture", () => {
  it("runs every mandatory gate in fail-fast order and always tears test services down", async () => {
    const scriptPath = path.join(root, "scripts/verify-commercial.sh");
    const script = await read("scripts/verify-commercial.sh");
    const commands = script
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) =>
          line === "docker compose -f docker-compose.test.yml up -d --wait" ||
          line === "docker build --progress=plain -f Dockerfile -t rnd-ai-commercial-verify:local ." ||
          line === "npm ci" ||
          line.startsWith("npx prisma ") ||
          line.startsWith("npm run ") ||
          line === "npm test",
      );

    expect(script.startsWith("#!/usr/bin/env bash\n")).toBe(true);
    expect(statSync(scriptPath).mode & 0o111).not.toBe(0);
    expect(script).toContain("set -euo pipefail");
    expect(script).toContain(
      "trap 'docker compose -f docker-compose.test.yml down -v' EXIT",
    );
    expect(commands).toEqual([
      "docker compose -f docker-compose.test.yml up -d --wait",
      "npm ci",
      "npx prisma validate",
      "npx prisma generate",
      "npm run build:worker",
      "npm run typecheck",
      "npm run lint",
      "npm test",
      "npm run test:resilience",
      "npm run test:load",
      "npm run security:scan",
      "npm run eval:legacy -- --artifact=legacy-frozen",
      "npm run eval:ooda -- --artifact=ooda-current",
      "npm run eval:compare -- --baseline=legacy-frozen --candidate=ooda-current",
      "npm run test:e2e",
      "npm run build:web",
      "docker build --progress=plain -f Dockerfile -t rnd-ai-commercial-verify:local .",
    ]);
    expect(script).not.toMatch(/\|\|\s*true|set \+e/);
  });

  it("requires credential-free adapters without manufacturing a legacy baseline", async () => {
    const script = await read("scripts/verify-commercial.sh");

    expect(script).toContain('COMMERCIAL_TEST_ADAPTER_MODE:-');
    expect(script).toContain('!= "credential_free"');
    expect(script).toContain("unset CLERK_SECRET_KEY GEMINI_API_KEY OPENAI_API_KEY QDRANT_API_KEY");
    expect(script).toContain(
      "mongodb://127.0.0.1:27018/rnd_ai_commercial_test?replicaSet=rs0&directConnection=true",
    );
    expect(script).toContain("http://127.0.0.1:6335");
    expect(script).not.toMatch(/(?:touch|cp|mv|install|mkdir).*legacy-frozen/i);
    expect(script).not.toMatch(/legacy-frozen[^\n]*(?:fallback|placeholder|synthetic)/i);
  });

  it("pins isolated Mongo and Qdrant test services with health checks", async () => {
    const compose = await read("docker-compose.test.yml");

    expect(compose).toContain("mongo:8.0.12");
    expect(compose).toContain("qdrant/qdrant:v1.18.2");
    expect(compose).toContain("--replSet");
    expect(compose).toContain("rs0");
    expect(compose.match(/healthcheck:/g)).toHaveLength(2);
    expect(compose).toContain("127.0.0.1:27018:27017");
    expect(compose).toContain("127.0.0.1:6335:6333");
    expect(compose).toContain("commercial-mongo-data:");
    expect(compose).toContain("commercial-qdrant-data:");
    expect(compose).not.toMatch(/:\s*latest\b/);
    expect(compose).not.toMatch(/(?:CLERK|GEMINI|OPENAI|API_KEY|SECRET)/);
  });

  it("uses Node 24 CI, bounded execution, and uploads verification evidence", async () => {
    const workflow = await read(".github/workflows/commercial.yml");

    expect(workflow).toMatch(/pull_request:/);
    expect(workflow).toContain('"dev/**"');
    expect(workflow).toContain('"release-*"');
    expect(workflow).toContain("node-version: 24");
    expect(workflow).toMatch(/timeout-minutes:\s*\d+/);
    expect(workflow).toContain("COMMERCIAL_TEST_ADAPTER_MODE: credential_free");
    expect(workflow).toContain("run: npm run verify:commercial");
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain("playwright-report/");
    expect(workflow).toContain("evals/reports/");
    expect(workflow).not.toMatch(/\$\{\{\s*secrets\./);
    expect(workflow).not.toMatch(/(?:CLERK_SECRET_KEY|GEMINI_API_KEY|OPENAI_API_KEY|QDRANT_API_KEY)/);
  });

  it("serializes the local credential-free browser campaign on its owned server", async () => {
    const config = await read("playwright.config.ts");

    expect(config).toContain("workers: hosted_base_url ? undefined : 1");
    expect(config).toContain("reuseExistingServer: false");
  });

  it("maps every invoked commercial command to a real root entrypoint", async () => {
    const package_json = JSON.parse(await read("package.json")) as {
      scripts?: Record<string, string>;
    };

    expect(package_json.scripts?.["verify:commercial"]).toBe(
      "./scripts/verify-commercial.sh",
    );
    expect(package_json.scripts?.["build:worker"]).toBe(
      "npm run build:worker --workspace=apps/ai",
    );
    expect(package_json.scripts?.["test:resilience"]).toBe(
      "vitest run tests/resilience",
    );
    expect(package_json.scripts?.["test:load"]).toBe(
      "tsx scripts/run-commercial-load.ts",
    );
    expect(package_json.scripts?.["eval:compare"]).toBe(
      "tsx evals/runner/compare-evaluations.ts",
    );
    expect(package_json.scripts?.["eval:legacy"]).toBe(
      "tsx evals/runner/run-campaign.ts --executor=legacy",
    );
    expect(package_json.scripts?.["eval:ooda"]).toBe(
      "tsx evals/runner/run-campaign.ts --executor=agentic",
    );
  });

  it("documents the private worker runtime and required price contract in the backend env example", async () => {
    const env = await read("apps/ai/.env.example");

    for (const key of [
      "AI_RATE_CARD_VERSION",
      "AI_GEMINI_INPUT_PRICE_MICROUSD_PER_MILLION_TOKENS",
      "AI_GEMINI_OUTPUT_PRICE_MICROUSD_PER_MILLION_TOKENS",
      "AI_EMBEDDING_MODEL",
      "AI_EMBEDDING_VERSION",
      "AI_EMBEDDING_DIMENSIONS",
      "AI_RUN_TIMEOUT_MS",
      "AI_WORKER_LEASE_MS",
      "AI_WORKER_HEARTBEAT_INTERVAL_MS",
      "AI_WORKER_BACKOFF_MS",
      "AI_WORKER_MAX_ATTEMPTS",
      "AI_WORKER_MAX_BACKOFF_MS",
      "AI_WORKER_POLL_MS",
      "GEMINI_API_KEY",
      "GOOGLE_SEARCH_API_KEY",
      "GOOGLE_SEARCH_CSE_ID",
      "QDRANT_URL",
      "QDRANT_API_KEY",
    ]) {
      expect(env).toMatch(new RegExp(`^${key}=`, "m"));
    }
    expect(env).toContain(
      "AI_GEMINI_INPUT_PRICE_MICROUSD_PER_MILLION_TOKENS=replace-with-approved-rate",
    );
    expect(env).toContain(
      "AI_GEMINI_OUTPUT_PRICE_MICROUSD_PER_MILLION_TOKENS=replace-with-approved-rate",
    );
    expect(env).not.toMatch(/^NEXT_PUBLIC_AI_(?:RATE|WORKER|GEMINI_.*PRICE)/m);
    expect(env).not.toMatch(/^NEXT_PUBLIC_(?:GEMINI|GOOGLE_SEARCH|QDRANT)/m);
  });
});
