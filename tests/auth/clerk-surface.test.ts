import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repository_root = resolve(fileURLToPath(new URL("../../", import.meta.url)));

/**
 * Read a repo-relative source file.
 *
 * @param path - Repo-relative path.
 * @returns File contents.
 */
function read_source(path: string): string {
  return readFileSync(join(repository_root, path), "utf8");
}

/**
 * Recursively list source files under a repo-relative directory.
 *
 * @param dir - Directory to walk.
 * @returns Absolute file paths of .ts/.tsx sources.
 */
function list_sources(dir: string): string[] {
  const results: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      if (["node_modules", ".next", "dist"].includes(entry)) continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) results.push(full);
    }
  };
  walk(join(repository_root, dir));
  return results;
}

describe("Clerk authentication surface (G1.1)", () => {
  it("protects API and application paths with Clerk", () => {
    const proxy_source = read_source("apps/web/proxy.ts");
    expect(proxy_source).toContain("clerkMiddleware");
    expect(proxy_source).toContain("auth.protect");
    expect(proxy_source).toContain("/(api|trpc)(.*)");
  });

  it("routes Clerk enforcement to /sign-in, never the legacy /login page", () => {
    const proxy_source = read_source("apps/web/proxy.ts");
    expect(proxy_source).toContain('"/sign-in(.*)"');
    // The legacy /login redirect may only exist in the pre-cutover fallback
    // (legacy_guidance), never in the Clerk enforcement handler itself.
    const clerk_section = proxy_source.slice(
      proxy_source.indexOf("const clerk_proxy = clerkMiddleware("),
      proxy_source.indexOf("export async function proxy"),
    );
    expect(clerk_section).not.toContain('new URL("/login"');
    expect(clerk_section).toContain("auth.protect");
  });

  it("renders ClerkProvider inside the body element", () => {
    const layout_source = read_source("apps/web/app/layout.tsx");
    const body_index = layout_source.indexOf("<body");
    expect(body_index).toBeGreaterThan(-1);
    // The rendered ClerkProvider element must appear inside the body element,
    // not merely as an import at the top of the file.
    const provider_index = layout_source.indexOf("ClerkProvider", body_index);
    const body_close_index = layout_source.indexOf("</body>");
    expect(provider_index).toBeGreaterThan(body_index);
    expect(provider_index).toBeLessThan(body_close_index);
  });

  it("provides Clerk sign-in and sign-up catch-all pages", () => {
    expect(
      existsSync(join(repository_root, "apps/web/app/sign-in/[[...sign-in]]/page.tsx")),
    ).toBe(true);
    expect(
      existsSync(join(repository_root, "apps/web/app/sign-up/[[...sign-up]]/page.tsx")),
    ).toBe(true);
    expect(existsSync(join(repository_root, "apps/web/app/onboarding/page.tsx"))).toBe(
      true,
    );
  });

  it("never renders organization self-service components", () => {
    for (const file of list_sources("apps/web")) {
      const content = readFileSync(file, "utf8");
      expect(content, file).not.toContain("OrganizationSwitcher");
      expect(content, file).not.toContain("CreateOrganization");
    }
  });

  it("documents the Clerk environment names without secret values", () => {
    const env_example = read_source(".env.example");
    for (const name of [
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      "CLERK_SECRET_KEY",
      "CLERK_WEBHOOK_SIGNING_SECRET",
      "NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in",
      "NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up",
      "CLERK_CUTOVER=false",
      "CLERK_ORG_ROLE_MODE=custom",
    ]) {
      expect(env_example).toContain(name);
    }
    expect(env_example).not.toMatch(/CLERK_SECRET_KEY=sk_/);
  });

  it("pins the Clerk packages", () => {
    const web_pkg = JSON.parse(read_source("apps/web/package.json"));
    const ai_pkg = JSON.parse(read_source("apps/ai/package.json"));
    expect(web_pkg.dependencies["@clerk/nextjs"]).toBe("7.5.18");
    expect(ai_pkg.dependencies["@clerk/backend"]).toBe("3.11.5");
  });
});
