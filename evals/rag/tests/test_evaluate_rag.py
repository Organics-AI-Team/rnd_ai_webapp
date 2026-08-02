"""Regression tests for the local RAG evaluation runner."""

from __future__ import annotations

import unittest

from evals.rag.evaluate_rag import (
    EvaluationDataError,
    build_evaluation_records,
    summarize_evaluation,
)


class EvaluationRecordTests(unittest.TestCase):
    """Verify that the runner preserves the evaluation corpus contract."""

    def test_build_evaluation_records_matches_outputs_by_id_not_file_order(self) -> None:
        """A reordered result file must not attach an answer to the wrong question."""
        dataset = [
            {
                "id": "rag_v1_niacinamide",
                "question": "What is niacinamide used for?",
                "reference_answer": "Niacinamide supports skin-barrier care.",
                "reference_contexts": ["Niacinamide is used in skin-barrier care."],
            },
            {
                "id": "rag_v1_panthenol",
                "question": "What is panthenol used for?",
                "reference_answer": "Panthenol is commonly used for conditioning.",
                "reference_contexts": ["Panthenol is used for conditioning."],
            },
        ]
        results = [
            {
                "id": "rag_v1_panthenol",
                "answer": "Panthenol is commonly used for conditioning.",
                "retrieved_contexts": ["Panthenol is used for conditioning."],
                "tool_calls": ["qdrant_search"],
                "latency_ms": 420,
                "model": "test-model",
            },
            {
                "id": "rag_v1_niacinamide",
                "answer": "Niacinamide supports skin-barrier care.",
                "retrieved_contexts": ["Niacinamide is used in skin-barrier care."],
                "tool_calls": ["qdrant_search"],
                "latency_ms": 380,
                "model": "test-model",
            },
        ]

        records = build_evaluation_records(dataset, results)

        self.assertEqual(records[0].case_id, "rag_v1_niacinamide")
        self.assertEqual(records[0].answer, "Niacinamide supports skin-barrier care.")
        self.assertEqual(records[1].case_id, "rag_v1_panthenol")
        self.assertEqual(records[1].latency_ms, 420)

    def test_build_evaluation_records_rejects_a_missing_retrieved_context(self) -> None:
        """An answer without captured retrieval evidence is not a valid RAG evaluation."""
        dataset = [
            {
                "id": "rag_v1_no_context",
                "question": "Which material is in stock?",
                "reference_answer": "Use the stock record.",
                "reference_contexts": ["RM-001 is in stock."],
            },
        ]
        results = [
            {
                "id": "rag_v1_no_context",
                "answer": "RM-001 is in stock.",
                "retrieved_contexts": [],
                "tool_calls": ["qdrant_search"],
                "latency_ms": 300,
                "model": "test-model",
            },
        ]

        with self.assertRaisesRegex(EvaluationDataError, "rag_v1_no_context.*retrieved_contexts"):
            build_evaluation_records(dataset, results)

    def test_summary_fails_its_gate_when_faithfulness_or_latency_is_below_target(self) -> None:
        """A strong average cannot hide a failed grounding or latency release gate."""
        summary = summarize_evaluation(
            case_scores=[
                {
                    "id": "rag_v1_a",
                    "metrics": {
                        "faithfulness": 0.96,
                        "context_precision": 0.91,
                        "context_recall": 0.94,
                        "factual_correctness": 0.92,
                        "answer_relevancy": 0.89,
                    },
                    "latency_ms": 1000,
                },
                {
                    "id": "rag_v1_b",
                    "metrics": {
                        "faithfulness": 0.70,
                        "context_precision": 0.92,
                        "context_recall": 0.93,
                        "factual_correctness": 0.91,
                        "answer_relevancy": 0.88,
                    },
                    "latency_ms": 31_000,
                },
            ],
            thresholds={
                "faithfulness": 0.85,
                "context_precision": 0.70,
                "context_recall": 0.80,
                "factual_correctness": 0.80,
                "answer_relevancy": 0.70,
                "p95_latency_ms": 30_000,
            },
        )

        self.assertFalse(summary["gate"]["passed"])
        self.assertIn("faithfulness", summary["gate"]["failures"])
        self.assertIn("p95_latency_ms", summary["gate"]["failures"])
        self.assertEqual(summary["performance"]["p95_latency_ms"], 31_000)


if __name__ == "__main__":
    unittest.main()
