# G5.8 Load and Resilience Evidence

Recorded: 2026-07-16 (Asia/Bangkok)

Result: **PASS for the credential-free synthetic verification slice.** This is
not production capacity evidence and does not replace the Docker/CI and
credentialed release environment required by the full Task 8 plan.

## Scope and environment

- Workload: `commercial-synthetic-v1`, 50 concurrent tenant-scoped reconnect
  streams per run; 40 simple and 10 formula-labelled streams.
- Repetitions: three sequential runs; the worst p95 is compared with the gate.
- Content: fixed synthetic identifiers and control payloads only. No real tenant
  prompt, document, email, vector, formula, credential, or provider response.
- Host: Apple M2, 16 GiB RAM, arm64 macOS Darwin 24.6.0.
- Runtime: Node.js 24.10.0, npm 11.6.0, TypeScript runner `tsx` 4.20.6,
  Vitest 4.1.10.
- Persistence under measurement: `mongodb-memory-server` 11.2.0 using its
  resolved MongoDB 8.2.6 binary; MongoDB Node driver 6.21.0.
- Docker images: none. No `docker-compose.test.yml` environment was used in
  this credential-free slice.
- External dependencies: no Gemini/model call, Clerk API call, Qdrant server,
  object storage, or internet request.

Command:

```bash
npx tsx scripts/run-commercial-load.ts --repetitions=3
```

Campaign result hash:
`0c9891080ffcbb9b10af7c21459a38e5d3106a2d053873e1054651c28321166e`

## Measured synthetic load results

Latency values are milliseconds measured with the local monotonic clock. Each
completion measurement includes Mongo event append, tenant authorization, SSE
formatting, and reconnect replay after event sequence 0. Acceptance is the
injected gateway admission seam; it does not include a real provider or network.

| Run | Accepted p50 / p95 / p99 | Simple completion p50 / p95 / p99 | Formula completion p50 / p95 / p99 | Elapsed | Hash |
| --- | ---: | ---: | ---: | ---: | --- |
| 1 | 6.225 / 10.184 / 10.259 | 125.840 / 247.913 / 404.404 | 128.774 / 129.017 / 129.017 | 761.712 | `1fdb684e64c1722aac042e9efb2e47f5b5a3818540ee651ca1c888366c6d0b32` |
| 2 | 1.845 / 2.647 / 2.683 | 155.414 / 675.163 / 687.209 | 155.241 / 165.882 / 165.882 | 1105.740 | `19028846e255ccc6f70ad83a4cb1d4c3ac27845df203ca8c4a11c55da78683a9` |
| 3 | 1.948 / 3.510 / 3.549 | 41.672 / 173.774 / 191.424 | 43.871 / 52.890 / 52.890 | 424.258 | `cdfbe2c448650e5084165be9c75d2e7ec9a3b7b67c15dc0b5bb680a2ec044ff1` |

Worst observed gates:

| Gate | Threshold | Worst observed | Result |
| --- | ---: | ---: | --- |
| Concurrent event streams | 50 | 50 | PASS |
| Accepted event p95 | <= 2,000 ms | 10.184 ms | PASS |
| Simple completion p95 | <= 30,000 ms | 675.163 ms | PASS |
| Formula completion p95 | <= 90,000 ms | 165.882 ms | PASS |
| Errors | 0 | 0 | PASS |
| Duplicate commits | 0 | 0 | PASS |
| Cross-tenant events | 0 | 0 | PASS |
| Unreconciled usage entries | 0 | 0 | PASS |

Every run replayed exactly 100 post-reconnect event frames (two per stream),
with ordered terminal completion and no cross-tenant replay. The load harness's
duplicate-commit and usage counters are synthetic markers/ledgers; durable
tool-idempotency and emergency reservation behavior are verified separately in
the focused resilience suite below.

## Failure-injection evidence

Command:

```bash
npm test -- tests/resilience tests/load
```

The focused suite exercises production coordinators with synthetic dependency
adapters:

| Scenario | Injected condition | Verified outcome |
| --- | --- | --- |
| Provider outage | Executor throws safe `PROVIDER_TIMEOUT` and `PROVIDER_RATE_LIMITED_429` failures | Worker releases the lease with backoff, does not append a terminal event during outage, cannot reclaim before backoff, and completes once the provider seam recovers |
| Mongo worker recovery | Worker A is abandoned after a governed synthetic commit but before event/status/job acknowledgement | Worker B reclaims after lease expiry; a fresh `ToolExecutor` reads the shared durable idempotency port; commit count, terminal event, and completed job are each exactly one |
| Qdrant outage | Governed Qdrant driver throws transient or repeated failures | Read tool retries at most twice; recovery returns an explicit empty evidence set; exhausted retries surface stable `TOOL_EXECUTION_FAILED` with no unsupported result |
| Clerk webhook burst | 50 correctly signed deliveries contain ten unique IDs, five deliveries each, in reverse event-time order | Every response is 200; each event ID applies once; monotonic projection retains the newest synthetic revision |
| Emergency disable: admission | Switch activates before a 50-request admission burst | All 50 requests fail with `AIDisabledError`; no new budget reservation, run, or job is created |
| Emergency disable: active action | Fatal `POLICY_EMERGENCY_DISABLED` verdict at the next action gate | Active run routes to `fail`; tool execution count remains zero |
| SSE reconnect/isolation | 50 streams reconnect with `Last-Event-ID: 0`; every run is probed from the wrong synthetic tenant | Sequences 1 and 2 replay once in order, terminal streams close, and every cross-tenant probe returns 404 |

## What was not measured

The following remain release-environment gates and must not be inferred from
the passing synthetic numbers:

- production throughput, autoscaling, proxy buffering, network latency, TLS,
  connection-pool limits, or browser EventSource behavior;
- real model-provider timeout/429 classification, jitter, SDK retries, token
  accounting, price/cost reconciliation, or credential rotation;
- real Mongo process termination, replica-set election/stepdown, disk pressure,
  checkpoint recovery, or multi-process durable idempotency wiring;
- real Qdrant network failure, collection size, vector search latency, payload
  filtering at service scale, or re-index recovery;
- Clerk delivery infrastructure, signature-secret rotation, endpoint rate
  limits, or replay from the Clerk control plane;
- formula business validation or a paid end-to-end model/tool completion.

Those claims require the Task 8 Docker/CI environment, controlled test
credentials, and the same three-run worst-case evidence format. The local p95s
above are useful regression measurements only; they are not an SLO forecast.
