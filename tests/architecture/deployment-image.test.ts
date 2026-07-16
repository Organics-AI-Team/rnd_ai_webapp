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
  }

  it("keeps the droplet compose file pinned to the reviewed web image", async () => {
    const compose = await read("docker-compose.yml");

    expect(compose).toContain("dockerfile: apps/web/Dockerfile");
    expect(compose).toContain('"3000:3000"');
    expect(compose).toContain("QDRANT_URL=http://qdrant:6333");
    expect(compose).toContain("/api/health");
  });
});
