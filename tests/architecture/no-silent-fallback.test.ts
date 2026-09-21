import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

const RETIRED_AI_ROUTES = [
  "apps/web/app/api/ai/cosmetic-enhanced/route.ts",
  "apps/web/app/api/ai/enhanced-chat/route.ts",
  "apps/web/app/api/ai/raw-materials-agent/route.ts",
  "apps/web/app/api/ai/raw-materials-agent/langgraph-route.ts",
  "apps/web/app/api/ai-chat/route.ts",
  "apps/web/app/api/ai-chat/refresh/route.ts",
  "apps/web/app/api/agents/execute/route.ts",
  "apps/web/app/api/agents/[agentId]/chat/route.ts",
  "apps/web/app/api/rag/unified-search/route.ts",
  "apps/web/app/api/rag/hybrid-search/route.ts",
  "apps/web/app/api/rag/searchRawMaterials/route.ts",
  "apps/web/app/api/index-data/route.ts",
] as const;

describe("no silent production fallback", () => {
  it("keeps retired AI routes authenticated, gone, and free of legacy executors", () => {
    for (const path of RETIRED_AI_ROUTES) {
      const source = read(path);
      expect(source, path).toContain("with_request_principal");
      expect(source, path).toContain("status: 410");
      expect(source, path).not.toMatch(/GeminiService|AgentManager|QdrantRAGService|getEmbeddingService/);
    }
  });

  it("does not suppress promise failures in active runtime boundaries", () => {
    for (const path of [
      "apps/ai/server/services/ai-gateway/run-worker.ts",
      "apps/ai/server/services/ai-gateway/shadow-runner.ts",
      "apps/ai/server/services/provisioning/production-ports.ts",
      "apps/web/components/org_switcher_panel.tsx",
    ]) {
      expect(read(path), path).not.toMatch(/\.catch\(\(\)\s*=>\s*(?:undefined|null|false|true)\)/);
    }
  });

  it("uses the durable material-index outbox for every product mutation", () => {
    const products = read("apps/ai/server/routers/products.ts");
    expect(products).toContain("in_product_mutation_transaction");
    expect(products.match(/enqueue_material_index\(/g)?.length).toBeGreaterThanOrEqual(4);
    expect(products.match(/withTransaction/g)?.length).toBeGreaterThanOrEqual(1);
    expect(products).not.toMatch(/auto_(?:index|delete)_material\([^)]*\)\.then/);
  });

  it("commits order creation with its stock change and audit trail", () => {
    const orders = read("apps/ai/server/routers/orders.ts");
    expect(orders).toContain("in_order_transaction");
    expect(orders.match(/in_order_transaction\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(orders).toContain("decrement_stock_if_available(");
    expect(orders).toContain("{ returnDocument: \"after\", session }");
    expect(orders).toContain("mutate_credit_balance(client, {");
    expect(orders).toContain("}, session);");

    const credits = read("apps/ai/server/services/credit-ledger.ts");
    expect(credits).toContain("existing_session?: ClientSession");
    expect(credits).toContain("if (existing_session) return apply(existing_session);");
  });

  it("does not expose infrastructure connection details in client error UI", () => {
    const dashboard = read("apps/web/components/dashboard.tsx");
    expect(dashboard).not.toContain("MONGODB_URI");
    expect(dashboard).not.toContain("Connection string:");
    expect(dashboard).not.toMatch(/error\?\.message|statsError\?\.message/);
  });

  it("caps and records failed material-index work instead of retrying forever", () => {
    const worker = read("apps/ai/server/worker.ts");
    expect(worker).toContain('status: "failed"');
    expect(worker).toContain('event: terminal ? "task.failed" : "task.retry_scheduled"');
    expect(worker).toContain('"MATERIAL_INDEX_MAX_ATTEMPTS"');
  });

  it("does not turn a failed chat persistence into an empty AI request", () => {
    const hook = read("apps/web/hooks/use_chat_threads.ts");
    expect(hook).toContain("throw error;");
    expect(hook).not.toContain("Promise<AddedChatMessage | null>");

    for (const path of [
      "apps/web/app/ai/raw-materials-ai/page.tsx",
      "apps/web/app/ai/sales-rnd-ai/page.tsx",
    ]) {
      const page = read(path);
      expect(page, path).toContain("Your message could not be saved. Please retry.");
      expect(page, path).toContain("Your feedback could not be saved. Please retry.");
      expect(page, path).toContain('role="alert"');
    }

    const sidebar = read("apps/web/components/ai/ai_chat_sidebar.tsx");
    expect(sidebar).toContain("The conversation could not be deleted. Please retry.");
    expect(sidebar).toContain('role="alert"');
  });

  it("retries index initialization and surfaces completed-run refresh failures", () => {
    const indexes = read("apps/ai/server/repositories/runtime-indexes.ts");
    expect(indexes).toContain("initialized.delete(db)");
    expect(indexes).toContain("throw error;");

    const formulas = read("apps/web/app/formulas/page.tsx");
    expect(formulas).toContain("completed-run refresh failed");
    expect(formulas).toContain("formula list could not be refreshed. Please retry.");
    expect(formulas).toContain('role="alert"');
  });

  it("writes feedback decision data in one transaction", () => {
    const feedback = read("apps/ai/server/repositories/feedback-repository.ts");
    expect(feedback).toContain("async submit_feedback");
    expect(feedback).toContain("session.withTransaction");

    const router = read("apps/ai/server/routers/feedback.ts");
    expect(router).toContain("repositories.feedback.submit_feedback");
    expect(router).not.toContain("repositories.feedback.record_response_feedback(");
  });

  it("requires ownership for draft and calculation mutations", () => {
    const formulas = read("apps/ai/server/repositories/formula-repository.ts");
    expect(formulas).toContain('status: "draft"');
    expect(formulas).toContain("ownerProfileId: context.actor_profile_id");

    const calculations = read("apps/ai/server/repositories/calculation-repository.ts");
    expect(calculations).toContain("actorProfileId: context.actor_profile_id");
  });

  it("surfaces a governed formula artifact fetch failure", () => {
    const form = read("apps/web/components/formula-form.tsx");
    expect(form).toContain("artifact fetch failed");
    expect(form).toContain("The generated formula could not be loaded. Please run Formulate again.");
    expect(form).toContain('role="alert"');
  });
});
