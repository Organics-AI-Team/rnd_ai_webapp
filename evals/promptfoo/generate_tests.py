"""Generate Promptfoo tests from the canonical, versioned RAG evaluation corpus."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any


logger = logging.getLogger(__name__)
FIXTURE_PATH = Path(__file__).resolve().parents[1] / "rag" / "fixtures" / "rag-v1.jsonl"


def generate_tests() -> list[dict[str, Any]]:
    """Build Promptfoo cases without copying questions or reference answers.

    Returns:
        Promptfoo-compatible test objects generated from the canonical JSONL corpus.

    Raises:
        ValueError: If a fixture line cannot be parsed as a JSON object.
        OSError: If the canonical corpus cannot be read.
    """
    logger.info("generate_tests.start fixture_path=%s", FIXTURE_PATH)
    test_cases: list[dict[str, Any]] = []
    for line_number, raw_line in enumerate(FIXTURE_PATH.read_text(encoding="utf-8").splitlines(), start=1):
        if not raw_line.strip():
            continue
        try:
            case = json.loads(raw_line)
        except json.JSONDecodeError as error:
            raise ValueError(f"Invalid RAG fixture JSON at line {line_number}") from error
        if not isinstance(case, dict):
            raise ValueError(f"RAG fixture at line {line_number} must be an object")
        test_cases.append(_build_promptfoo_case(case))
    logger.info("generate_tests.complete case_count=%d", len(test_cases))
    return test_cases


def _build_promptfoo_case(case: dict[str, Any]) -> dict[str, Any]:
    """Translate one canonical fixture to Promptfoo assertions.

    Args:
        case: Canonical RAG fixture with question, reference answer, and tool contract.

    Returns:
        One Promptfoo test that evaluates the same recorded RAG run as RAGAS.

    Raises:
        ValueError: If the fixture has no stable ID, question, reference, or required tool.
    """
    case_id = _required_string(case, "id")
    question = _required_string(case, "question")
    reference_answer = _required_string(case, "reference_answer")
    required_tools = case.get("required_tools")
    if not isinstance(required_tools, list) or len(required_tools) != 1:
        raise ValueError(f"{case_id}: required_tools must contain exactly one tool")
    required_tool = required_tools[0]
    if not isinstance(required_tool, str) or not required_tool.strip():
        raise ValueError(f"{case_id}: required_tools must contain a non-empty string")

    test_case = {
        "description": f"RAG regression: {case_id}",
        "vars": {
            "case_id": case_id,
            "question": question,
            "query": question,
            "reference_answer": reference_answer,
            "required_tool": required_tool,
        },
        "options": {"transform": "output.answer"},
        "assert": [
            {
                "type": "context-faithfulness",
                "threshold": 0.85,
                "contextTransform": "output.retrieved_contexts",
                "provider": "google:gemini-2.0-flash",
                "metric": "context_faithfulness",
            },
            {
                "type": "context-relevance",
                "threshold": 0.7,
                "contextTransform": "output.retrieved_contexts",
                "provider": "google:gemini-2.0-flash",
                "metric": "context_relevance",
            },
            {
                "type": "context-recall",
                "value": reference_answer,
                "threshold": 0.8,
                "contextTransform": "output.retrieved_contexts",
                "provider": "google:gemini-2.0-flash",
                "metric": "context_recall",
            },
            {
                "type": "answer-relevance",
                "threshold": 0.7,
                "provider": "google:gemini-2.0-flash",
                "metric": "answer_relevance",
            },
            {
                "type": "javascript",
                "value": (
                    "const toolCalls = context.providerResponse?.output?.tool_calls ?? []; "
                    "return toolCalls.includes(context.vars.required_tool);"
                ),
                "metric": "required_tool_used",
            },
        ],
    }
    logger.info("_build_promptfoo_case.complete case_id=%s", case_id)
    return test_case


def _required_string(value: dict[str, Any], field: str) -> str:
    """Return a required non-empty fixture string.

    Args:
        value: Fixture object containing the field.
        field: Required field name.

    Returns:
        Trimmed string value.

    Raises:
        ValueError: If the field is absent, non-string, or blank.
    """
    logger.info("_required_string.start field=%s", field)
    candidate = value.get(field)
    if not isinstance(candidate, str) or not candidate.strip():
        raise ValueError(f"Fixture field {field} must be a non-empty string")
    result = candidate.strip()
    logger.info("_required_string.complete field=%s", field)
    return result
