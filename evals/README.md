# AI evaluation

This directory evaluates the unified `/api/ai/rnd-agent` in two complementary ways:

| Layer | Framework | What it measures |
| --- | --- | --- |
| RAG quality | RAGAS | Faithfulness, context precision/recall, factual correctness, answer relevancy, and latency gates. |
| Regression and safety | Promptfoo | Replayable grounding/relevance assertions, required-tool checks, and prompt-injection regressions. |

The checked-in corpus and example output are synthetic. They prove that the harness works; they do **not** establish the production AI's performance. Create a reviewed, redacted corpus that maps to real Qdrant source passages before treating any score as a release decision.

## Local AI QA agent

`qa-agent/qa-evaluator.cjs` is the fast first layer: a separate, deterministic
QA agent that grades recorded R&D AI answers without calling an LLM. It checks
the expected tool trace, language, required answer concepts, refusal behavior,
secret leakage, raw HTML leakage, failed-tool grounding behavior, per-case
latency, and aggregate p50/p95 latency. This is intentionally paired with—not a replacement for—the RAGAS
and Promptfoo LLM-as-a-judge layer below.

For general ingredient or cosmetic-science questions, a case may declare
`required_any_tools` (for example, Qdrant **or** MongoDB) and
`allowed_fallback_tools: ["web_search"]`. This verifies the intended behavior:
try internal evidence first, then use cited external evidence when internal
coverage is empty or unavailable. Do not allow that fallback for live stock,
company-specific cost, or a production-ready formula.

Run the reviewed synthetic baseline locally with no API keys or product calls:

```bash
node evals/qa-agent/qa-evaluator.cjs --strict \
  --report /tmp/rnd-ai-qa-local.json
```

To assess a real local capture, first replay the QA corpus into the local
endpoint. Fixtures can include `conversation_history`, so the follow-up case
exercises the same transcript handoff as the chat UI without changing a real
thread. The evaluator refuses to overwrite reports unless `--overwrite` is
supplied.

```bash
node evals/rag/capture-runs.cjs --allow-live \
  --endpoint http://localhost:3000/api/ai/rnd-agent \
  --user-id <authorized-evaluation-user> \
  --dataset evals/qa-agent/fixtures/qa-v1.jsonl \
  --output evals/rag/results/rnd-agent-qa-local.jsonl

node evals/qa-agent/qa-evaluator.cjs --strict \
  --results evals/rag/results/rnd-agent-qa-local.jsonl \
  --report evals/rag/reports/qa-agent-local.json
```

The checked-in QA starter corpus covers English and Thai material lookup, stock
claims, follow-up memory, formula safety, and prompt-injection refusal. Before
using it as a release gate, replace the synthetic expected concepts with a
reviewed, redacted corpus from your own data.

### QA-only local backing services

`qa-agent/local-services.compose.yml` runs a separate MongoDB and Qdrant on
ports `27027` and `6335`. `seed-local-services.cjs` refuses any other endpoint
and seeds only synthetic QA materials and stock; it does not edit `.env.local`
or contact a production database.

```bash
docker compose -f evals/qa-agent/local-services.compose.yml up -d
node evals/qa-agent/seed-local-services.cjs

MONGODB_URI=mongodb://127.0.0.1:27027/rnd_ai \
RAW_MATERIALS_REAL_STOCK_MONGODB_URI=mongodb://127.0.0.1:27027/raw_materials \
QDRANT_URL=http://127.0.0.1:6335 \
npm run dev:web
```

In a second terminal, capture and grade the corpus using the commands above.
When finished, stop the QA-only services without deleting their named volumes:

```bash
docker compose -f evals/qa-agent/local-services.compose.yml stop
```

## RAGAS: capture and score a real run

Install the isolated Python environment once:

```bash
uv sync --project evals/rag
```

The guarded collector sends each canonical question to the running unified agent. It cannot run without `--allow-live`, and it refuses to replace an existing result unless `--overwrite` is explicit.

```bash
node evals/rag/capture-runs.cjs \
  --allow-live \
  --endpoint http://localhost:3000/api/ai/rnd-agent \
  --user-id <authorized-evaluation-user> \
  --output evals/rag/results/rnd-agent-$(date +%Y%m%d).jsonl
```

