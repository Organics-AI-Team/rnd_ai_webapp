/**
 * Private server boundary scanner (G0.7).
 *
 * Deterministically rejects boundary regressions in production source:
 *  - PUBLIC_BUSINESS_PROCEDURE: publicProcedure outside the auth router, or
 *    the dedicated client-order ingress outside orders.ts.
 *  - UNGUARDED_ROUTE_HANDLER: a direct API route handler that does not run
 *    behind with_request_principal (tRPC adapter and OPTIONS preflight exempt).
 *  - CLIENT_IDENTITY_FIELD: identity read from a request JSON body or query
 *    parameters instead of the verified principal.
 *  - LOCALSTORAGE_AUTH_TOKEN: session token written to browser storage.
 *  - ORG_CREATION_OUTSIDE_PROVISIONING: organization records created outside
 *    the provisioning service path reserved for G1.
 *  - IGNORED_TYPE_ERRORS: ignoreBuildErrors enabled in build configuration.
 *
 * Run directly (npm run security:scan) to scan the repository and exit
 * non-zero on findings with file and line numbers.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** In-memory source file consumed by the scanner. */
export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

/** Stable finding codes emitted by the scanner. */
export type SecurityFindingCode =
  | "PUBLIC_BUSINESS_PROCEDURE"
  | "UNGUARDED_ROUTE_HANDLER"
  | "CLIENT_IDENTITY_FIELD"
  | "LOCALSTORAGE_AUTH_TOKEN"
  | "ORG_CREATION_OUTSIDE_PROVISIONING"
  | "IGNORED_TYPE_ERRORS";

/** One deterministic policy violation with its location. */
export interface SecurityFinding {
  readonly code: SecurityFindingCode;
  readonly file: string;
  readonly line: number;
  readonly detail: string;
}

const GUARDED_HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const IDENTITY_KEYS = new Set([
  "userid",
  "orgid",
  "organizationid",
  "tenantid",
  "actorid",
]);

/**
 * Normalize a path to forward slashes for rule matching.
 *
 * @param path - Repo-relative or absolute path.
 * @returns Slash-normalized path.
 */
function normalize_path(path: string): string {
  return path.split(sep).join("/");
}

/**
 * Canonicalize an identifier for identity-key comparison.
 *
 * @param name - Raw identifier or string key.
 * @returns Lowercased name without separators.
 */
function canonical_identity_name(name: string): string {
  return name.toLowerCase().replace(/[_-]/g, "");
}

/**
 * Parse source text into a TypeScript AST.
 *
 * @param file - Source file to parse.
 * @returns ts.SourceFile for traversal.
 */
