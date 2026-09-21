"""Evaluate recorded RAG runs with RAGAS and deterministic release gates.

The runner deliberately accepts recorded outputs instead of calling the product
directly.  This keeps the corpus immutable, lets production-like runs be
captured separately, and prevents the evaluator from executing application
tools as a side effect.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import math
import os
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping, Sequence


logger = logging.getLogger(__name__)

MODULE_DIRECTORY = Path(__file__).resolve().parent
DEFAULT_DATASET_PATH = MODULE_DIRECTORY / "fixtures" / "rag-v1.jsonl"
DEFAULT_RESULTS_PATH = MODULE_DIRECTORY / "results" / "latest.jsonl"
DEFAULT_REPORT_PATH = MODULE_DIRECTORY / "reports" / "latest.json"
DEFAULT_CONFIG_PATH = MODULE_DIRECTORY / "eval-config.json"
METRIC_NAMES = (
    "faithfulness",
    "context_precision",
    "context_recall",
    "factual_correctness",
    "answer_relevancy",
)


class EvaluationDataError(ValueError):
    """Raised when an evaluation artifact is incomplete or internally inconsistent."""


@dataclass(frozen=True)
class EvaluationRecord:
    """One fully paired test case ready for RAGAS scoring.

    Attributes:
        case_id: Stable identifier shared by the fixture and captured run.
        question: The user request sent to the AI system.
        answer: The captured final response from the AI system.
        retrieved_contexts: Text returned by the retrieval system for the run.
        reference_answer: Reviewed expected answer used for recall and correctness.
        reference_contexts: Reviewed relevant source passages for auditability.
        tool_calls: Ordered names of tools used by the recorded run.
        latency_ms: End-to-end run latency in milliseconds.
        model: Model identifier captured with the run.
    """

    case_id: str
    question: str
    answer: str
    retrieved_contexts: list[str]
    reference_answer: str
    reference_contexts: list[str]
    tool_calls: list[str]
    latency_ms: int
    model: str


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    """Read one JSON object per non-empty line from an evaluation artifact.

    Args:
        path: Fixture or recorded-run JSONL path.

    Returns:
        Parsed objects in their original file order.

    Raises:
        EvaluationDataError: If the path is missing or a line is not a JSON object.
    """
    logger.info("read_jsonl.start path=%s", path)
    if not path.is_file():
        raise EvaluationDataError(f"Evaluation file does not exist: {path}")

    records: list[dict[str, Any]] = []
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as error:
            raise EvaluationDataError(
                f"Invalid JSON in {path} at line {line_number}: {error.msg}"
            ) from error
        if not isinstance(value, dict):
            raise EvaluationDataError(f"Expected an object in {path} at line {line_number}")
        records.append(value)

    if not records:
        raise EvaluationDataError(f"Evaluation file contains no records: {path}")
    logger.info("read_jsonl.complete path=%s record_count=%d", path, len(records))
    return records


def build_evaluation_records(
    dataset: Sequence[Mapping[str, Any]],
    results: Sequence[Mapping[str, Any]],
) -> list[EvaluationRecord]:
    """Pair immutable cases and captured runs by ID after validating RAG evidence.

    Args:
        dataset: Canonical cases with a question and reviewed references.
        results: Captured agent outputs with answer, contexts, trace, and latency.

    Returns:
        Evaluation records in the canonical dataset order.

    Raises:
        EvaluationDataError: If IDs differ, repeat, or required RAG fields are invalid.
    """
    logger.info(
        "build_evaluation_records.start dataset_count=%d results_count=%d",
        len(dataset),
        len(results),
    )
    dataset_by_id = _index_unique_records(dataset, "dataset")
    results_by_id = _index_unique_records(results, "results")
    dataset_ids = set(dataset_by_id)
    result_ids = set(results_by_id)

    if dataset_ids != result_ids:
        missing_results = sorted(dataset_ids - result_ids)
        unexpected_results = sorted(result_ids - dataset_ids)
        raise EvaluationDataError(
            "Dataset/result IDs differ: "
            f"missing_results={missing_results}; unexpected_results={unexpected_results}"
        )

    paired_records: list[EvaluationRecord] = []
    for dataset_case in dataset:
        case_id = _required_string(dataset_case, "id", "dataset")
        result = results_by_id[case_id]
        question = _required_string(dataset_case, "question", case_id)
        reference_answer = _required_string(dataset_case, "reference_answer", case_id)
        reference_contexts = _required_string_list(dataset_case, "reference_contexts", case_id)
        answer = _required_string(result, "answer", case_id)
        retrieved_contexts = _required_string_list(result, "retrieved_contexts", case_id)
        tool_calls = _required_string_list(result, "tool_calls", case_id)
        latency_ms = _required_non_negative_integer(result, "latency_ms", case_id)
        model = _required_string(result, "model", case_id)

        paired_records.append(
            EvaluationRecord(
                case_id=case_id,
                question=question,
                answer=answer,
                retrieved_contexts=retrieved_contexts,
                reference_answer=reference_answer,
                reference_contexts=reference_contexts,
                tool_calls=tool_calls,
                latency_ms=latency_ms,
                model=model,
            )
        )

    logger.info("build_evaluation_records.complete record_count=%d", len(paired_records))
    return paired_records


def summarize_evaluation(
    case_scores: Sequence[Mapping[str, Any]],
    thresholds: Mapping[str, float],
) -> dict[str, Any]:
    """Aggregate case-level metric values, latency percentiles, and hard gates.

    Args:
        case_scores: RAGAS metric values and latency for each completed case.
        thresholds: Minimum score per metric plus a maximum ``p95_latency_ms``.

    Returns:
        JSON-safe metric, performance, and pass/fail gate summary.

    Raises:
        EvaluationDataError: If a case is missing a required metric or latency.
    """
    logger.info("summarize_evaluation.start case_count=%d", len(case_scores))
    if not case_scores:
        raise EvaluationDataError("Cannot summarize an empty evaluation")

    metric_averages: dict[str, float] = {}
    for metric_name in METRIC_NAMES:
        values = [
            _required_finite_number(
                _required_mapping(case_score, "metrics", str(case_score)),
                metric_name,
                str(case_score),
            )
            for case_score in case_scores
        ]
        metric_averages[metric_name] = round(sum(values) / len(values), 4)

    latencies = sorted(
        _required_non_negative_integer(case_score, "latency_ms", str(case_score))
        for case_score in case_scores
    )
    performance = {
        "p50_latency_ms": _nearest_rank_percentile(latencies, 0.50),
        "p95_latency_ms": _nearest_rank_percentile(latencies, 0.95),
    }

    failures: list[str] = []
    for metric_name in METRIC_NAMES:
        target = _required_finite_number(thresholds, metric_name, "thresholds")
        if metric_averages[metric_name] < target:
            failures.append(metric_name)
    latency_target = _required_non_negative_integer(thresholds, "p95_latency_ms", "thresholds")
    if performance["p95_latency_ms"] > latency_target:
        failures.append("p95_latency_ms")

    summary = {
        "case_count": len(case_scores),
        "metrics": metric_averages,
        "performance": performance,
        "gate": {"passed": not failures, "failures": failures},
    }
    logger.info(
        "summarize_evaluation.complete case_count=%d passed=%s failure_count=%d",
        len(case_scores),
        summary["gate"]["passed"],
        len(failures),
    )
    return summary


async def score_records_with_ragas(
    records: Sequence[EvaluationRecord],
    judge_model: str,
    embedding_model: str,
    api_key: str,
) -> list[dict[str, Any]]:
    """Score records with current RAGAS collection metrics and Google Gemini.

    Args:
        records: Validated records to score.
        judge_model: Gemini model used as the RAGAS judge.
        embedding_model: Gemini embedding model used for answer relevancy.
        api_key: Google API key; never logged or written to reports.

    Returns:
        Case-level RAGAS scores with captured latency and tool trace.

    Raises:
        RuntimeError: If optional evaluator dependencies are not installed.
        EvaluationDataError: If RAGAS returns a non-finite metric value.
    """
    logger.info(
        "score_records_with_ragas.start record_count=%d judge_model=%s embedding_model=%s",
        len(records),
        judge_model,
        embedding_model,
    )
    try:
        from google import genai
        from ragas.embeddings import GoogleEmbeddings
        from ragas.llms import llm_factory
        from ragas.metrics.collections import (
            AnswerRelevancy,
            ContextPrecisionWithReference,
            ContextRecall,
            FactualCorrectness,
            Faithfulness,
        )
    except ImportError as error:
        raise RuntimeError(
            "RAGAS dependencies are missing. Run `uv sync --project evals/rag` first."
        ) from error

    client = genai.Client(api_key=api_key)
    judge_llm = llm_factory(judge_model, provider="google", client=client)
    embeddings = GoogleEmbeddings(client=client, model=embedding_model)
    metrics = {
        "faithfulness": Faithfulness(llm=judge_llm),
        "context_precision": ContextPrecisionWithReference(llm=judge_llm),
        "context_recall": ContextRecall(llm=judge_llm),
        "factual_correctness": FactualCorrectness(llm=judge_llm),
        "answer_relevancy": AnswerRelevancy(llm=judge_llm, embeddings=embeddings),
    }

    scored_cases: list[dict[str, Any]] = []
    for record in records:
        logger.info("score_records_with_ragas.case_start case_id=%s", record.case_id)
        metric_results = await asyncio.gather(
            metrics["faithfulness"].ascore(
                user_input=record.question,
                response=record.answer,
                retrieved_contexts=record.retrieved_contexts,
            ),
            metrics["context_precision"].ascore(
                user_input=record.question,
                reference=record.reference_answer,
                retrieved_contexts=record.retrieved_contexts,
            ),
            metrics["context_recall"].ascore(
                user_input=record.question,
                reference=record.reference_answer,
                retrieved_contexts=record.retrieved_contexts,
            ),
            metrics["factual_correctness"].ascore(
                response=record.answer,
                reference=record.reference_answer,
            ),
            metrics["answer_relevancy"].ascore(
                user_input=record.question,
                response=record.answer,
            ),
        )
        metric_values = {
            metric_name: _metric_value(metric_result, record.case_id, metric_name)
            for metric_name, metric_result in zip(METRIC_NAMES, metric_results, strict=True)
        }
        scored_cases.append(
            {
                "id": record.case_id,
                "metrics": metric_values,
                "latency_ms": record.latency_ms,
                "model": record.model,
                "tool_calls": record.tool_calls,
            }
        )
        logger.info("score_records_with_ragas.case_complete case_id=%s", record.case_id)

    logger.info("score_records_with_ragas.complete scored_case_count=%d", len(scored_cases))
    return scored_cases


def load_evaluation_config(path: Path) -> dict[str, Any]:
    """Load and validate non-secret evaluator configuration from JSON.

    Args:
        path: Path to the versioned evaluation configuration.

    Returns:
        Configuration with judge models and release thresholds.

    Raises:
        EvaluationDataError: If the configuration is missing or malformed.
    """
    logger.info("load_evaluation_config.start path=%s", path)
    if not path.is_file():
        raise EvaluationDataError(f"Evaluation config does not exist: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise EvaluationDataError(f"Invalid evaluation config JSON: {error.msg}") from error
    if not isinstance(value, dict):
        raise EvaluationDataError("Evaluation config must be a JSON object")

    judge_model = _required_string(value, "judge_model", "config")
    embedding_model = _required_string(value, "embedding_model", "config")
    thresholds = _required_mapping(value, "thresholds", "config")
    for metric_name in (*METRIC_NAMES, "p95_latency_ms"):
        _required_finite_number(thresholds, metric_name, "thresholds")

    config = {
        "judge_model": judge_model,
        "embedding_model": embedding_model,
        "thresholds": dict(thresholds),
    }
    logger.info("load_evaluation_config.complete path=%s", path)
    return config


async def run_evaluation(
    dataset_path: Path,
    results_path: Path,
    config_path: Path,
    judge_model_override: str | None = None,
    embedding_model_override: str | None = None,
) -> dict[str, Any]:
    """Load recorded runs, ask RAGAS to score them, and produce a JSON report.

    Args:
        dataset_path: Immutable synthetic/reviewed test corpus.
        results_path: Recorded output file from the current AI candidate.
        config_path: Versioned thresholds and non-secret evaluator model defaults.
        judge_model_override: Optional CLI override for the RAGAS judge model.
        embedding_model_override: Optional CLI override for the relevance embedding model.

    Returns:
        Full report containing provenance, case scores, aggregates, and gates.

    Raises:
        EvaluationDataError: If inputs are invalid or no Google API key is available.
        RuntimeError: If scoring dependencies are unavailable or a provider call fails.
    """
    logger.info("run_evaluation.start dataset=%s results=%s", dataset_path, results_path)
    config = load_evaluation_config(config_path)
    records = build_evaluation_records(read_jsonl(dataset_path), read_jsonl(results_path))
    api_key = _resolve_google_api_key()
    judge_model = judge_model_override or config["judge_model"]
    embedding_model = embedding_model_override or config["embedding_model"]
    case_scores = await score_records_with_ragas(records, judge_model, embedding_model, api_key)
    summary = summarize_evaluation(case_scores, config["thresholds"])
    report = {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "provenance": {
            "dataset_path": str(dataset_path),
            "dataset_sha256": _sha256_file(dataset_path),
            "results_path": str(results_path),
            "results_sha256": _sha256_file(results_path),
            "config_path": str(config_path),
            "config_sha256": _sha256_file(config_path),
            "judge_model": judge_model,
            "embedding_model": embedding_model,
        },
        "cases": case_scores,
        **summary,
    }
    logger.info("run_evaluation.complete case_count=%d", len(case_scores))
    return report


def write_json_report(path: Path, report: Mapping[str, Any]) -> None:
    """Persist a JSON-safe report, creating only the selected report directory.

    Args:
        path: Explicit destination for the report.
        report: Evaluator output containing no credentials.

    Returns:
        None.

    Raises:
        OSError: If the selected report directory cannot be created or written.
    """
    logger.info("write_json_report.start path=%s", path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    logger.info("write_json_report.complete path=%s", path)


def parse_arguments(arguments: Sequence[str] | None = None) -> argparse.Namespace:
    """Parse CLI arguments without reading secrets or invoking the evaluator.

    Args:
        arguments: Optional argument list for tests; ``None`` uses process arguments.

    Returns:
        Parsed command-line options.
    """
    logger.info("parse_arguments.start")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET_PATH)
    parser.add_argument("--results", type=Path, default=DEFAULT_RESULTS_PATH)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT_PATH)
    parser.add_argument("--judge-model", type=str)
    parser.add_argument("--embedding-model", type=str)
    parser.add_argument(
        "--validate",
        action="store_true",
        help="Validate fixture and result shape only; do not call RAGAS or a model provider.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero when the configured release gate does not pass.",
    )
    parsed = parser.parse_args(arguments)
    logger.info("parse_arguments.complete validate=%s strict=%s", parsed.validate, parsed.strict)
    return parsed


def main(arguments: Sequence[str] | None = None) -> int:
    """Run the evaluator CLI and return a process-compatible exit code.

    Args:
        arguments: Optional argument list for programmatic invocation.

    Returns:
        ``0`` for success, ``1`` for an invalid/evaluator error, or ``2`` for a failed strict gate.
    """
    logger.info("main.start")
    logging.basicConfig(level=os.getenv("AI_EVAL_LOG_LEVEL", "INFO"))
    args = parse_arguments(arguments)
    try:
        config = load_evaluation_config(args.config)
        records = build_evaluation_records(read_jsonl(args.dataset), read_jsonl(args.results))
        if args.validate:
            print(json.dumps({"valid": True, "case_count": len(records)}, ensure_ascii=False))
            logger.info("main.complete mode=validate case_count=%d", len(records))
            return 0

        report = asyncio.run(
            run_evaluation(
                dataset_path=args.dataset,
                results_path=args.results,
                config_path=args.config,
                judge_model_override=args.judge_model,
                embedding_model_override=args.embedding_model,
            )
        )
        write_json_report(args.report, report)
        print(json.dumps(report["gate"], ensure_ascii=False))
        if args.strict and not report["gate"]["passed"]:
            logger.warning("main.complete mode=scored strict_gate_failed=true")
            return 2
        logger.info("main.complete mode=scored gate_passed=%s", report["gate"]["passed"])
        return 0
    except (EvaluationDataError, RuntimeError, OSError) as error:
        print(f"Evaluation failed: {error}", file=sys.stderr)
        logger.exception("main.error error_type=%s", type(error).__name__)
        return 1


def _index_unique_records(
    records: Sequence[Mapping[str, Any]],
    source_name: str,
) -> dict[str, Mapping[str, Any]]:
    """Index one artifact by ID while rejecting duplicate cases.

    Args:
        records: Parsed JSON records from one artifact.
        source_name: Human-readable artifact label for error messages.

    Returns:
        Mapping from stable case ID to source record.

    Raises:
        EvaluationDataError: If an ID is missing or duplicated.
    """
    logger.info("_index_unique_records.start source=%s count=%d", source_name, len(records))
    indexed: dict[str, Mapping[str, Any]] = {}
    for record in records:
        case_id = _required_string(record, "id", source_name)
        if case_id in indexed:
            raise EvaluationDataError(f"Duplicate ID in {source_name}: {case_id}")
        indexed[case_id] = record
    logger.info("_index_unique_records.complete source=%s count=%d", source_name, len(indexed))
    return indexed


def _required_mapping(value: Mapping[str, Any], field: str, owner: str) -> Mapping[str, Any]:
    """Return a required object field with a contextual validation error.

    Args:
        value: Object that should contain the field.
        field: Required object field name.
        owner: Case/config identifier used in the error message.

    Returns:
        The mapping value.

    Raises:
        EvaluationDataError: If the field is absent or is not an object.
    """
    logger.debug("_required_mapping.start owner=%s field=%s", owner, field)
    candidate = value.get(field)
    if not isinstance(candidate, Mapping):
        raise EvaluationDataError(f"{owner}: {field} must be an object")
    logger.debug("_required_mapping.complete owner=%s field=%s", owner, field)
    return candidate


def _required_string(value: Mapping[str, Any], field: str, owner: str) -> str:
    """Return a non-blank string field with a contextual validation error.

    Args:
        value: Object that should contain the field.
        field: Required field name.
        owner: Case/config identifier used in the error message.

    Returns:
        Trimmed string value.

    Raises:
        EvaluationDataError: If the field is not a non-blank string.
    """
    logger.debug("_required_string.start owner=%s field=%s", owner, field)
    candidate = value.get(field)
    if not isinstance(candidate, str) or not candidate.strip():
        raise EvaluationDataError(f"{owner}: {field} must be a non-empty string")
    result = candidate.strip()
    logger.debug("_required_string.complete owner=%s field=%s", owner, field)
    return result


def _required_string_list(value: Mapping[str, Any], field: str, owner: str) -> list[str]:
    """Return a non-empty list of non-blank strings with validation context.

    Args:
        value: Object that should contain the list field.
        field: Required list field name.
        owner: Case identifier used in the error message.

    Returns:
        Trimmed string list.

    Raises:
        EvaluationDataError: If the field is not a non-empty string list.
    """
    logger.debug("_required_string_list.start owner=%s field=%s", owner, field)
    candidate = value.get(field)
    if not isinstance(candidate, list) or not candidate:
        raise EvaluationDataError(f"{owner}: {field} must be a non-empty array")
    if any(not isinstance(item, str) or not item.strip() for item in candidate):
        raise EvaluationDataError(f"{owner}: {field} must contain non-empty strings")
    result = [item.strip() for item in candidate]
    logger.debug("_required_string_list.complete owner=%s field=%s count=%d", owner, field, len(result))
    return result


def _required_non_negative_integer(value: Mapping[str, Any], field: str, owner: str) -> int:
    """Return a finite non-negative integer field with validation context.

    Args:
        value: Object that should contain the number.
        field: Required number field name.
        owner: Case/config identifier used in the error message.

    Returns:
        Integer value.

    Raises:
        EvaluationDataError: If the field is not a non-negative integer.
    """
    logger.debug("_required_non_negative_integer.start owner=%s field=%s", owner, field)
    candidate = value.get(field)
    if isinstance(candidate, bool) or not isinstance(candidate, int) or candidate < 0:
        raise EvaluationDataError(f"{owner}: {field} must be a non-negative integer")
    logger.debug("_required_non_negative_integer.complete owner=%s field=%s", owner, field)
    return candidate


def _required_finite_number(value: Mapping[str, Any], field: str, owner: str) -> float:
    """Return a finite numeric field with validation context.

    Args:
        value: Object that should contain the number.
        field: Required number field name.
        owner: Case/config identifier used in the error message.

    Returns:
        Numeric value converted to a float.

    Raises:
        EvaluationDataError: If the field is not finite.
    """
    logger.debug("_required_finite_number.start owner=%s field=%s", owner, field)
    candidate = value.get(field)
    if isinstance(candidate, bool) or not isinstance(candidate, (int, float)):
        raise EvaluationDataError(f"{owner}: {field} must be a finite number")
    result = float(candidate)
    if not math.isfinite(result):
        raise EvaluationDataError(f"{owner}: {field} must be a finite number")
    logger.debug("_required_finite_number.complete owner=%s field=%s", owner, field)
    return result


def _nearest_rank_percentile(sorted_values: Sequence[int], percentile: float) -> int:
    """Calculate a nearest-rank percentile from an already sorted integer sequence.

    Args:
        sorted_values: Ascending latency values.
        percentile: Quantile in the inclusive range from zero to one.

    Returns:
        The nearest-rank value.

    Raises:
        EvaluationDataError: If inputs cannot define a percentile.
    """
    logger.debug("_nearest_rank_percentile.start value_count=%d percentile=%s", len(sorted_values), percentile)
    if not sorted_values or not 0 < percentile <= 1:
        raise EvaluationDataError("Percentile requires non-empty values and a percentile in (0, 1]")
    index = max(0, math.ceil(percentile * len(sorted_values)) - 1)
    result = sorted_values[index]
    logger.debug("_nearest_rank_percentile.complete percentile=%s result=%d", percentile, result)
    return result


def _metric_value(metric_result: Any, case_id: str, metric_name: str) -> float:
    """Extract a finite scalar from a RAGAS metric result.

    Args:
        metric_result: Result object returned by RAGAS collections metrics.
        case_id: Evaluated case ID for a useful error message.
        metric_name: Metric key for a useful error message.

    Returns:
        Finite metric score rounded only in the aggregate report.

    Raises:
        EvaluationDataError: If RAGAS returns an unavailable or non-finite score.
    """
    logger.debug("_metric_value.start case_id=%s metric=%s", case_id, metric_name)
    candidate = getattr(metric_result, "value", None)
    if isinstance(candidate, bool) or not isinstance(candidate, (int, float)) or not math.isfinite(candidate):
        raise EvaluationDataError(f"{case_id}: RAGAS returned no finite {metric_name} score")
    result = float(candidate)
    logger.debug("_metric_value.complete case_id=%s metric=%s", case_id, metric_name)
    return result


def _resolve_google_api_key() -> str:
    """Resolve the project-compatible Gemini credential without exposing its value.

    Returns:
        Configured Google/Gemini API key.

    Raises:
        EvaluationDataError: If neither supported environment variable is configured.
    """
    logger.info("_resolve_google_api_key.start")
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise EvaluationDataError("Set GOOGLE_API_KEY or GEMINI_API_KEY before running RAGAS scoring")
    logger.info("_resolve_google_api_key.complete credential_source=%s", "GOOGLE_API_KEY" if os.getenv("GOOGLE_API_KEY") else "GEMINI_API_KEY")
    return api_key


def _sha256_file(path: Path) -> str:
    """Return the SHA-256 content hash used to reproduce an evaluation report.

    Args:
        path: Artifact whose exact bytes must be identified.

    Returns:
        Lowercase SHA-256 digest.

    Raises:
        OSError: If the artifact cannot be read.
    """
    logger.debug("_sha256_file.start path=%s", path)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    logger.debug("_sha256_file.complete path=%s", path)
    return digest


if __name__ == "__main__":
    raise SystemExit(main())
