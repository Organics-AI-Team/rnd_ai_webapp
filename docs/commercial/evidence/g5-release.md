# G5 — Commercial Readiness Evidence

Recorded: 2026-07-16 (Asia/Bangkok)

Status: **agentic local/CI testing ready; staging deployment and commercial
release not yet approved.** The repository contains the credential-free
controls, evaluator, browser campaign, rollout mechanisms, operations surface,
lifecycle workflow, deploy image, health probe, and verification entrypoint.
The remaining gates require a reviewed deployment to the existing DigitalOcean
droplet, hosted secrets, reviewed dependency remediation, signed evidence, and
real release operations.

## Gate map

| Task | Local implementation/evidence | Status |
| --- | --- | --- |
| G5.1 corpus | 150 immutable synthetic v1 cases; pinned digest `2a2083f316fef7c3d6f69f2bf54569e1b60c958978a92621e82d3f97dc900f3c` | complete |
| G5.2 scoring | recorded legacy/OODA adapters; deterministic security, formula, evidence, task, latency and cost scorers; pinned grader contract | complete |
| G5.3 threshold gate | exact critical/quality/operational/cost thresholds and strict named-artifact comparison CLI | credential-free 14-gate regression passed; reviewed signed artifacts pending |
| G5.4 shadow | opt-in/platform approval, deterministic sampling, separate budget, write suppression, hashed comparison telemetry, isolated incidents | complete |
| G5.5 rollout | durable tenant assignments/events, in-flight executor/deployment pinning, compare-and-set set/rollback commands, cohort/stop-condition runbook | complete |
| G5.6 operations | deep redaction, aggregate health windows, incident controls/runbook, platform operations page | complete |
| G5.7 governance | export, suspension, retention and verified idempotent deletion across Mongo/Qdrant with an operator runbook | complete |
| G5.8 resilience/load | failure-injection suites and three-run 50-stream synthetic campaign | local regression evidence passed |
| G5.9 release verification | Docker-isolated fail-fast script, hosted workflow, deploy builds, tests, scan, eval, E2E and evidence upload | exact local verifier and hosted workflow passed, including droplet image |
| G5.10 retirement | legacy AI/custom-auth deletion | prohibited until restore window closes |
| G5.11 rollout | 100% tenant rollout and final evidence | not performed from this workspace |

## Latest local verification

| Check | Result |
| --- | --- |
| `npm test` | PASS — 99 files, 901 tests |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS across AI, web, server-config and shared-types workspaces |
| `npm run security:scan` | PASS — 0 private-boundary violations |
| `npm run build:worker` + import smoke | PASS |
| `npm run build:web` | PASS — governed run, resume, events, health, uploads and operations routes compiled |
| Droplet Docker image | PASS — Node 24 standalone image built; running container returned HTTP 200 `{"status":"ok"}` from `/api/health` |
| `npm run test:resilience` | PASS — 5 files, 8 tests |
| `npm run test:load` | PASS — 3 × 50 streams; worst accepted p95 4.744 ms, simple p95 213.622 ms, formula p95 108.894 ms; zero errors, duplicate commits, cross-tenant events or unreconciled usage |
| `npm run test:e2e` | PASS — 6 credential-free agentic cases; 7 Clerk staging cases skipped because staged credentials are absent |
| `npm run eval:legacy` | PASS — 150 cases, 50% test baseline, integrity `5a5a9d72974c02923b757254c61fcb57d47f95fe26f7a63d47d81b740ac7579a` |
| `npm run eval:ooda` | PASS — 150 cases, 100% candidate, integrity `1e1ee68ea450343074f6332ec919970d203b3abe483306583226592cfef2b876` |
| `npm run eval:compare -- --baseline=legacy-frozen --candidate=ooda-current` | PASS in explicit credential-free mode — 14/14 gates |
| exact `COMMERCIAL_TEST_ADAPTER_MODE=credential_free npm run verify:commercial` | PASS — exit 0, isolated Mongo/Qdrant teardown confirmed, deploy image included |
| GitHub hosted commercial workflow | PASS — [run 29501948770](https://github.com/Organics-AI-Team/rnd_ai_webapp/actions/runs/29501948770), 7m13s, artifact `commercial-verification-29501948770`; hosted hashes legacy `9f0796f47f9d42c967481d1056bffdd10baf77b40d8b1753275a52c595483244`, agentic `f2c046876e83870f56956ba5c5cc61876c3c45ce45eb56d34e881bbe49ac33b0` |
| DigitalOcean droplet state | PENDING — the existing droplet is reachable and still runs the previous `main` deployment; this branch has not been deployed and no remote state was changed |
| `npm audit --omit=dev` | RELEASE BLOCKER — existing dependency tree reports 48 advisories: 3 critical, 22 high, 18 moderate, 5 low; remediation/reachability review not completed in this task |

These latency measurements are synthetic in-process regression evidence, not
production capacity or SLO evidence. See `load-resilience.md` for scope.

## External release gates

1. Deploy the reviewed web image and private worker to the existing DigitalOcean
   droplet through its Docker Compose/Nginx topology. No remote variables,
   containers, or deployment state were changed from this workspace.
2. Rotate/revoke any previously exposed provider credentials, provision new
   Gemini, Google Search, Qdrant and Clerk secrets only to the staged server and
   private worker, and record the rotation evidence.
3. Remediate or formally review the production dependency advisories, including
   the critical jsPDF/protobufjs chains and high LangChain/tRPC advisories, then
   record versions, reachability decisions, compensating controls, and approval.
4. Run the frozen tagged legacy executor and the candidate deployment over the
   same reviewed v1 corpus. Produce signed, immutable `legacy-frozen` and
   `ooda-current` aggregate artifacts with the corpus, executor, policy, prompt,
   deployment and rate-card hashes. Do not copy the README examples as results.
5. Run the hosted Docker commercial workflow and a credentialed staged browser
   full story: admission, provider completion/failure, knowledge retrieval,
   formula validation, exact manager approval, checkpoint resume, SSE reconnect,
   usage reconciliation and emergency disable.
6. Promote by reviewed tenant manifests through internal, design partner,
   5%, 25%, 50% and all cohorts. Observe every configured window and exercise
   rollback while proving in-flight runs remain pinned.
7. Reconcile usage and incidents, rehearse restore, retain the legacy path for
   the approved restore window, then obtain deletion approval before G5.10.
8. After the restore window, delete legacy AI/custom-auth code and data through
   the reviewed retirement migration, complete 100% rollout evidence, tag the
   release, and capture named owner sign-off.

Until all eight items are recorded, no 100%-rollout, legacy-retirement, production
SLO, security-equivalence, or commercial-launch claim is supported.
