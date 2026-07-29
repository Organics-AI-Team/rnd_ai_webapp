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
 *  - TENANT_REPOSITORY_BYPASS: a tenant-owned collection or Prisma model
 *    accessed directly outside the tenant repository layer, migration scripts,
 *    or the documented legacy ReAct tool paths (G2.7).
 *  - OODA_GATEWAY_BYPASS: a production caller drives the governed loop graph
 *    directly instead of through the AI gateway (G4.11).
 *  - LEGACY_ENTRY_POINT_IMPORT: the governed orchestration path (orchestration
 *    package + AI gateway) imports the legacy AI executor tree (G4.11).
 *  - AI_CONTROL_PLANE_BYPASS: provider/Qdrant SDKs, tool implementations, or
 *    AIRun creation are used outside their one sanctioned adapter/gateway.
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
  | "TENANT_REPOSITORY_BYPASS"
  | "OODA_GATEWAY_BYPASS"
  | "LEGACY_ENTRY_POINT_IMPORT"
  | "AI_CONTROL_PLANE_BYPASS"
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
 * Tenant-owned MongoDB collections that may be read or written only through the
 * tenant repository layer. products/orders are deliberately omitted: they are
 * reachable through the one sanctioned public client-order ingress
 * (submitClientOrder) which has no tenant execution context by design.
 */
const ENFORCED_TENANT_COLLECTIONS = new Set([
  "formulas",
  "formula_comments",
  "formula_version_logs",
  "price_calculations",
  "feedback",
  "conversations",
  "chat_threads",
  "chat_messages",
]);

/**
 * Prisma tenant control-plane models (G3.1) that may be accessed only through
 * the AI policy/usage repositories. Matched as `prisma.<model>.` call chains.
 */
const ENFORCED_TENANT_PRISMA_MODELS = new Set([
  "aIRun",
  "tenantAIProfile",
  "agentDeployment",
  "aIUsageLedger",
  "aIArtifact",
  "aIApproval",
]);

/**
 * Path fragments where direct tenant-data access is permitted: the repository
 * layer itself, migration/admin scripts, and the documented legacy ReAct tool
 * handlers (tenant-scoped in G2.6, slated for retirement in G5).
 */
const ALLOWED_TENANT_DATA_PATHS = [
  "/apps/ai/server/repositories/",
  "/apps/ai/scripts/",
  "/apps/ai/agents/react/tool-handlers/",
] as const;

/**
 * Governed-loop graph builders (G4). A caller that invokes a compiled loop
 * graph directly bypasses the AI gateway that pins policy, budget, and identity.
 */
const LOOP_GRAPH_BUILDERS = new Set([
  "compile_agent_loop_graph",
  "build_agent_loop_graph",
]);

/**
 * Path fragments allowed to drive the governed loop graph directly: the
 * orchestration package (which owns the graph and its recursive delegation) and
 * the AI gateway (the single sanctioned entry point that binds a run's runtime).
 */
const ALLOWED_OODA_DRIVER_PATHS = [
  "packages/ai-orchestration/",
  "ai-gateway",
] as const;

/**
 * The governed orchestration path: the orchestration package (which owns the
 * loop graph and its recursive delegation) and the AI gateway (the single
 * sanctioned run entry point). These files are held free of legacy AI executor
 * imports so an agentic run can never fall back into a legacy path.
 */
const GOVERNED_ORCHESTRATION_PATHS = [
  "packages/ai-orchestration/",
  "apps/ai/server/services/ai-gateway/",
] as const;

/**
 * Import-specifier fragments that reference the legacy AI executor tree
 * (apps/ai/agents/**: the ReAct agent, per-domain legacy agents, the agent
 * manager, and their fixed pipelines). Matched as a `/agents/` path segment so a
 * relative (`../agents/x`), aliased (`@/ai/agents/x`), or workspace import all
 * resolve, while unrelated words like `subagents` never trip the check.
 */
