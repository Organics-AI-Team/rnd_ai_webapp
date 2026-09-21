/** G4.10 — reusable typed run-rendering source boundary. */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Read one workspace source file. */
function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("AiRunView", () => {
  const panel = source("apps/web/components/ai/ai_run_view.tsx");

  it("renders typed stage, activity, evidence, interrupts, artifact refs, output, and usage", () => {
    expect(panel).toContain('data-testid="run-stage"');
    expect(panel).toContain("STAGE_LABELS[state.stage]");
    expect(panel).toContain("state.decisions.map");
    expect(panel).toContain("state.actions.map");
    expect(panel).toContain("<AiEvidenceList");
    expect(panel).toContain("<AiClarificationCard");
    expect(panel).toContain("<AiApprovalCard");
    expect(panel).toContain('data-testid="artifact-card"');
    expect(panel).toContain("state.usage.tokens_used");
    expect(panel).toContain("state.output?.answer");
    expect(panel).toContain("state.output?.citations");
  });

  it("makes approval controls manager-only and delegates identity-free decisions", () => {
    const approval = source("apps/web/components/ai/ai_approval_card.tsx");
    expect(approval).toContain("is_manager ?");
    expect(approval).toContain("A workspace manager must decide");
    expect(panel).toContain("on_approval(state.pending_approval!.approval_id, decision)");
    expect(panel).not.toContain("profile_id");
  });

  it("renders typed failure and completion terminal states", () => {
    expect(panel).toContain('data-testid="run-failed"');
    expect(panel).toContain("state.error.code");
    expect(panel).toContain("state.error.safe_message");
    expect(panel).toContain('data-testid="run-completed"');
  });

  it("renders an accepted waiting state before the first SSE event arrives", () => {
    expect(panel).toContain("!is_streaming");
    expect(panel).toContain("'Run accepted'");
  });
});
