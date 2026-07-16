/**
 * G3 Task 4 — governed tool catalogue and executor tests.
 *
 * Covers the failing-test anchors from the tenant AI control-plane plan:
 * unknown tool, disabled tool, missing permission, invalid input, injected
 * tenant field, approval required, duplicate side effect, timeout/retry,
 * and successful read/write execution. All ports are in-process fakes.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ToolCatalogue } from "../../apps/ai/server/services/ai-control/tool-catalogue";
import { ToolExecutor } from "../../apps/ai/server/services/ai-control/tool-executor";
import { ToolGovernanceError } from "../../apps/ai/server/services/ai-control/errors";
import {
  create_formula_tool_definitions,
  type FormulaToolPorts,
} from "../../apps/ai/server/services/ai-control/tools/formula-tools";
import {
  create_knowledge_tool_definitions,
  type KnowledgeToolPorts,
} from "../../apps/ai/server/services/ai-control/tools/knowledge-tools";
import {
  create_web_search_tool_definitions,
} from "../../apps/ai/server/services/ai-control/tools/web-search-tools";
import {
  create_all_governed_tool_definitions,
  create_not_wired_governed_tool_ports,
} from "../../apps/ai/server/services/ai-control/tools";
import {
  make_context,
  governed_formula_artifact,
  make_echo_tool,
  make_policy,
  make_ports,
  make_temp_cards_root,
  tenant_b,
} from "./helpers";

/**
 * Build fake formula ports whose methods record calls and return
 * schema-valid canned results.
 *
 * @returns Fake FormulaToolPorts plus per-method call counters.
 */
function make_fake_formula_ports(): {
  ports: FormulaToolPorts;
  calls: Record<string, number>;
} {
  const calls: Record<string, number> = {
    search: 0,
    draft: 0,
    revise: 0,
    comment: 0,
    confirm: 0,
  };
  const ports: FormulaToolPorts = {
    formula_search: {
      async search_formulas() {
        calls.search += 1;
        return {
          result_count: 1,
          formulas: [
            {
              formula_id: "f".repeat(24),
              formula_code: "FM-0001",
              formula_name: "Brightening Serum",
              version: 2,
              status: "confirmed",
              client_name: null,
              target_benefits: ["brightening"],
              ingredient_count: 8,
              total_amount_grams: 100,
              updated_at: "2026-07-01T00:00:00.000Z",
            },
          ],
        };
      },
    },
    formula_draft: {
      async create_draft_formula(args) {
        calls.draft += 1;
        return args.artifact;
      },
    },
    formula_revise: {
      async revise_formula(args) {
        calls.revise += 1;
        return args.artifact;
      },
    },
    formula_comment: {
      async add_formula_comment(args) {
        calls.comment += 1;
        return {
          comment_id: "c".repeat(24),
          formula_id: args.formula_id,
          comment_type: args.comment_type ?? "feedback",
          created_at: "2026-07-15T00:00:00.000Z",
        };
      },
    },
    formula_confirm: {
      async confirm_formula(args) {
        calls.confirm += 1;
        return {
          artifact_id: args.artifact_id,
          formula_id: "f".repeat(24),
          status: "confirmed" as const,
          already_committed: false,
        };
      },
    },
  };
  return { ports, calls };
}

/**
 * Build a catalogue preloaded with all governed formula tools backed by fakes.
 *
 * @returns Catalogue, fake ports bundle, and call counters.
 */
function make_formula_catalogue() {
  const catalogue = new ToolCatalogue();
  const { ports, calls } = make_fake_formula_ports();
  for (const definition of create_formula_tool_definitions(ports)) {
    catalogue.register(definition);
  }
  return { catalogue, calls };
}

describe("tool catalogue registration", () => {
  it("refuses to register a tool whose input schema is not strict", () => {
    const cards_root = make_temp_cards_root();
    const catalogue = new ToolCatalogue();
    const loose = make_echo_tool(cards_root, {
      input_schema: z.object({ query: z.string() }) as never,
    });
    expect(() => catalogue.register(loose)).toThrowError(
      expect.objectContaining({ code: "TOOL_SCHEMA_NOT_STRICT" }),
    );
  });

  it("refuses to register a tool that declares a forbidden identity field", () => {
    const cards_root = make_temp_cards_root();
    const catalogue = new ToolCatalogue();
    const leaky = make_echo_tool(cards_root, {
      input_schema: z
        .object({ query: z.string(), tenantId: z.string() })
        .strict() as never,
    });
    expect(() => catalogue.register(leaky)).toThrowError(
      expect.objectContaining({ code: "TOOL_SCHEMA_FORBIDDEN_FIELD" }),
    );
  });

  it("refuses duplicate tool names", () => {
    const cards_root = make_temp_cards_root();
    const catalogue = new ToolCatalogue();
    catalogue.register(make_echo_tool(cards_root));
    expect(() => catalogue.register(make_echo_tool(cards_root))).toThrowError(
      expect.objectContaining({ code: "TOOL_ALREADY_REGISTERED" }),
    );
  });

  it("filters the catalogue by the tenant policy allowlist", () => {
    const { catalogue } = make_formula_catalogue();
    const allowed = catalogue.filter_by_policy(
      make_policy({ allowed_tools: ["formula.search"] }),
    );
    expect(allowed.map((definition) => definition.name)).toEqual([
      "formula.search",
    ]);
  });
});