const LEGACY_AI_ENTRY_POINT_FRAGMENTS = ["/agents/"] as const;

const PROVIDER_MODULES = new Set([
  "openai",
  "@anthropic-ai/sdk",
  "@google/generative-ai",
  "@google/genai",
]);

const PROVIDER_ADAPTER_PATHS = [
  "apps/ai/services/providers/",
  "apps/ai/services/embeddings/",
  "apps/ai/server/services/ai-control/providers/",
  "apps/ai/server/services/ai-gateway/providers/",
] as const;

const QDRANT_ADAPTER_PATHS = [
  "apps/ai/services/vector/",
  "apps/ai/server/services/knowledge/",
] as const;

/**
 * Bounded legacy exceptions, all removed by G5.10. They are never reachable
 * from the governed gateway because LEGACY_ENTRY_POINT_IMPORT separately
 * rejects that dependency direction.
 */
const G5_LEGACY_AI_BOUNDARY_EXCEPTIONS = [
  "apps/ai/agents/",
  "apps/ai/services/rag/",
  "apps/web/lib/services/embedding.ts",
  "apps/web/app/api/ai-chat/",
  "apps/web/app/api/ai/enhanced-chat/",
  "apps/web/app/api/ai/cosmetic-enhanced/",
  "apps/web/app/api/ai/raw-materials-agent/",
] as const;

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
  // The exact public liveness probe returns only a constant status and lets
  // Docker Compose and the droplet reverse proxy verify the web container.
  if (path.endsWith("/app/api/health/route.ts")) return [];
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
 * Determine whether a file may access tenant data directly (repository layer,
 * migration scripts, or the documented legacy ReAct tool handlers).
 *
 * @param path - Slash-normalized file path (absolute or repo-relative).
 * @returns True when direct tenant-data access is permitted for this file.
 */
function is_allowed_tenant_data_path(path: string): boolean {
  // Prepend a leading slash so repo-relative paths (apps/ai/...) and absolute
  // paths (/repo/apps/ai/...) both match the leading-slash allowed fragments.
  const normalized = `/${normalize_path(path).replace(/^\/+/, "")}`;
  return ALLOWED_TENANT_DATA_PATHS.some((allowed) =>
    normalized.includes(allowed),
  );
}

/**
 * Read the single string-literal argument of a `.collection('name')` call.
 *
 * @param node - Candidate call expression.
 * @returns The collection name, or null when the node is not such a call.
 */
function read_collection_name(node: ts.CallExpression): string | null {
  if (
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "collection" &&
    node.arguments.length === 1 &&
    ts.isStringLiteralLike(node.arguments[0])
  ) {
    return node.arguments[0].text;
  }
  return null;
}

/**
 * Read the model name of a `prisma.<model>.<op>(...)` call chain.
 *
 * @param node - Candidate call expression.
 * @returns The Prisma model name, or null when the node is not such a call.
 */
function read_prisma_model_name(node: ts.CallExpression): string | null {
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  const model_access = node.expression.expression;
  if (
    ts.isPropertyAccessExpression(model_access) &&
    ts.isIdentifier(model_access.expression) &&
    model_access.expression.text === "prisma"
  ) {
    return model_access.name.text;
  }
  return null;
}

/**
 * Find direct tenant-collection and tenant-Prisma-model access. Callers must
 * gate this by {@link is_allowed_tenant_data_path} — this function itself does
 * not exempt any path, so it can be reused on synthetic fixtures.
 *
 * @param file - Scanned file.
 * @param source - Parsed AST.
 * @returns TENANT_REPOSITORY_BYPASS findings.
 */
