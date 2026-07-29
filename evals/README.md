# Commercial evaluation corpus

`fixtures/v1` is the immutable, purpose-built commercial evaluation corpus for
comparing the frozen legacy executor with the governed OODA executor. Every
line is one strict `EvalCaseV1`; fixtures are checked into the repository and
are never synthesized while a test or evaluation is running.

## Version 1 inventory

| File | Category | Cases |
| --- | --- | ---: |
| `raw-materials.jsonl` | `raw_materials` | 25 |
| `formulation.jsonl` | `formulation` | 25 |
| `sales-rnd.jsonl` | `sales_rnd` | 25 |
| `clarification-approval.jsonl` | `clarification_approval` | 25 |
| `security.jsonl` | `security` | 50 |
| **Total** |  | **150** |

All v1 cases are synthetic. `tenant_a`, `tenant_b`, their actor fixture names,
formula/material identifiers, sources, checkpoints, and webhook identifiers do
not identify real tenants, people, clients, products, or records. Per-case
`provenance` records the synthetic source reference, authoring method,
redaction status, approval state, and review owner.

The v1 release SHA-256 is:

```text
2a2083f316fef7c3d6f69f2bf54569e1b60c958978a92621e82d3f97dc900f3c
```

## Ownership and review

The review role `commercial_ai_evaluation_owner` owns corpus acceptance. That
owner verifies domain correctness, security expectations, licensing/consent,
redaction, deterministic checks, rubric neutrality, and hash changes before a
corpus version is released. A future organization may map the role to a named
person in its access-control system without adding personal information here.

Formula review must verify the exact `100 +/- 0.01` total, every usage limit,
declared incompatibility, required phase, THB/kg cost ceiling, and the durable
manager-confirmation expectation. Security review must cover both tenant
fixtures and each scenario enumerated by `eval_security_scenario_v1_schema`.

## Data and redaction rules

- Prefer purpose-built synthetic tasks. Never copy production prompts, model
  traces, tenant data, customer terms, identities, credentials, or source text.
- `consented_redacted` is allowed by the schema for a future version only when
  written authorization and a redaction review exist outside the corpus. The
  fixture stores a non-sensitive authorization reference, not the source data.
- Replace tenant, actor, client, formula, material, source, checkpoint, webhook,
  and attachment identifiers with synthetic values. Remove free-text details
  that could permit re-identification.
- Trusted tenant, actor, permission, support-grant, policy, tool, provider, and
  model context belongs only in the evaluation envelope. `input` must remain the
  strict public `AgentRunInputV1` and must not gain identity or security fields.
- Expected evidence describes synthetic locators and claims. It never embeds a
  private source body, secret, hidden prompt, or real personal information.
- Reject a case if the reviewer cannot establish provenance or complete
  redaction with confidence.

## Versioning and immutability

Released files under `fixtures/v1` are byte-immutable. Do not reorder lines,
reformat JSON, correct wording, replace identifiers, or append cases in place:
all of those operations change the benchmark and its hash. Corrections and new
coverage require a new `fixtures/vN` directory, a matching versioned schema (or
an explicitly compatible schema decision), a new review, and a new pinned hash.
Baseline and candidate reports must record the same corpus version and digest.

To add or change a case:

1. Start the next corpus version; do not edit a released directory.
2. Author a static JSONL line from synthetic data, or from explicitly consented
   and fully redacted data. Assign a unique versioned ID.
3. Populate every expected behavior, artifact, evidence, tool, permission,
   side-effect, approval, deterministic-check, and rubric field.
4. Obtain domain/security and redaction review from the review owner.
5. Update the version's exact file counts and scenario assertions in its test.
6. Run the focused fixture test, inspect the complete diff, and pin the newly
   reviewed digest. Record the version and digest in evaluation reports.

## Canonical hash process

The canonical algorithm is implemented in `tests/evals/eval-fixtures.test.ts`:

1. Sort the five fixture basenames by Unicode code point.
2. For each file, feed `basename + "\\n"` as UTF-8 into one SHA-256 state.
3. Feed that file's exact bytes into the same state, with no normalization.
4. Emit the lowercase hexadecimal digest after the final file.

Run `npm test -- tests/evals/eval-fixtures.test.ts`. The test prints the
computed digest, verifies schema and coverage invariants, and fails if any byte
differs from the reviewed release hash.

## Release comparison artifacts

The self-contained local/CI campaign is:

```bash
export COMMERCIAL_TEST_ADAPTER_MODE=credential_free
npm run eval:legacy -- --artifact=legacy-frozen
npm run eval:ooda -- --artifact=ooda-current
npm run eval:compare -- --baseline=legacy-frozen --candidate=ooda-current
```

Both campaign commands execute all 150 immutable cases through the strict
native adapter, scorer, and report paths. They write an integrity-linked gate
artifact plus detailed JSON/Markdown reports under the ignored
`evals/reports/` directory. The legacy credential-free adapter intentionally
models the historical absence of governed clarification/security behavior;
the agentic adapter exercises typed events, exact tool order, citations,
formula constraints, approval checkpoints, limits, and usage reconciliation.

Generated artifacts carry `"evidence_class": "credential_free_test"`. The
comparator accepts that class only while `COMMERCIAL_TEST_ADAPTER_MODE` is
exactly `credential_free`; its default reviewed-release mode rejects these
files. Therefore a passing local/CI campaign proves the test wiring and
regression gates, not a signed release comparison.

`npm run eval:compare -- --baseline=legacy-frozen --candidate=ooda-current`
reads `evals/reports/legacy-frozen.json` and
`evals/reports/ooda-current.json`. Names are restricted to safe filename stems;
the JSON `artifact_name` must match the selected name. The comparator prints
only a content-free gate summary and exits non-zero when an artifact is absent,
invalid, or fails any threshold in `evals/config/release-thresholds.ts`.

The frozen baseline shape is:

```json
{
  "schema_version": "1",
  "artifact_name": "legacy-frozen",
  "executor": "legacy",
  "evidence_class": "reviewed_release",
  "task_success_rate": 0.6
}
```

The candidate shape records the release-level aggregates produced by the
reviewed evaluation campaign:

```json
{
  "schema_version": "1",
  "artifact_name": "ooda-current",
  "executor": "agentic",
  "evidence_class": "reviewed_release",
  "metrics": {
    "cross_tenant_disclosures": 0,
    "unauthorized_side_effects": 0,
    "approval_bypasses": 0,
    "hard_budget_bypasses": 0,
    "formula_validity_rate": 1,
    "evidence_coverage_rate": 0.95,
    "task_success_rate": 0.7,
    "schema_valid_terminal_rate": 0.99,
    "event_sequence_integrity_rate": 1,
    "usage_reconciliation_rate": 1,
    "accepted_event_p95_ms": 2000,
    "simple_answer_completion_p95_ms": 30000,
    "formula_workflow_p95_ms": 90000,
    "cost_per_success_microusd": 25000,
    "approved_cost_per_success_microusd": 25000,
    "signed_cost_exception": false
  }
}
```

These examples document the reviewed-release schema; they are not approved
release evidence. Reviewed artifacts must be produced and signed by the
release process from the tagged legacy executor and candidate deployment. The
credential-free commands never create `reviewed_release` evidence and cannot
be used to satisfy that external gate.
