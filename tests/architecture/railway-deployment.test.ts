import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

async function read(relative_path: string): Promise<string> {
  return readFile(path.join(root, relative_path), "utf8");
}

describe("Railway web deployment image", () => {
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

  it("keeps both Railway config variants pinned to the reviewed web images", async () => {
    const default_config = JSON.parse(await read("railway.json")) as {
      build: { dockerfilePath: string };
      deploy: { healthcheckPath: string };
    };
    const root_config = JSON.parse(await read("config/railway.json")) as {
      build: { dockerfilePath: string };
      deploy: { healthcheckPath: string };
    };
    const web_config = JSON.parse(await read("config/railway.web.json")) as {
      build: { dockerfilePath: string };
      deploy: { healthcheckPath: string };
    };

    expect(default_config.build.dockerfilePath).toBe("Dockerfile");
    expect(root_config.build.dockerfilePath).toBe("Dockerfile");
    expect(web_config.build.dockerfilePath).toBe("apps/web/Dockerfile");
    expect(default_config.deploy.healthcheckPath).toBe("/api/health");
    expect(root_config.deploy.healthcheckPath).toBe("/api/health");
    expect(web_config.deploy.healthcheckPath).toBe("/api/health");
  });
});