function parse(file: SourceFile): ts.SourceFile {
  return ts.createSourceFile(
    file.path,
    file.content,
    ts.ScriptTarget.Latest,
    true,
    file.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/**
 * Build a finding at a node's location.
 *
 * @param file - Scanned file.
 * @param source - Parsed AST used to derive line numbers.
 * @param node - Offending node.
 * @param code - Finding code.
 * @param detail - Human-readable explanation.
 * @returns Located SecurityFinding.
 */
function finding_at(
  file: SourceFile,
  source: ts.SourceFile,
  node: ts.Node,
  code: SecurityFindingCode,
  detail: string,
): SecurityFinding {
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { code, file: normalize_path(file.path), line: line + 1, detail };
}

/**
 * Find references to public procedures inside business routers.
 *
 * @param file - Scanned file.
 * @param source - Parsed AST.
 * @returns PUBLIC_BUSINESS_PROCEDURE findings.
 */
function find_public_business_procedures(
  file: SourceFile,
  source: ts.SourceFile,
): SecurityFinding[] {
  const path = normalize_path(file.path);
  if (!path.includes("/server/routers/")) return [];
  const is_auth_router = path.endsWith("/auth.ts");
  const is_orders_router = path.endsWith("/orders.ts");
  const findings: SecurityFinding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      if (node.text === "publicProcedure" && !is_auth_router) {
        findings.push(
          finding_at(
            file,
            source,
            node,
            "PUBLIC_BUSINESS_PROCEDURE",
            "publicProcedure is allowed only in the auth router",
          ),
        );
      }
      if (node.text === "publicClientOrderProcedure" && !is_orders_router) {
        findings.push(
          finding_at(
            file,
            source,
            node,
            "PUBLIC_BUSINESS_PROCEDURE",
            "publicClientOrderProcedure is allowed only in orders.ts",
          ),
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

/**
 * Find exported HTTP handlers in direct API routes that do not run behind
 * with_request_principal.
 *
 * @param file - Scanned file.
 * @param source - Parsed AST.
 * @returns UNGUARDED_ROUTE_HANDLER findings.
 */
function find_unguarded_route_handlers(
  file: SourceFile,
  source: ts.SourceFile,
): SecurityFinding[] {
  const path = normalize_path(file.path);
  if (!/app\/api\/.*route\.ts$/.test(path)) return [];
  if (path.includes("/api/trpc/")) return [];
  // Webhook ingress authenticates by signature verification (svix), not by
  // a session principal; handle_clerk_webhook rejects unsigned requests.
  if (path.includes("/api/webhooks/")) return [];
  const findings: SecurityFinding[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      GUARDED_HTTP_METHODS.has(node.name.text) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      const body_text = node.body?.getText(source) ?? "";
      if (!body_text.includes("with_request_principal(")) {
        findings.push(
          finding_at(
            file,
            source,
            node,
            "UNGUARDED_ROUTE_HANDLER",
            `${node.name.text} does not call with_request_principal`,
          ),
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

/**
 * Detect whether an expression is a request/req JSON body read.
 *
 * @param expression - Candidate initializer expression.
 * @returns True for await request.json() / await req.json() shapes.
 */
function is_request_json_read(expression: ts.Expression): boolean {
  const inner = ts.isAwaitExpression(expression)
    ? expression.expression
    : expression;
  return (
    ts.isCallExpression(inner) &&
    ts.isPropertyAccessExpression(inner.expression) &&
    inner.expression.name.text === "json" &&
    ts.isIdentifier(inner.expression.expression) &&
    ["request", "req"].includes(inner.expression.expression.text)
  );
}

/**
 * Find identity fields read from request bodies or query parameters.
 *
 * @param file - Scanned file.
 * @param source - Parsed AST.
 * @returns CLIENT_IDENTITY_FIELD findings.
 */
function find_client_identity_fields(
  file: SourceFile,
  source: ts.SourceFile,
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      is_request_json_read(node.initializer) &&
      ts.isObjectBindingPattern(node.name)
    ) {
      for (const element of node.name.elements) {
        const bound =
          element.propertyName && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : ts.isIdentifier(element.name)
              ? element.name.text
              : "";
        if (IDENTITY_KEYS.has(canonical_identity_name(bound))) {
          findings.push(
            finding_at(
              file,
              source,
              element,
              "CLIENT_IDENTITY_FIELD",
              `identity field '${bound}' read from request JSON`,
            ),
          );
        }
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "get" &&
      node.expression.expression.getText(source).endsWith("searchParams") &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      IDENTITY_KEYS.has(canonical_identity_name(node.arguments[0].text))
    ) {
      findings.push(
        finding_at(
          file,
          source,
          node,
          "CLIENT_IDENTITY_FIELD",
          `identity field '${node.arguments[0].text}' read from query parameters`,
        ),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

/**
 * Find session tokens written to browser storage.
 *
 * @param file - Scanned file.
 * @param source - Parsed AST.
 * @returns LOCALSTORAGE_AUTH_TOKEN findings.
 */
function find_local_storage_token_writes(
  file: SourceFile,
  source: ts.SourceFile,
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "setItem" &&
      node.expression.expression.getText(source) === "localStorage" &&
      node.arguments.length >= 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[0].text === "auth_token"
    ) {
      findings.push(
        finding_at(
          file,
          source,
          node,
          "LOCALSTORAGE_AUTH_TOKEN",
          "auth_token must not be written to localStorage",
        ),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

/**
 * Find organization record creation outside the provisioning service.
 *
 * @param file - Scanned file.
 * @param source - Parsed AST.
 * @returns ORG_CREATION_OUTSIDE_PROVISIONING findings.
 */
function find_org_creation_outside_provisioning(
  file: SourceFile,
  source: ts.SourceFile,
): SecurityFinding[] {
  const path = normalize_path(file.path);
  if (path.includes("/server/services/provisioning/")) return [];
  const findings: SecurityFinding[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "insertOne"
    ) {
      const target = node.expression.expression.getText(source);
      if (/collection\(\s*['"`]organizations['"`]\s*\)/.test(target)) {
        findings.push(
          finding_at(
            file,
            source,
            node,
            "ORG_CREATION_OUTSIDE_PROVISIONING",
            "organizations are created only by the provisioning service (G1)",
          ),
        );
      }
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source).endsWith("organization.create")
    ) {
      findings.push(
        finding_at(
          file,
          source,
          node,
          "ORG_CREATION_OUTSIDE_PROVISIONING",
          "organizations are created only by the provisioning service (G1)",
        ),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

/**
 * Find ignored TypeScript build errors in configuration.
 *
 * @param file - Scanned file.
 * @param source - Parsed AST.
 * @returns IGNORED_TYPE_ERRORS findings.
 */
function find_ignored_type_errors(
  file: SourceFile,
  source: ts.SourceFile,
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "ignoreBuildErrors" &&
      node.initializer.kind === ts.SyntaxKind.TrueKeyword
    ) {
      findings.push(
        finding_at(
          file,
          source,
          node,
          "IGNORED_TYPE_ERRORS",
          "ignoreBuildErrors must remain disabled",
        ),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

/**
 * Scan source files for private-boundary violations.
 *
 * @param files - Source files to scan.
 * @returns Deterministic findings ordered by input file order.
 */
export function scan_private_boundaries(
  files: readonly SourceFile[],
): readonly SecurityFinding[] {
  return files.flatMap((file) => {
    const source = parse(file);
    return [
      ...find_public_business_procedures(file, source),
      ...find_unguarded_route_handlers(file, source),
      ...find_client_identity_fields(file, source),
      ...find_local_storage_token_writes(file, source),
      ...find_org_creation_outside_provisioning(file, source),
      ...find_ignored_type_errors(file, source),
    ];
  });
}

const repository_root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const scanned_roots = ["apps", "packages"];
const excluded_directories = new Set([
  "node_modules",
  ".next",
  "dist",
  "coverage",
  "__tests__",
  "chromadb-service",
]);
const source_extensions = new Set([".ts", ".tsx", ".js", ".jsx"]);

/**
 * Collect production source files (apps/ and packages/) for scanning.
 * Test files and build artifacts are excluded; next.config.js is included.
 *
 * @returns Repo-relative SourceFile list.
 */
export function collect_production_sources(): SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        if (!excluded_directories.has(entry)) walk(full);
        continue;
      }
      const has_source_extension = source_extensions.has(
        entry.slice(entry.lastIndexOf(".")),
      );
      const is_test = /\.(test|spec)\.[jt]sx?$/.test(entry);
      if (has_source_extension && !is_test) {
        files.push({
          path: normalize_path(relative(repository_root, full)),
          content: readFileSync(full, "utf8"),
        });
      }
    }
  };
  for (const root of scanned_roots) {
    walk(join(repository_root, root));
  }
  return files;
}

/**
 * CLI entry: scan the repository and exit non-zero on findings.
 */
function run_cli(): void {
  const findings = scan_private_boundaries(collect_production_sources());
  if (findings.length === 0) {
    console.log("security:scan — 0 private-boundary violations");
    return;
  }
  for (const finding of findings) {
    console.error(
      `${finding.file}:${finding.line} ${finding.code} — ${finding.detail}`,
    );
  }
  console.error(`security:scan — ${findings.length} violation(s)`);
  process.exitCode = 1;
}

const invoked_directly =
  process.argv[1] !== undefined &&
  normalize_path(resolve(process.argv[1])).endsWith(
    "scripts/security/scan-private-boundaries.ts",
  );

if (invoked_directly) {
  run_cli();
}