describe("tool executor governance", () => {
  it("rejects an unknown tool and audits the attempt", async () => {
    const { catalogue } = make_formula_catalogue();
    const ports = make_ports();
    const executor = new ToolExecutor(catalogue, ports);
    await expect(
      executor.execute(
        { name: "platform.disable_policy", arguments: {} },
        make_context(),
      ),
    ).rejects.toMatchObject({ code: "TOOL_UNKNOWN" });
    expect(ports.audit_log.events).toHaveLength(1);
    expect(ports.audit_log.events[0]).toMatchObject({
      tool_name: "platform.disable_policy",
      outcome: "denied",
      error_code: "TOOL_UNKNOWN",
    });
  });

  it("rejects a registered tool outside the tenant policy allowlist", async () => {
    const { catalogue } = make_formula_catalogue();
    const executor = new ToolExecutor(catalogue, make_ports());
    const context = make_context({
      policy: make_policy({ allowed_tools: ["knowledge.search"] }),
    });
    await expect(
      executor.execute(
        { name: "formula.search", arguments: { query: "serum" } },
        context,
      ),
    ).rejects.toMatchObject({ code: "TOOL_NOT_ALLOWED" });
  });

  it("rejects every tool when the tenant policy disables AI", async () => {
    const { catalogue } = make_formula_catalogue();
    const executor = new ToolExecutor(catalogue, make_ports());
    const context = make_context({ policy: make_policy({ enabled: false }) });
    await expect(
      executor.execute(
        { name: "formula.search", arguments: { query: "serum" } },
        context,
      ),
    ).rejects.toMatchObject({ code: "POLICY_DISABLED" });
  });

  it("rejects a caller without the required permission", async () => {
    const { catalogue } = make_formula_catalogue();
    const executor = new ToolExecutor(catalogue, make_ports());
    const context = make_context({ permissions: ["tenant:knowledge:read"] });
    await expect(
      executor.execute(
        { name: "formula.search", arguments: { query: "serum" } },
        context,
      ),
    ).rejects.toMatchObject({ code: "TOOL_PERMISSION_DENIED" });
  });

  it("rejects structurally invalid input", async () => {
    const { catalogue } = make_formula_catalogue();
    const executor = new ToolExecutor(catalogue, make_ports());
    await expect(
      executor.execute(
        { name: "formula.search", arguments: { limit: 5 } },
        make_context(),
      ),
    ).rejects.toMatchObject({ code: "TOOL_INPUT_INVALID" });
  });

  it("rejects a model-supplied tenant field", async () => {
    const { catalogue, calls } = make_formula_catalogue();
    const executor = new ToolExecutor(catalogue, make_ports());
    await expect(
      executor.execute(
        {
          name: "formula.search",
          arguments: { query: "serum", tenantId: tenant_b },
        },
        make_context(),
      ),
    ).rejects.toMatchObject({ code: "TOOL_INPUT_INVALID" });
    expect(calls.search).toBe(0);
  });

  it("rejects nested identity and Mongo operator keys in model input", async () => {
    const { catalogue, calls } = make_formula_catalogue();
    const executor = new ToolExecutor(catalogue, make_ports());
    await expect(
      executor.execute(
        {
          name: "formula.draft",
          arguments: {
            artifact: { ...governed_formula_artifact(), $where: "sleep(1000)" },
          },
        },
        make_context(),
      ),
    ).rejects.toMatchObject({ code: "TOOL_INPUT_INVALID" });
    await expect(
      executor.execute(
        {
          name: "formula.draft",
          arguments: {
            artifact: { ...governed_formula_artifact(), userId: "someone-else" },
          },
        },
        make_context(),
      ),
    ).rejects.toMatchObject({ code: "TOOL_INPUT_INVALID" });
    expect(calls.draft).toBe(0);
  });

  it("requires a durable manager approval before a commit tool runs", async () => {
    const { catalogue, calls } = make_formula_catalogue();
    const ports = make_ports();
    const executor = new ToolExecutor(catalogue, ports);
    const proposal = {
      name: "formula.confirm",
      arguments: { artifact_id: "a".repeat(24), remarks: "approved by manager" },
    };
    await expect(executor.execute(proposal, make_context())).rejects.toMatchObject(
      { code: "TOOL_APPROVAL_REQUIRED" },
    );
    expect(calls.confirm).toBe(0);

    ports.approval_service.approved = true;
    const result = await executor.execute(proposal, make_context());
    expect(result.output).toMatchObject({ status: "confirmed", already_committed: false });
    expect(calls.confirm).toBe(1);
    expect(ports.approval_service.queries[0]).toMatchObject({
      tool_name: "formula.confirm",
      run_id: "run_0001",
    });
  });

  it("lets tenant policy escalate a tool to manager approval", async () => {
    const { catalogue } = make_formula_catalogue();
    const ports = make_ports();
    const executor = new ToolExecutor(catalogue, ports);
    const context = make_context({
      policy: make_policy({
        approval_rules: {
          "formula.confirm": "manager",
          "formula.draft": "manager",
        },
      }),
    });
    await expect(
      executor.execute(
        {
          name: "formula.draft",
          arguments: { artifact: governed_formula_artifact() },
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "TOOL_APPROVAL_REQUIRED" });
  });

  it("returns the recorded result instead of repeating a side effect", async () => {
    const { catalogue, calls } = make_formula_catalogue();
    const ports = make_ports();
    const executor = new ToolExecutor(catalogue, ports);
    const proposal = {
      name: "formula.draft",
      arguments: { artifact: governed_formula_artifact() },
    };
    const first = await executor.execute(proposal, make_context());
    const second = await executor.execute(proposal, make_context());
    expect(calls.draft).toBe(1);
    expect(first.from_cache).toBe(false);
    expect(second.from_cache).toBe(true);
    expect(second.output).toEqual(first.output);
    expect(second.idempotency_key).toBe(first.idempotency_key);
  });

  it("derives distinct idempotency keys for distinct steps or arguments", async () => {
    const { catalogue, calls } = make_formula_catalogue();
    const executor = new ToolExecutor(catalogue, make_ports());
    const proposal = {
      name: "formula.draft",
      arguments: { artifact: governed_formula_artifact() },
    };
    const first = await executor.execute(proposal, make_context());
    const second = await executor.execute(
      proposal,
      make_context({ step_id: "step_0002" }),
    );
    expect(first.idempotency_key).not.toBe(second.idempotency_key);
    expect(first.idempotency_key).toMatch(/^[a-f0-9]{64}$/);
    expect(calls.draft).toBe(2);
  });

  it("times out a hanging tool with TOOL_TIMEOUT", async () => {
    const cards_root = make_temp_cards_root();
    const catalogue = new ToolCatalogue();
    catalogue.register(
      make_echo_tool(cards_root, {
        timeout_ms: 25,
        execute: () => new Promise(() => undefined),
      }),
    );
    const executor = new ToolExecutor(catalogue, make_ports());
    await expect(
      executor.execute(
        { name: "tool.echo", arguments: { query: "hang" } },
        make_context(),
      ),
    ).rejects.toMatchObject({ code: "TOOL_TIMEOUT" });
  });

  it("retries a transient read failure and then succeeds", async () => {
    const cards_root = make_temp_cards_root();
    const catalogue = new ToolCatalogue();
    let attempts = 0;
    catalogue.register(
      make_echo_tool(cards_root, {
        retry: { max_attempts: 2, backoff_ms: 1 },
        execute: async (args) => {
          attempts += 1;
          if (attempts === 1) throw new Error("transient upstream failure");
          return { echoed: args.query };
        },
      }),
    );
    const executor = new ToolExecutor(catalogue, make_ports());
    const result = await executor.execute(
      { name: "tool.echo", arguments: { query: "retry" } },
      make_context(),
    );
    expect(result.output).toEqual({ echoed: "retry" });
    expect(result.attempts).toBe(2);
    expect(attempts).toBe(2);
  });

  it("never retries a side-effecting tool", async () => {
    const cards_root = make_temp_cards_root();
    const catalogue = new ToolCatalogue();
    let attempts = 0;
    catalogue.register(
      make_echo_tool(cards_root, {
        name: "tool.echo_write",
        side_effect: "draft_write",
        retry: { max_attempts: 3, backoff_ms: 1 },
        execute: async () => {
          attempts += 1;
          throw new Error("write failed");
        },
      }),
    );
    const executor = new ToolExecutor(catalogue, make_ports());
    const context = make_context({
      policy: make_policy({ allowed_tools: ["tool.echo_write"] }),
    });
    await expect(
      executor.execute(
        { name: "tool.echo_write", arguments: { query: "once" } },
        context,
      ),
    ).rejects.toMatchObject({ code: "TOOL_EXECUTION_FAILED" });
    expect(attempts).toBe(1);
  });

  it("rejects output that violates the tool output schema", async () => {
    const cards_root = make_temp_cards_root();
    const catalogue = new ToolCatalogue();
    catalogue.register(
      make_echo_tool(cards_root, {
        execute: async () => ({ echoed: 42 }) as never,
      }),
    );
    const executor = new ToolExecutor(catalogue, make_ports());
    await expect(
      executor.execute(
        { name: "tool.echo", arguments: { query: "bad-output" } },
        make_context(),
      ),
    ).rejects.toMatchObject({ code: "TOOL_OUTPUT_INVALID" });
  });

  it("executes a successful read tool with metering and audit", async () => {
    const catalogue = new ToolCatalogue();
    const knowledge_ports: KnowledgeToolPorts = {
      knowledge_search: {
        async search_knowledge(args) {
          return {
            results: [
              {
                source_id: "src_0001",
                source_name: "Platform ingredient monograph",
                scope: "platform" as const,
                excerpt: `Evidence about ${args.query}`,
                relevance_score: 0.91,
                content_hash: "b".repeat(64),
              },
            ],
          };
        },
      },
    };
    for (const definition of create_knowledge_tool_definitions(knowledge_ports)) {
      catalogue.register(definition);
    }
    const ports = make_ports();
    const executor = new ToolExecutor(catalogue, ports);
    const result = await executor.execute(
      { name: "knowledge.search", arguments: { query: "niacinamide", top_k: 3 } },
      make_context(),
    );
    expect(result.output.results[0]).toMatchObject({
      source_id: "src_0001",
      scope: "platform",
    });
    expect(ports.usage_service.entries).toHaveLength(1);
    expect(ports.usage_service.entries[0]).toMatchObject({
      tenant_id: make_context().tenant_id,
      run_id: "run_0001",
      tool_name: "knowledge.search",
      outcome: "success",
    });
    expect(ports.audit_log.events).toHaveLength(1);
    expect(ports.audit_log.events[0]).toMatchObject({
      tool_name: "knowledge.search",
      outcome: "success",
      side_effect: "read",
    });
    expect(ports.audit_log.events[0].arguments_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("executes a successful draft write end to end", async () => {
    const { catalogue, calls } = make_formula_catalogue();
    const ports = make_ports();
    const executor = new ToolExecutor(catalogue, ports);
    const result = await executor.execute(
      {
        name: "formula.draft",
        arguments: { artifact: governed_formula_artifact() },
      },
      make_context(),
    );
    expect(result.output).toEqual(governed_formula_artifact());
    expect(calls.draft).toBe(1);
    expect(ports.usage_service.entries).toHaveLength(1);
    expect(ports.audit_log.events[0]).toMatchObject({
      outcome: "success",
      side_effect: "draft_write",
    });
  });

  it("fails closed with NOT_WIRED until production adapters are integrated", async () => {
    const catalogue = new ToolCatalogue();
    for (const definition of create_all_governed_tool_definitions(
      create_not_wired_governed_tool_ports(),
    )) {
      catalogue.register(definition);
    }
    expect(catalogue.list()).toHaveLength(7);
    const executor = new ToolExecutor(catalogue, make_ports());
    await expect(
      executor.execute(
        { name: "web.search", arguments: { query: "INCI updates 2026" } },
        make_context(),
      ),
    ).rejects.toMatchObject({ code: "NOT_WIRED" });
  });

  it("exposes web.search as a governed read tool", async () => {
    const catalogue = new ToolCatalogue();
    for (const definition of create_web_search_tool_definitions({
      web_search: {
        async search_web(args) {
          return {
            answer: `Grounded answer for ${args.query}`,
            sources: [
              {
                title: "Cosmetics Regulation",
                url: "https://example.org/regulation",
                snippet: "Annex entry",
              },
            ],
          };
        },
      },
    })) {
      catalogue.register(definition);
    }
    const definition = catalogue.get("web.search");
    expect(definition).toMatchObject({
      side_effect: "read",
      required_permission: "ai:run",
      approval_requirement: "none",
    });
    const executor = new ToolExecutor(catalogue, make_ports());
    const result = await executor.execute(
      { name: "web.search", arguments: { query: "INCI updates 2026" } },
      make_context(),
    );
    expect(result.output.sources).toHaveLength(1);
  });

  it("throws typed ToolGovernanceError instances", async () => {
    const { catalogue } = make_formula_catalogue();
    const executor = new ToolExecutor(catalogue, make_ports());
    const error = await executor
      .execute({ name: "nope", arguments: {} }, make_context())
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ToolGovernanceError);
  });
});
