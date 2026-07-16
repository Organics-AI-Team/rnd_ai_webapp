/**
 * G4.10 — static UI boundary tests.
 *
 * These checks pin the two route pages to the shared governed run hook and
 * prevent reintroduction of either legacy execution endpoint.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Read a workspace file as UTF-8 source. */
function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("governed run page wiring", () => {
  it.each([
    ["apps/web/app/ai/raw-materials-ai/page.tsx", "raw_material_research"],
    ["apps/web/app/ai/sales-rnd-ai/page.tsx", "sales_rnd"],
  ])("routes %s through useAgentRun with agent_key %s", (path, agent_key) => {
    const page = source(path);
    expect(page).toContain("useAgentRun");
    expect(page).toContain(`agent_key: '${agent_key}'`);
    expect(page).toContain("<AiRunView");
    expect(page).not.toContain("/api/ai/raw-materials-agent");
    expect(page).not.toMatch(/fetch\('\/api\/ai\/enhanced-chat'[\s\S]{0,100}method:\s*'POST'/);
  });

  it("the run hook owns create, actor-free resume, named SSE, reset, and close behavior", () => {
    const hook = source("apps/web/hooks/use_agent_run.ts");
    expect(hook).toContain("create_agent_run_client");
    expect(hook).toContain("useAgentRun");
    expect(hook).toContain("start_run");
    expect(hook).toContain("submit_clarification");
    expect(hook).toContain("submit_approval");
    expect(hook).toContain("cancel_stream");
    expect(hook).not.toContain("decided_by_profile_id");
    expect(hook).not.toContain("addEventListener('message'");
  });
});
