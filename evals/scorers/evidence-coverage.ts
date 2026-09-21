/** Deterministic factual-claim and citation coverage scorer. */
import type { EvalCaseV1 } from "../schemas/eval-case";
import type { RecordedRun } from "../runner/recorded-run";
import type { DeterministicScore } from "./types";
import { unique_failures } from "./types";

export interface EvidenceCoverageScore extends DeterministicScore {
  readonly supported_claims: number;
  readonly evaluated_claims: number;
  readonly coverage: number;
}

/**
 * Score only factual claims; opinions and instructions do not need citations.
 *
 * @param test_case - Evaluation case declaring required evidence.
 * @param run - Strict normalized run trace.
 * @returns Citation support counts, zero-safe coverage, and failure codes.
 */
export function score_evidence_coverage(
  test_case: EvalCaseV1,
  run: RecordedRun,
): EvidenceCoverageScore {
  const failures: string[] = [];
  const factual_claims = run.claims.filter(({ kind }) => kind === "factual");
  const expected_source_types = new Map(
    [...test_case.required_evidence, ...test_case.forbidden_evidence].map(
      ({ source_id, source_type }) => [source_id, source_type],
    ),
  );
  let supported_claims = 0;

  for (const citation of run.citations) {
    if (!run.evidence_source_ids.includes(citation.source_id)) {
      failures.push("CITATION_SOURCE_NOT_OBSERVED");
    }
    const expected_type = expected_source_types.get(citation.source_id);
    if (expected_type !== undefined && expected_type !== citation.source_type) {
      failures.push("CITATION_SOURCE_TYPE_MISMATCH");
    }
  }

  for (const claim of factual_claims) {
    const citations = run.citations.filter(({ claim_ids }) => claim_ids.includes(claim.id));
    if (citations.length === 0) {
      failures.push("MISSING_CITATION");
      continue;
    }
    const supporting = citations.some((citation) => {
      const expected_type = expected_source_types.get(citation.source_id);
      return (
        run.evidence_source_ids.includes(citation.source_id) &&
        (expected_type === undefined || expected_type === citation.source_type) &&
        citation.retrievable &&
        citation.supports_claim
      );
    });
    if (supporting) {
      supported_claims += 1;
    } else if (citations.some(({ retrievable }) => !retrievable)) {
      failures.push("CITATION_NOT_RETRIEVABLE");
    } else {
      failures.push("CITATION_DOES_NOT_SUPPORT_CLAIM");
    }
  }

  for (const expectation of test_case.required_evidence) {
    if (!run.evidence_source_ids.includes(expectation.source_id)) {
      failures.push("REQUIRED_EVIDENCE_MISSING");
    }
  }

  const evaluated_claims = factual_claims.length;
  const coverage = evaluated_claims === 0 ? 0 : supported_claims / evaluated_claims;
  const unique = unique_failures(failures);
  return {
    passed: unique.length === 0,
    failures: unique,
    supported_claims,
    evaluated_claims,
    coverage,
  };
}
