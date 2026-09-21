import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One detected boundary violation inside the orchestration workspace.
 */
interface BoundaryViolation {
  readonly file: string;
  readonly specifier: string;
  readonly reason: string;
}

const workspace_root = resolve(__dirname, "..", "..");

/**
 * Import specifiers (exact package names or path fragments) that the
 * dependency-isolated orchestration workspace must never reference.
 * Legacy agent implementations, app code, prebuilt LangGraph agents, and
 * provider SDKs all stay outside the governed loop package.
 */
const forbidden_specifier_rules: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly reason: string;
}> = [
  { pattern: /apps\/ai\/agents/, reason: "legacy agent implementation" },
  { pattern: /apps\/ai\/services/, reason: "legacy AI service implementation" },
  { pattern: /apps\/ai\//, reason: "apps/ai application code" },
  { pattern: /apps\/web/, reason: "web application code" },
  {
    pattern: /^@langchain\/langgraph\/prebuilt/,
    reason: "prebuilt LangGraph legacy agents",
  },
  { pattern: /^@google\/genai/, reason: "provider SDK (Gemini)" },
  { pattern: /^@google\/generative-ai/, reason: "provider SDK (Gemini legacy)" },
  { pattern: /^openai(\/|$)/, reason: "provider SDK (OpenAI)" },
  { pattern: /^@anthropic-ai\//, reason: "provider SDK (Anthropic)" },
  { pattern: /^@azure\/openai/, reason: "provider SDK (Azure OpenAI)" },
  { pattern: /^cohere-ai(\/|$)/, reason: "provider SDK (Cohere)" },
  { pattern: /^groq-sdk(\/|$)/, reason: "provider SDK (Groq)" },
  { pattern: /^@aws-sdk\/client-bedrock/, reason: "provider SDK (Bedrock)" },
];

/**
 * Recursively collect TypeScript source files under a directory.
 *
 * @param directory - Absolute directory to walk.
 * @returns Absolute file paths for every .ts source found.
 */
function collect_typescript_files(directory: string): string[] {
  const collected: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full_path = join(directory, entry);
    if (statSync(full_path).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      collected.push(...collect_typescript_files(full_path));
    } else if (entry.endsWith(".ts")) {
      collected.push(full_path);
    }
  }
  return collected;
}

/**
 * Extract every static import, export-from, dynamic import, and require
 * specifier from a TypeScript source text.
 *
 * @param source - Raw TypeScript file contents.
 * @returns All module specifiers referenced by the file.
 */
function extract_import_specifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /import\s+[^"']*?from\s+["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /export\s+[^"']*?from\s+["']([^"']+)["']/g,
    /require\s*\(\s*["']([^"']+)["']\s*\)/g,
    /import\s+["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

/**
 * Walk a workspace's TypeScript sources and report every import that crosses
 * the orchestration isolation boundary.
 *
 * @param workspace_relative_path - Workspace directory relative to the repo root.
 * @returns Detected violations; a missing workspace is itself a violation so
 *          the boundary contract can never silently pass.
 */
function scan_workspace_imports(
  workspace_relative_path: string,
): BoundaryViolation[] {
  const workspace_path = join(workspace_root, workspace_relative_path);
  const source_path = join(workspace_path, "src");
  if (!existsSync(source_path)) {
    return [
      {
        file: workspace_relative_path,
        specifier: "",
        reason: "workspace src directory does not exist",
      },
    ];
  }

  const violations: BoundaryViolation[] = [];
  for (const file of collect_typescript_files(source_path)) {
    const source = readFileSync(file, "utf8");
    for (const specifier of extract_import_specifiers(source)) {
      for (const rule of forbidden_specifier_rules) {
        if (rule.pattern.test(specifier)) {
          violations.push({
            file: file.slice(workspace_root.length + 1),
            specifier,
            reason: rule.reason,
          });
        }
      }
    }
  }
  return violations;
}

describe("ai-orchestration package boundary", () => {
  it("has no dependency on legacy agent implementations", () => {
    const violations = scan_workspace_imports("packages/ai-orchestration");
    expect(violations).toEqual([]);
  });

  it("declares only the pinned governed-loop dependencies", () => {
    const manifest_path = join(
      workspace_root,
      "packages/ai-orchestration/package.json",
    );
    expect(existsSync(manifest_path)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifest_path, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(manifest.dependencies).toMatchObject({
      "@langchain/langgraph": "1.4.8",
      "@langchain/core": "1.2.3",
      "@langchain/langgraph-checkpoint-mongodb": "1.4.0",
      mongodb: "6.21.0",
      zod: "3.25.76",
      "decimal.js": "10.6.0",
      "@rnd-ai/shared-types": "1.0.0",
    });
    const forbidden_dependency_names = [
      "@google/genai",
      "@google/generative-ai",
      "openai",
      "@anthropic-ai/sdk",
    ];
    for (const name of forbidden_dependency_names) {
      expect(manifest.dependencies).not.toHaveProperty(name);
    }
  });

  it("exports the pinned orchestrator version", async () => {
    const version_module = (await import(
      "../../packages/ai-orchestration/src/version"
    )) as {
      ORCHESTRATOR_VERSION: string;
      assert_supported_orchestrator_version: (version: string) => void;
    };
    expect(version_module.ORCHESTRATOR_VERSION).toBe("agentic-1.0.0");
    expect(() =>
      version_module.assert_supported_orchestrator_version("agentic-1.0.0"),
    ).not.toThrow();
    expect(() =>
      version_module.assert_supported_orchestrator_version("ooda-0.9.0"),
    ).toThrow(/unsupported/i);
  });
});
