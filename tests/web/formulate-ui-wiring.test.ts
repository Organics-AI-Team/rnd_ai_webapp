// tests/web/formulate-ui-wiring.test.ts
/**
 * M5 — static UI boundary tests for the Formulate action (spec §11.2).
 *
 * Pins FormulaForm to the governed run hook + artifact read API and prevents
 * reintroduction of any legacy execution endpoint.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Read a workspace file as UTF-8 source. */
function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("formulate action wiring", () => {
  it("drives FormulaForm through the governed run API and artifact read route", () => {
    const form = source("apps/web/components/formula-form.tsx");
    expect(form).toContain("useAgentRun");
    expect(form).toContain('agent_key: "formulation"');
    expect(form).toContain("<AiRunView");
    expect(form).toContain("/api/ai/artifacts/");
    expect(form).toContain("formula_artifact_to_form_state");
    expect(form).not.toContain("/api/ai/raw-materials-agent");
    expect(form).not.toContain("/api/ai/enhanced-chat");
  });

  it("exposes a tenant-scoped, permissioned artifact read route", () => {
    const route = source("apps/web/app/api/ai/artifacts/[artifactId]/route.ts");
    expect(route).toContain("with_request_principal");
    expect(route).toContain('"formula:read"');
    expect(route).toContain("handle_get_artifact");
  });
});
