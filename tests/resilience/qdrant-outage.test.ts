/** Credential-free Qdrant outage and empty-retrieval verification (G5.8). */

import { describe, expect, it } from "vitest";

import { ToolCatalogue } from "../../apps/ai/server/services/ai-control/tool-catalogue";
import { ToolExecutor } from "../../apps/ai/server/services/ai-control/tool-executor";
import { create_knowledge_tool_definitions } from "../../apps/ai/server/services/ai-control/tools/knowledge-tools";
import { create_knowledge_gateway } from "../../apps/ai/server/services/knowledge/knowledge-gateway";
import {
  create_qdrant_knowledge_adapter,
  type KnowledgeQdrantDriver,
  type KnowledgeQdrantResult,
} from "../../apps/ai/server/services/knowledge/qdrant-collections";
import type { TenantExecutionContext } from "../../packages/shared-types/src/tenant";
import { make_context, make_ports } from "../ai-control/helpers";

const VECTOR = Object.freeze([0.25, 0.75]);

/** Driver whose search responses are scripted without a Qdrant process. */
class ScriptedQdrantDriver implements KnowledgeQdrantDriver {
  attempts = 0;

  constructor(private readonly results: readonly (Error | readonly KnowledgeQdrantResult[])[]) {}

  async ensure_collection(): Promise<void> {}

  async search(): Promise<readonly KnowledgeQdrantResult[]> {
    const result = this.results[this.attempts];
    this.attempts += 1;
    if (result instanceof Error) throw result;
    if (!result) throw new Error("Qdrant search script exhausted");
    return result;
  }

  async upsert(): Promise<void> {}

  async delete(): Promise<void> {}
}

/** Build the real governed knowledge tool over injected embedding/Qdrant seams. */
function knowledge_tool(driver: ScriptedQdrantDriver): ToolExecutor {
  const vector_port = create_qdrant_knowledge_adapter({
    driver,
    embedding_version: "synthetic_v1",
    vector_size: VECTOR.length,
  });
  const gateway = create_knowledge_gateway({
    vector_port,
    embedding_port: {
      async embed() {
        return VECTOR;
      },
    },
    access_policy: {
      async authorize() {},
    },
    embedding_version: "synthetic_v1",
  });
  const catalogue = new ToolCatalogue();
  for (const definition of create_knowledge_tool_definitions({
    knowledge_search: {
      async search_knowledge(args, trusted_context) {
        const context = {
          tenant_id: trusted_context.tenant_id,
          actor_profile_id: trusted_context.actor_profile_id,
          correlation_id: trusted_context.correlation_id,
        } as TenantExecutionContext;
        const evidence = await gateway.search(context, {
          query: args.query,
          scope: args.scope ?? "both",
          limit: args.top_k,
        });
        return {
          results: evidence.map((row) => ({
            source_id: row.source_id,
            source_name: "Synthetic governed source",
            scope: row.scope,
            excerpt: row.content,
            relevance_score: row.score,
            content_hash: row.content_hash,
          })),
        };
      },
    },
  })) {
    catalogue.register(definition);
  }
  return new ToolExecutor(catalogue, make_ports());
}

describe("Qdrant outage behavior", () => {
  it("retries one transient Qdrant outage and returns an explicit empty evidence set", async () => {
    const driver = new ScriptedQdrantDriver([
      new Error("synthetic Qdrant unavailable"),
      [],
    ]);
    const result = await knowledge_tool(driver).execute(
      {
        name: "knowledge.search",
        arguments: { query: "synthetic ingredient", scope: "platform", top_k: 3 },
      },
      make_context(),
    );

    expect(driver.attempts).toBe(2);
    expect(result.attempts).toBe(2);
    expect(result.output).toEqual({ results: [] });
  });

  it("fails with a stable tool error after the bounded Qdrant retry budget", async () => {
    const driver = new ScriptedQdrantDriver([
      new Error("synthetic Qdrant unavailable"),
      new Error("synthetic Qdrant unavailable"),
    ]);
    await expect(
      knowledge_tool(driver).execute(
        {
          name: "knowledge.search",
          arguments: { query: "synthetic ingredient", scope: "platform", top_k: 3 },
        },
        make_context(),
      ),
    ).rejects.toMatchObject({
      code: "TOOL_EXECUTION_FAILED",
      retryable: true,
    });
    expect(driver.attempts).toBe(2);
  });
});