function find_tenant_collection_access(
  file: SourceFile,
  source: ts.SourceFile,
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const collection = read_collection_name(node);
      if (collection && ENFORCED_TENANT_COLLECTIONS.has(collection)) {
        findings.push(
          finding_at(
            file,
            source,
            node,
            "TENANT_REPOSITORY_BYPASS",
            `tenant collection '${collection}' must be accessed through a tenant repository`,
          ),
        );
      }
      const model = read_prisma_model_name(node);
      if (model && ENFORCED_TENANT_PRISMA_MODELS.has(model)) {
        findings.push(
          finding_at(
            file,
            source,
            node,
            "TENANT_REPOSITORY_BYPASS",
            `tenant Prisma model 'prisma.${model}' must be accessed through a repository`,
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
 * Reject direct tenant-data access unless the file is an allowed tenant-data
 * path. Exported for fixture-driven tests (G2.7 failing-test anchor).
 *
 * @param file - Scanned file.
 * @returns TENANT_REPOSITORY_BYPASS findings, or [] for allowed paths.
 */
export function reject_tenant_collection_bypass(
  file: SourceFile,
): SecurityFinding[] {
  if (is_allowed_tenant_data_path(file.path)) return [];
  return find_tenant_collection_access(file, parse(file));
}

/**
 * Whether a file may drive the governed loop graph directly (orchestration
 * package internals or the AI gateway), or is a test fixture.
 *
 * @param path - Slash-normalized file path.
 * @returns True when the OODA-boundary rule does not apply.
 */
function is_ooda_boundary_exempt(path: string): boolean {
  if (/\.(test|spec)\.[jt]sx?$/.test(path)) return true;
  return ALLOWED_OODA_DRIVER_PATHS.some((fragment) => path.includes(fragment));
}

/**
 * Whether a node is a governed-loop-graph builder call
 * (`compile_agent_loop_graph(...)` / `build_agent_loop_graph(...)`), unwrapping
 * an optional `await`. Only these builders identify the governed loop — a bare
 * `graph` variable is ambiguous with legacy LangGraph graphs.
 *
 * @param node - Candidate expression (initializer or call receiver).
 * @returns True when the node builds a governed loop graph.
 */
function is_loop_builder_call(node: ts.Node): boolean {
  const expression = ts.isAwaitExpression(node) ? node.expression : node;
  return (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    LOOP_GRAPH_BUILDERS.has(expression.expression.text)
  );
}

/**
 * Find direct governed-loop-graph invocations in a parsed file.
 *
 * Flags `.invoke`/`.stream` on a governed loop graph, identified either as a
 * direct builder call or a local variable bound to one — so legacy LangGraph
 * graphs that happen to be named `graph` are never mistaken for the governed
 * loop.
 *
 * @param file - Scanned file.
 * @param source - Parsed AST.
 * @returns OODA_GATEWAY_BYPASS findings.
 */
function find_ooda_boundary_violations(
  file: SourceFile,
  source: ts.SourceFile,
): SecurityFinding[] {
  // Phase 1: local variables bound to a governed-loop-graph builder call.
  const loop_graph_vars = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      is_loop_builder_call(node.initializer)
    ) {
      loop_graph_vars.add(node.name.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  // Phase 2: flag invoke/stream on a builder call or a bound loop-graph var.
  const findings: SecurityFinding[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === "invoke" || node.expression.name.text === "stream")
    ) {
      const receiver = node.expression.expression;
      const drives_loop =
        is_loop_builder_call(receiver) ||
        (ts.isIdentifier(receiver) && loop_graph_vars.has(receiver.text));
      if (drives_loop) {
        findings.push(
          finding_at(
            file,
            source,
            node,
            "OODA_GATEWAY_BYPASS",
            "the governed loop graph may be driven only through the AI gateway",
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
 * Reject direct invocation of the governed loop graph outside the AI gateway.
 *
 * Flags `graph.invoke(...)`, `graph.stream(...)`, and
 * `compile_agent_loop_graph(...).invoke|stream(...)` so no production caller can
 * drive an agentic run without the gateway that pins policy, budget, and
 * identity. The orchestration package (which owns the graph and its recursive
 * delegation), the AI gateway, and test files are exempt. Exported for
 * fixture-driven tests (G4.11 failing-test anchor).
 *
 * @param file - Scanned file.
 * @returns OODA_GATEWAY_BYPASS findings, or [] for exempt files.
 */
export function reject_ooda_boundary_bypass(file: SourceFile): SecurityFinding[] {
  if (is_ooda_boundary_exempt(file.path)) return [];
  return find_ooda_boundary_violations(file, parse(file));
}

/**
 * Whether a file is in the governed orchestration path and subject to the
 * legacy-import rule (test files are never scanned).
 *
 * @param path - Repo-relative file path.
 * @returns True when the legacy-entry-point rule applies to the file.
 */
function is_legacy_entry_point_scanned(path: string): boolean {
  const normalized = normalize_path(path);
  if (/\.(test|spec)\.[jt]sx?$/.test(normalized)) return false;
  return GOVERNED_ORCHESTRATION_PATHS.some((fragment) => normalized.includes(fragment));
}

/**
 * Whether an import specifier resolves into the legacy AI executor tree.
 *
 * @param specifier - The module specifier string from an import/export/require.
 * @returns True when the specifier references apps/ai/agents/**.
 */
function is_legacy_entry_point_specifier(specifier: string): boolean {
  const normalized = specifier.replace(/\\/g, "/");
  if (normalized.startsWith("agents/")) return true;
  return LEGACY_AI_ENTRY_POINT_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

/**
 * Extract the string module specifier a node imports, if any.
 *
 * Covers static `import`/`export ... from`, dynamic `import("…")`, and
 * `require("…")` with a string-literal argument.
 *
 * @param node - Candidate AST node.
 * @returns The specifier text, or null when the node is not a module reference.
 */
function module_specifier_of(node: ts.Node): string | null {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier !== undefined &&
    ts.isStringLiteral(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier.text;
  }
  if (ts.isCallExpression(node) && node.arguments.length > 0) {
    const is_dynamic_import = node.expression.kind === ts.SyntaxKind.ImportKeyword;
    const is_require =
      ts.isIdentifier(node.expression) && node.expression.text === "require";
    const argument = node.arguments[0];
    if ((is_dynamic_import || is_require) && ts.isStringLiteral(argument)) {
      return argument.text;
    }
  }
  return null;
}

/**
 * Find legacy AI executor imports inside a governed orchestration file.
 *
 * @param file - Scanned file.
 * @param source - Parsed AST.
 * @returns LEGACY_ENTRY_POINT_IMPORT findings.
 */
function find_legacy_entry_point_imports(
  file: SourceFile,
  source: ts.SourceFile,
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const visit = (node: ts.Node): void => {
    const specifier = module_specifier_of(node);
    if (specifier !== null && is_legacy_entry_point_specifier(specifier)) {
      findings.push(
        finding_at(
          file,
          source,
          node,
          "LEGACY_ENTRY_POINT_IMPORT",
          `the governed orchestration path must not import the legacy AI executor "${specifier}"`,
        ),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

/**
 * Reject imports of the legacy AI executor tree from the governed orchestration
 * path, so an agentic run can never fall back into a legacy ReAct/pipeline/
 * agent-manager executor. Only the orchestration package and the AI gateway are
 * policed; the legacy tree itself and test files are not. Exported for
 * fixture-driven tests (G4.11).
 *
 * @param file - Scanned file.
 * @returns LEGACY_ENTRY_POINT_IMPORT findings, or [] when out of scope.
 */
export function reject_legacy_entry_point_import(file: SourceFile): SecurityFinding[] {
  if (!is_legacy_entry_point_scanned(file.path)) return [];
  return find_legacy_entry_point_imports(file, parse(file));
}

function path_has_any(path: string, fragments: readonly string[]): boolean {
  const normalized = normalize_path(path);
  return fragments.some((fragment) => normalized.includes(fragment));
}

function is_provider_sdk_reference(node: ts.Node): boolean {
  const specifier = module_specifier_of(node);
  if (specifier !== null && PROVIDER_MODULES.has(specifier)) return true;
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
    return new Set([
      "OpenAI",
      "Anthropic",
      "GoogleGenerativeAI",
      "GoogleGenAI",
    ]).has(node.expression.text);
  }
  return false;
}

function is_qdrant_sdk_reference(node: ts.Node): boolean {
  const specifier = module_specifier_of(node);
  if (specifier === "@qdrant/js-client-rest") return true;
  return (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "QdrantClient"
  );
}

function is_tool_implementation_call(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return false;
  }
  if (node.expression.name.text !== "execute") return false;
  const receiver = node.expression.expression.getText();
  return /(^|\.)(definition|tool_definition)$/.test(receiver);
}

function is_ai_run_create_call(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return false;
  }
  if (node.expression.name.text !== "create") return false;
  const receiver = node.expression.expression.getText();
  return /(^|\.)(runs|ai_runs|run_repository)$/.test(receiver);
}

/**
 * Find direct control-plane dependencies outside their approved adapters.
 * Each category emits at most one finding per file to keep scanner output
 * actionable even when an import, constructor, and method call co-occur.
 */
function find_ai_control_plane_bypasses(
  file: SourceFile,
  source: ts.SourceFile,
): SecurityFinding[] {
  const path = normalize_path(file.path);
  if (/\.(test|spec)\.[jt]sx?$/.test(path)) return [];
  if (path_has_any(path, G5_LEGACY_AI_BOUNDARY_EXCEPTIONS)) return [];

  const allow_provider = path_has_any(path, PROVIDER_ADAPTER_PATHS);
  const allow_qdrant = path_has_any(path, QDRANT_ADAPTER_PATHS);
  const allow_tool =
    path.endsWith("apps/ai/server/services/ai-control/tool-executor.ts") ||
    path.includes("packages/ai-orchestration/");
  const allow_run_create = path.includes("apps/ai/server/services/ai-gateway/");
  const seen = new Set<string>();
  const findings: SecurityFinding[] = [];

  const add_once = (node: ts.Node, category: string, detail: string): void => {
    if (seen.has(category)) return;
    seen.add(category);
    findings.push(
      finding_at(file, source, node, "AI_CONTROL_PLANE_BYPASS", detail),
    );
  };
  const visit = (node: ts.Node): void => {
    if (!allow_provider && is_provider_sdk_reference(node)) {
      add_once(
        node,
        "provider",
        "provider SDKs may be used only by approved provider adapters",
      );
    }
    if (!allow_qdrant && is_qdrant_sdk_reference(node)) {
      add_once(
        node,
        "qdrant",
        "Qdrant SDK access may occur only in the vector/knowledge adapters",
      );
    }
    if (!allow_tool && is_tool_implementation_call(node)) {
      add_once(
        node,
        "tool",
        "tool implementations may be invoked only by ToolExecutor",
      );
    }
    if (!allow_run_create && is_ai_run_create_call(node)) {
      add_once(
        node,
        "run",
        "AIRun creation may occur only in the authenticated AI gateway",
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

/** Reject provider/tool/vector/run admission bypasses outside approved paths. */
export function reject_ai_control_plane_bypass(
  file: SourceFile,
): SecurityFinding[] {
  return find_ai_control_plane_bypasses(file, parse(file));
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
      ...(is_allowed_tenant_data_path(file.path)
        ? []
        : find_tenant_collection_access(file, source)),
      ...(is_ooda_boundary_exempt(file.path)
        ? []
        : find_ooda_boundary_violations(file, source)),
      ...(is_legacy_entry_point_scanned(file.path)
        ? find_legacy_entry_point_imports(file, source)
        : []),
      ...find_ai_control_plane_bypasses(file, source),
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