Use an authorized test user and read-only questions only. The collector sends `persistFormula: false`, but the corpus owner remains responsible for ensuring that its prompts cannot trigger a side effect. Captured results include raw retrieved context, so `results/` and `reports/` are intentionally ignored by Git.

Validate the captured shape before paying for an LLM judge:

```bash
uv run --project evals/rag python evals/rag/evaluate_rag.py \
  --results evals/rag/results/rnd-agent-YYYYMMDD.jsonl \
  --validate
```

Then score the run. The runner accepts the application's existing `GEMINI_API_KEY`, or `GOOGLE_API_KEY`; it never writes the credential into a report.

```bash
GEMINI_API_KEY=... uv run --project evals/rag python evals/rag/evaluate_rag.py \
  --results evals/rag/results/rnd-agent-YYYYMMDD.jsonl \
  --report evals/rag/reports/rnd-agent-YYYYMMDD.json \
  --strict
```

`--strict` exits with code `2` if a release gate fails. Tune the judge model, embedding model, and thresholds in [`rag/eval-config.json`](rag/eval-config.json), rather than editing the runner.

For a no-production-data setup check, validate the checked-in synthetic artifact:

```bash
uv run --project evals/rag python evals/rag/evaluate_rag.py \
  --results evals/rag/example-results.synthetic.jsonl \
  --validate
```

## Promptfoo: replay recorded runs

Promptfoo uses `recorded-output-provider.cjs` to read the same captured JSONL. It can therefore grade the exact retrieved contexts and tool trace that RAGAS sees without sending another application request.

Run the full RAG regression suite after a captured run is available. Promptfoo's Gemini judge expects `GOOGLE_API_KEY`; when only `GEMINI_API_KEY` exists, export it under that name for the command.

```bash
GOOGLE_API_KEY="$GEMINI_API_KEY" \
AI_EVAL_RESULTS_PATH=evals/rag/results/rnd-agent-YYYYMMDD.jsonl \
npx --yes promptfoo@0.121.20 eval -c evals/promptfoo/promptfooconfig.yaml \
  --output evals/promptfoo/reports/rnd-agent-YYYYMMDD.json
```

The safety suite is deterministic and has no judge-model cost. First collect its one prompt with the same guarded collector, then replay it:

```bash
node evals/rag/capture-runs.cjs \
  --allow-live \
  --endpoint http://localhost:3000/api/ai/rnd-agent \
  --user-id <authorized-evaluation-user> \
  --dataset evals/promptfoo/safety-fixtures.jsonl \
  --output evals/rag/results/safety-YYYYMMDD.jsonl

AI_EVAL_RESULTS_PATH=evals/rag/results/safety-YYYYMMDD.jsonl \
npx --yes promptfoo@0.121.20 eval -c evals/promptfoo/promptfooconfig-safety.yaml \
  --output evals/promptfoo/reports/safety-YYYYMMDD.json
```

## Corpus contract

`rag/fixtures/rag-v1.jsonl` is the source of truth. Each case needs a stable `id`, `question`, reviewed `reference_answer`, reviewed `reference_contexts`, and the `required_tools` expected from the agent. The captured file must contain exactly the same IDs plus `answer`, `retrieved_contexts`, `tool_calls`, `latency_ms`, and `model`.

When creating a production benchmark:

- Use synthetic, consented, or fully redacted data only. Never commit customer prompts or raw production retrievals.
- Build reference contexts from the collection and document version that the test is intended to evaluate.
- Keep inputs, source passage locators/hashes, prompt version, model, retrieval parameters, and corpus revision with the report.
- Expand beyond the starter five cases before setting release policy; cover Thai and English requests, exact lookup, semantic retrieval, stock claims, formula constraints, and refusal/security behavior.
- Compare candidates against a frozen baseline using the same corpus and judge configuration; do not change the baseline to make a candidate pass.

## Verification

```bash
python3 -m unittest evals.rag.tests.test_evaluate_rag
node --test evals/rag/tests/capture-runs.test.cjs
node --test evals/promptfoo/tests/recorded-output-provider.test.cjs
node --test evals/qa-agent/tests/qa-evaluator.test.cjs
```

RAGAS is locked to `0.4.3`. `langchain-community` is deliberately pinned to `0.3.31`: its later `0.4` release no longer provides RAGAS 0.4.3's Vertex AI import path.
