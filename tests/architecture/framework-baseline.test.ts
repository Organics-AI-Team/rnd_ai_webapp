import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import web_package from "../../apps/web/package.json";

const next_config_path = fileURLToPath(
  new URL("../../apps/web/next.config.js", import.meta.url),
);
const next_config = readFileSync(next_config_path, "utf8");

describe("commercial framework baseline", () => {
  it("uses the patched supported web stack", () => {
    expect(web_package.dependencies.next).toBe("16.2.10");
    expect(web_package.dependencies.react).toBe("19.2.7");
    expect(web_package.dependencies["react-dom"]).toBe("19.2.7");
  });

  it("does not bypass TypeScript build validation", () => {
    expect(next_config).not.toContain("ignoreBuildErrors");
  });
});
