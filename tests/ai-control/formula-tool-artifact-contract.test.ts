import { describe, expect, it } from "vitest";

import {
  formula_draft_input_schema,
  formula_draft_output_schema,
  formula_confirm_input_schema,
  formula_confirm_output_schema,
  formula_revise_input_schema,
  formula_revise_output_schema,
} from "../../apps/ai/server/services/ai-control/tools/formula-tools";
import { governed_formula_artifact } from "./helpers";

describe("governed formula tool artifact contract", () => {
  it("uses the canonical FormulaArtifactV1 as the draft input and output", () => {
    const artifact = governed_formula_artifact();

    expect(formula_draft_input_schema.parse({ artifact })).toEqual({ artifact });
    expect(formula_draft_output_schema.parse(artifact)).toEqual(artifact);
  });

  it("requires a tenant formula parent while returning a canonical revised artifact", () => {
    const artifact = governed_formula_artifact();
    const input = {
      formula_id: "a".repeat(24),
      artifact,
      revision_summary: "Reduced the active to the evidence-backed maximum.",
    };

    expect(formula_revise_input_schema.parse(input)).toEqual(input);
    expect(formula_revise_output_schema.parse(artifact)).toEqual(artifact);
  });

  it("confirms a durable AI artifact rather than an unvalidated formula document", () => {
    const artifact_id = "b".repeat(24);
    expect(
      formula_confirm_input_schema.parse({ artifact_id, remarks: "Manager approved." }),
    ).toEqual({ artifact_id, remarks: "Manager approved." });
    expect(
      formula_confirm_output_schema.parse({
        artifact_id,
        formula_id: "c".repeat(24),
        status: "confirmed",
        already_committed: false,
      }),
    ).toEqual({
      artifact_id,
      formula_id: "c".repeat(24),
      status: "confirmed",
      already_committed: false,
    });
  });
});
