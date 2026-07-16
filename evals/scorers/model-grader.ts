/** Injected, pinned model-grader port; this module performs no provider calls. */
import { z } from "zod";
import type { EvalCaseV1 } from "../schemas/eval-case";
import type { RecordedRun } from "../runner/recorded-run";

const model_grader_config_schema = z
  .object({
    provider: z.string().min(1).max(120),
    model: z.string().min(1).max(120),
    prompt_version: z.string().min(1).max(120),
    prompt_hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const model_grader_response_schema = z
  .object({
    criterion_scores: z.record(z.string().min(1).max(120), z.number().min(0).max(1)),
  })
  .strict();

export type ModelGraderConfig = z.infer<typeof model_grader_config_schema>;

export interface ModelGraderRequest {
  readonly case_id: string;
  readonly candidate_text: string;
  readonly criteria: ReadonlyArray<{
    readonly criterion: string;
    readonly description: string;
    readonly weight: number;
  }>;
}

export interface ModelGraderPort {
  /** Grade a blinded candidate against only the declared rubric criteria. */
  grade(request: ModelGraderRequest): Promise<unknown>;
}

export type RecordedGraderTrace = NonNullable<RecordedRun["grader"]>;

/**
 * Invoke an injected model grader and compute its weighted score deterministically.
 *
 * No executor/baseline identity or expected outcome is supplied to the port,
 * keeping the rubric call blinded. Provider implementations live outside this
 * evaluation core and must be explicitly injected.
 *
 * @param test_case - Corpus case containing the approved structured rubric.
 * @param candidate_text - Candidate response text to grade.
 * @param config - Pinned provider/model/prompt identity.
 * @param grader - Injected provider port.
 * @returns Recorded grader trace accepted by RecordedRunV1.
 * @throws ZodError for malformed config/response; Error for criterion drift.
 */
export async function grade_case_with_model(
  test_case: EvalCaseV1,
  candidate_text: string,
  config: ModelGraderConfig,
  grader: ModelGraderPort,
): Promise<RecordedGraderTrace> {
  const pinned = model_grader_config_schema.parse(config);
  const request: ModelGraderRequest = {
    case_id: test_case.id,
    candidate_text: z.string().max(64_000).parse(candidate_text),
    criteria: test_case.rubric.criteria.map(({ criterion, description, weight }) => ({
      criterion,
      description,
      weight,
    })),
  };
  const response = model_grader_response_schema.parse(await grader.grade(request));
  const expected_criteria = request.criteria.map(({ criterion }) => criterion).sort();
  const received_criteria = Object.keys(response.criterion_scores).sort();
  if (
    expected_criteria.length !== received_criteria.length ||
    expected_criteria.some((criterion, index) => criterion !== received_criteria[index])
  ) {
    throw new Error("grader criterion set does not match rubric");
  }
  const score = request.criteria.reduce(
    (total, criterion) =>
      total + criterion.weight * response.criterion_scores[criterion.criterion],
    0,
  );
  return {
    score,
    blinded: true,
    provider: pinned.provider,
    model: pinned.model,
    prompt_version: pinned.prompt_version,
    prompt_hash: pinned.prompt_hash,
  };
}
