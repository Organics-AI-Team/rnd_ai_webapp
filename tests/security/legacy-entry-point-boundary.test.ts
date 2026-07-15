/**
 * G4.11 — legacy AI entry-point import boundary.
 *
 * The governed orchestration path (the orchestration package and the AI gateway)
 * must never import the legacy AI executor tree (apps/ai/agents/**) — an agentic
 * run must not fall back into a legacy ReAct/pipeline/agent-manager executor.
 * Files outside the governed path (including the legacy tree itself, retired in
 * G5) and test files are not subject to the rule.
 */

import { describe, expect, it } from "vitest";

import {
  reject_legacy_entry_point_import,
  type SecurityFinding,
  type SourceFile,
} from "../../scripts/security/scan-private-boundaries";

/** Build a source fixture at a given repo-relative path. */
function source(path: string, content: string): SourceFile {
  return { path, content };
}

/** Whether any finding carries the legacy-entry-point code. */
function has_legacy(findings: readonly SecurityFinding[]): boolean {
  return findings.some((finding) => finding.code === "LEGACY_ENTRY_POINT_IMPORT");
}

describe("reject_legacy_entry_point_import", () => {
  it("flags an orchestration file importing a legacy agent (relative)", () => {
    const findings = reject_legacy_entry_point_import(
      source(
        "packages/ai-orchestration/src/nodes/agent.ts",
        'import { ReactAgentService } from "../../../../apps/ai/agents/react/react-agent-service";',
      ),
    );
    expect(findings).toEqual([
      expect.objectContaining({ code: "LEGACY_ENTRY_POINT_IMPORT" }),
    ]);
  });

  it("flags the AI gateway importing a legacy agent via the @/ai alias", () => {
    const findings = reject_legacy_entry_point_import(
      source(
        "apps/ai/server/services/ai-gateway/run-worker.ts",
        'import { RawMaterialsAgent } from "@/ai/agents/raw-materials-ai/agent";',
      ),
    );
    expect(has_legacy(findings)).toBe(true);
  });

  it("flags a dynamic import of a legacy executor", () => {
    const findings = reject_legacy_entry_point_import(
      source(
        "apps/ai/server/services/ai-gateway/ai-gateway.ts",
        'const manager = await import("../../../agents/agent-manager");',
      ),
    );
    expect(has_legacy(findings)).toBe(true);
  });

  it("flags a require() of a legacy executor", () => {
    const findings = reject_legacy_entry_point_import(
      source(
        "packages/ai-orchestration/src/graph.ts",
        'const registry = require("../../apps/ai/agents/core/tool-registry");',
      ),
    );
    expect(has_legacy(findings)).toBe(true);
  });

  it("allows governed-path imports of sanctioned modules", () => {
    const findings = reject_legacy_entry_point_import(
      source(
        "apps/ai/server/services/ai-gateway/ai-gateway.ts",
        [
          'import type { TenantExecutionContext } from "@rnd-ai/shared-types";',
          'import { create_event_store } from "./event-store";',
          'import { create_ai_run_repository } from "../../repositories/ai-run-repository";',
        ].join("\n"),
      ),
    );
    expect(findings).toEqual([]);
  });

  it("does not police files outside the governed orchestration path", () => {
    // Legacy code importing sibling legacy code is fine; retirement is a G5 concern.
    const findings = reject_legacy_entry_point_import(
      source(
        "apps/ai/agents/react/react-agent-service.ts",
        'import { RawMaterialsAgent } from "../raw-materials-ai/agent";',
      ),
    );
    expect(findings).toEqual([]);
  });

  it("does not flag an 'agents'-like substring that is not the legacy tree", () => {
    // "subagents-helper" must not trip the /agents/ path-segment check.
    const findings = reject_legacy_entry_point_import(
      source(
        "packages/ai-orchestration/src/delegation/delegation-registry.ts",
        'import { spawn } from "./subagents-helper";',
      ),
    );
    expect(findings).toEqual([]);
  });

  it("exempts test files under the governed path", () => {
    const findings = reject_legacy_entry_point_import(
      source(
        "packages/ai-orchestration/src/nodes/agent.test.ts",
        'import { RawMaterialsAgent } from "../../../../apps/ai/agents/raw-materials-ai/agent";',
      ),
    );
    expect(findings).toEqual([]);
  });
});
