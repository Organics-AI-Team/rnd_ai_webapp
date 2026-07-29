import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repository_root = fileURLToPath(new URL("../../", import.meta.url));
const excluded_directories = new Set([
  ".git",
  ".next",
  ".superpowers",
  ".worktrees",
  "coverage",
  "dist",
  "docs",
  "node_modules",
  "tests",
]);
const source_extensions = new Set([
  ".cjs",
  ".js",
  ".mjs",
  ".sh",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const allowed_public_credentials = new Set([
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
]);
const provider_client_pattern = /\bnew\s+(GoogleGenerativeAI|OpenAI|QdrantClient|Pinecone|TavilySearch|SerpAPI|BraveSearch|EnhancedHybridSearchService|QdrantRAGService)\b/g;
const provider_client_import_pattern = /from\s+["'][^"']*services\/rag\/(enhanced-hybrid-search-service|qdrant-rag-service)["']/g;
const server_config_import_pattern = /["']@rnd-ai\/server-config["']/g;

type PublicAISecretFinding = Readonly<{
  identifier: string;
  kind:
    | "client_provider_constructor"
    | "client_provider_import"
    | "client_server_config_import"
    | "public_provider_credential";
  line: number;
  relative_path: string;
}>;

/**
 * Determine whether a repository file belongs to the source-level security boundary.
 *
 * Real environment files are deliberately excluded so the scanner never reads deployed
 * credential values. The committed placeholder contract remains in scope.
 *
 * @param file_path - Absolute path to the candidate file.
 * @returns Whether the file is a committed source or deployment artifact to scan.
 */
function is_scannable_source(file_path: string): boolean {
  const file_name = file_path.split("/").at(-1) ?? "";
  if (file_name.startsWith(".env") && file_name !== ".env.example") {
    return false;
  }

  return (
    file_name === ".env.example" ||
    file_name === "Dockerfile" ||
    source_extensions.has(extname(file_name))
  );
}

/**
 * Collect repository source files without traversing generated, test, or evidence trees.
 *
 * @param directory - Absolute directory currently being traversed.
 * @returns Absolute paths to source files inside the security boundary.
 */
function collect_source_files(directory: string): string[] {
  const source_files: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excluded_directories.has(entry.name)) {
      continue;
    }

    const entry_path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      source_files.push(...collect_source_files(entry_path));
    } else if (entry.isFile() && is_scannable_source(entry_path)) {
      source_files.push(entry_path);
    }
  }

  return source_files;
}

/**
 * Find client imports of the private credential contract.
 *
 * @param source - Source text to inspect.
 * @param relative_path - Repository-relative path used in redacted findings.
 * @returns Name-and-location-only private-package import findings.
 */
