import { describe, expect, it } from "vitest";

import {
  collect_production_sources,
  reject_ai_control_plane_bypass,
  scan_private_boundaries,
  type SourceFile,
} from "../../scripts/security/scan-private-boundaries";

function source(path: string, content: string): SourceFile {
  return { path, content };
}

describe("reject_ai_control_plane_bypass", () => {
  it.each([
    [
      "provider SDK",
      "apps/web/app/api/example/route.ts",
      'import OpenAI from "openai"; new OpenAI().responses.create(input);',
    ],
    [
      "Qdrant SDK",
      "apps/ai/server/routers/example.ts",
      'import { QdrantClient } from "@qdrant/js-client-rest"; new QdrantClient({ url }).search("c", {});',
    ],
    [
      "tool implementation",
      "apps/ai/server/services/example.ts",
      "await definition.execute(args, context);",
    ],
    [
      "AIRun creation",
      "apps/ai/server/routers/example.ts",
      "const runs = create_ai_run_repository(db); await runs.create(input, now);",
    ],
  ])("flags direct %s access", (_label, path, content) => {
    expect(reject_ai_control_plane_bypass(source(path, content))).toEqual([
      expect.objectContaining({ code: "AI_CONTROL_PLANE_BYPASS", file: path }),
    ]);
  });

  it.each([
    [
      "apps/ai/services/providers/openai-service.ts",
      'import OpenAI from "openai"; const client = new OpenAI(); client.responses.create(input);',
    ],
    [
      "apps/ai/server/services/knowledge/qdrant-collections.ts",
      "await qdrant.search(collection, request);",
    ],
    [
      "apps/ai/server/services/ai-control/tool-executor.ts",
      "await definition.execute(args, context);",
    ],
    [
      "apps/ai/server/services/ai-gateway/ai-gateway.ts",
      "await runs.create(input, now);",
    ],
  ])("allows the sanctioned adapter %s", (path, content) => {
    expect(reject_ai_control_plane_bypass(source(path, content))).toEqual([]);
  });

  it("keeps the production tree free of new-control-plane bypasses", () => {
    const findings = scan_private_boundaries(collect_production_sources());
    expect(
      findings.filter((finding) => finding.code === "AI_CONTROL_PLANE_BYPASS"),
    ).toEqual([]);
  });
});
