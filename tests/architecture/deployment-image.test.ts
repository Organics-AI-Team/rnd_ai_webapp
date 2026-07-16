import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

async function read(relative_path: string): Promise<string> {
  return readFile(path.join(root, relative_path), "utf8");
}

describe("droplet deployment images", () => {
  for (const dockerfile_path of ["Dockerfile", "apps/web/Dockerfile"]) {
    it(`${dockerfile_path} builds the complete Node 24 monorepo runtime`, async () => {
      const dockerfile = await read(dockerfile_path);

      expect(dockerfile.match(/FROM node:24-alpine/g)).toHaveLength(3);
      expect(dockerfile).toContain(
        "COPY packages/ai-orchestration/package.json ./packages/ai-orchestration/",
      );
      expect(dockerfile).not.toContain("/app/apps/web/node_modules");
      expect(dockerfile).toContain("COPY prisma ./prisma");
      expect(dockerfile).toContain("RUN npx prisma generate");
      expect(dockerfile).toContain("/app/node_modules/.prisma ./node_modules/.prisma");
      expect(dockerfile).toContain('CMD ["node", "apps/web/server.js"]');
    });

    it(`${dockerfile_path} inlines the Clerk publishable key at build time`, async () => {
      const dockerfile = await read(dockerfile_path);

      expect(dockerfile).toContain("ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
      expect(dockerfile).toContain(
        "ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      );
    });
  }

  it("builds the governed run worker as a bundled non-root Node 24 image", async () => {
    const dockerfile = await read("apps/ai/Dockerfile.worker");

    expect(dockerfile.match(/FROM node:24-alpine/g)).toHaveLength(3);
    expect(dockerfile).toContain("RUN npx prisma generate");
    expect(dockerfile).toContain("RUN npm run build:worker");
    expect(dockerfile).toContain("/app/node_modules/.prisma ./node_modules/.prisma");
    expect(dockerfile).toContain("USER aiworker");
    expect(dockerfile).toContain('CMD ["node", "apps/ai/dist/server/worker.js"]');
  });

  it("keeps the droplet compose file pinned to the reviewed web image", async () => {
    const compose = await read("docker-compose.yml");

    expect(compose).toContain("dockerfile: apps/web/Dockerfile");
    expect(compose).toContain('"3000:3000"');
    expect(compose).toContain("QDRANT_URL=http://qdrant:6333");
    expect(compose).toContain("/api/health");
  });

  it("injects the full Clerk contract into the web service", async () => {
    const compose = await read("docker-compose.yml");

    expect(compose).toContain(
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:-}",
    );
    expect(compose).toContain("CLERK_SECRET_KEY=${CLERK_SECRET_KEY:-}");
    expect(compose).toContain(
      "CLERK_WEBHOOK_SIGNING_SECRET=${CLERK_WEBHOOK_SIGNING_SECRET:-}",
    );
    expect(compose).toContain("CLERK_CUTOVER=${CLERK_CUTOVER:-false}");
    expect(compose).toContain("CLERK_ORG_ROLE_MODE=${CLERK_ORG_ROLE_MODE:-}");
  });

  it("runs the governed run worker service so queued runs complete", async () => {
    const compose = await read("docker-compose.yml");

    expect(compose).toContain("dockerfile: apps/ai/Dockerfile.worker");
    expect(compose).toContain("container_name: rnd-ai-worker");
    expect(compose).toContain(
      "AI_GEMINI_INPUT_PRICE_MICROUSD_PER_MILLION_TOKENS=${AI_GEMINI_INPUT_PRICE_MICROUSD_PER_MILLION_TOKENS}",
    );
    expect(compose).toContain(
      "AI_GEMINI_OUTPUT_PRICE_MICROUSD_PER_MILLION_TOKENS=${AI_GEMINI_OUTPUT_PRICE_MICROUSD_PER_MILLION_TOKENS}",
    );
  });

  it("validates the Clerk and worker deployment contract before deploying", async () => {
    const script = await read("scripts/deploy-droplet.sh");

    expect(script).toContain('if [ "$(env_value CLERK_CUTOVER)" = "true" ]');
    expect(script).toContain("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
    expect(script).toContain("CLERK_SECRET_KEY");
    expect(script).toContain("CLERK_WEBHOOK_SIGNING_SECRET");
    expect(script).toContain("AI_GEMINI_INPUT_PRICE_MICROUSD_PER_MILLION_TOKENS");
    expect(script).toContain(
      '--build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="$(env_value NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)"',
    );
  });
});