function find_client_server_config_imports(
  source: string,
  relative_path: string,
): PublicAISecretFinding[] {
  const is_client_module = /^\s*["']use client["'];/m.test(source);
  if (!is_client_module) {
    return [];
  }

  return Array.from(source.matchAll(server_config_import_pattern), (match) => ({
    identifier: "@rnd-ai/server-config",
    kind: "client_server_config_import" as const,
    line: get_line_number(source, match.index),
    relative_path,
  }));
}

/**
 * Convert a match offset into a one-based line number.
 *
 * @param source - Complete source text.
 * @param offset - Zero-based match offset in the source text.
 * @returns One-based source line number.
 */
function get_line_number(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

/**
 * Find forbidden public credential identifiers without returning source text or values.
 *
 * Clerk's publishable browser identifier is explicitly allowed. Public API URLs are not
 * credential-shaped and therefore remain allowed as well.
 *
 * @param source - Source text to inspect.
 * @param relative_path - Repository-relative path used in redacted findings.
 * @returns Name-and-location-only credential findings.
 */
function find_public_credentials(
  source: string,
  relative_path: string,
): PublicAISecretFinding[] {
  const findings: PublicAISecretFinding[] = [];
  const public_credential_pattern = /\bNEXT_PUBLIC_[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN)\b/g;

  for (const match of source.matchAll(public_credential_pattern)) {
    const identifier = match[0];
    if (!allowed_public_credentials.has(identifier)) {
      findings.push({
        identifier,
        kind: "public_provider_credential",
        line: get_line_number(source, match.index),
        relative_path,
      });
    }
  }

  return findings;
}

/**
 * Find provider SDK construction in client components without retaining source text.
 *
 * @param source - Source text to inspect.
 * @param relative_path - Repository-relative path used in redacted findings.
 * @returns Name-and-location-only client constructor findings.
 */
function find_client_provider_constructors(
  source: string,
  relative_path: string,
): PublicAISecretFinding[] {
  const is_client_module = /^\s*["']use client["'];/m.test(source);
  if (!is_client_module) {
    return [];
  }

  return Array.from(source.matchAll(provider_client_pattern), (match) => ({
    identifier: match[1],
    kind: "client_provider_constructor" as const,
    line: get_line_number(source, match.index),
    relative_path,
  }));
}

/**
 * Find imports that would pull server-side provider adapters into a client bundle.
 *
 * @param source - Source text to inspect.
 * @param relative_path - Repository-relative path used in redacted findings.
 * @returns Name-and-location-only client provider import findings.
 */
function find_client_provider_imports(
  source: string,
  relative_path: string,
): PublicAISecretFinding[] {
  const is_client_module = /^\s*["']use client["'];/m.test(source);
  if (!is_client_module) {
    return [];
  }

  return Array.from(source.matchAll(provider_client_import_pattern), (match) => ({
    identifier: match[1],
    kind: "client_provider_import" as const,
    line: get_line_number(source, match.index),
    relative_path,
  }));
}

/**
 * Scan committed source and deployment artifacts for public AI credential exposure.
 *
 * @param root - Absolute repository root.
 * @returns Stable name-and-location-only findings; credential values are never returned.
 */
function scan_public_ai_secrets(root: string): PublicAISecretFinding[] {
  return collect_source_files(root)
    .flatMap((file_path) => {
      const source = readFileSync(file_path, "utf8");
      const relative_path = relative(root, file_path);

      return [
        ...find_public_credentials(source, relative_path),
        ...find_client_provider_constructors(source, relative_path),
        ...find_client_provider_imports(source, relative_path),
        ...find_client_server_config_imports(source, relative_path),
      ];
    })
    .sort((left, right) =>
      left.relative_path.localeCompare(right.relative_path) ||
      left.line - right.line ||
      left.identifier.localeCompare(right.identifier),
    );
}

describe("public AI credential boundary", () => {
  it("contains no public AI credential name or client fallback", () => {
    const findings = scan_public_ai_secrets(repository_root);

    expect(findings).toEqual([]);
  });

  it("tracks only environment examples", () => {
    const tracked_files = execFileSync("git", ["ls-files", "-z"], {
      cwd: repository_root,
      encoding: "utf8",
    }).split("\0").filter(Boolean);
    const deleted_files = new Set(execFileSync("git", ["ls-files", "--deleted", "-z"], {
      cwd: repository_root,
      encoding: "utf8",
    }).split("\0").filter(Boolean));
    const tracked_environment_files = tracked_files.filter((file_path) => {
      if (deleted_files.has(file_path)) {
        return false;
      }

      const file_name = file_path.split("/").at(-1) ?? "";
      return file_name.startsWith(".env") && file_name !== ".env.example";
    });

    expect(tracked_environment_files).toEqual([]);
  });

  it("loads credentials only from private server names without import-time reads", async () => {
    const module_url = new URL("../../packages/server-config/src/index.ts", import.meta.url);
    const module_path = fileURLToPath(module_url);
    expect(existsSync(module_path), "expected the private server credential contract").toBe(true);

    const { require_server_ai_credentials } = await import(module_url.href) as {
      require_server_ai_credentials(env: NodeJS.ProcessEnv): Readonly<{
        gemini_api_key: string;
        google_search_api_key?: string;
        google_search_cse_id?: string;
        openai_api_key?: string;
        qdrant_api_key?: string;
      }>;
    };
    const credentials = require_server_ai_credentials({
      GEMINI_API_KEY: "test-gemini",
      GOOGLE_SEARCH_API_KEY: "test-search",
      GOOGLE_SEARCH_CSE_ID: "test-search-id",
      OPENAI_API_KEY: "test-openai",
      QDRANT_API_KEY: "test-qdrant",
    });

    expect(credentials).toEqual({
      gemini_api_key: "test-gemini",
      google_search_api_key: "test-search",
      google_search_cse_id: "test-search-id",
      openai_api_key: "test-openai",
      qdrant_api_key: "test-qdrant",
    });
    expect(Object.isFrozen(credentials)).toBe(true);
  });

  it("never accepts a public Gemini credential fallback", async () => {
    const module_url = new URL("../../packages/server-config/src/index.ts", import.meta.url);
    const module_path = fileURLToPath(module_url);
    expect(existsSync(module_path), "expected the private server credential contract").toBe(true);

    const { require_server_ai_credentials } = await import(module_url.href) as {
      require_server_ai_credentials(env: NodeJS.ProcessEnv): unknown;
    };

    expect(() => require_server_ai_credentials({
      NEXT_PUBLIC_GEMINI_API_KEY: "test-public-gemini",
    })).toThrowError("Missing required server credential: GEMINI_API_KEY");
  });
});
