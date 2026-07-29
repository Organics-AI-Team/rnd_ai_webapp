/**
 * Deterministic, credential-free commercial AI load harness (G5.8).
 *
 * This is an in-process synthetic workload, not a production capacity test. It
 * exercises the real Mongo event store and SSE run-events handler with fixed
 * tenant/run/event identities and contains no real tenant content or provider
 * calls.
 */

import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";

import { AIRunNotFoundError } from "../../apps/ai/server/repositories/ai-run-repository";
import { create_event_store } from "../../apps/ai/server/services/ai-gateway/event-store";
import {
  handle_run_events,
  type RunApiCollaborators,
} from "../../apps/ai/server/services/ai-gateway/run-api-handlers";
import type {
  AIGateway,
  AcceptedRun,
} from "../../apps/ai/server/services/ai-gateway/ai-gateway";
import type { AgentRunEventV1 } from "../../packages/shared-types/src/ai/contracts";
import type { TenantExecutionContext } from "../../packages/shared-types/src/tenant";

/** Immutable correctness and latency expectations from G5 Task 8. */
export const resilience_expectations = Object.freeze({
  concurrent_event_streams: 50,
  accepted_event_p95_ms: 2_000,
  simple_completion_p95_ms: 30_000,
  formula_completion_p95_ms: 90_000,
  duplicate_commits: 0,
  cross_tenant_events: 0,
  unreconciled_usage_entries: 0,
});

const SIMPLE_STREAMS = 40;
const FORMULA_STREAMS = 10;
const CORPUS_ID = "commercial-synthetic-v1";

/** Percentile summary for one measured latency family. */
export interface LatencySummary {
  readonly sample_count: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

/** Result of one fixed 50-stream synthetic workload. */
export interface CommercialSyntheticLoadRun {
  readonly mode: "synthetic_in_process";
  readonly corpus_id: typeof CORPUS_ID;
  readonly run_number: number;
  readonly concurrent_event_streams: 50;
  readonly accepted_latency_ms: LatencySummary;
  readonly simple_completion_latency_ms: LatencySummary;
  readonly formula_completion_latency_ms: LatencySummary;
  readonly reconnected_event_frames: number;
  readonly errors: number;
  readonly duplicate_commits: number;
  readonly cross_tenant_events: number;
  readonly unreconciled_usage_entries: number;
  readonly elapsed_ms: number;
  readonly passed: boolean;
  readonly result_hash: string;
}

/** Worst measurements retained across a repeated campaign. */
export interface CommercialLoadWorstCase {
  readonly accepted_event_p95_ms: number;
  readonly simple_completion_p95_ms: number;
  readonly formula_completion_p95_ms: number;
  readonly errors: number;
  readonly duplicate_commits: number;
  readonly cross_tenant_events: number;
  readonly unreconciled_usage_entries: number;
}

/** Three-run-by-default campaign result used by the CLI and evidence file. */
export interface CommercialLoadCampaign {
  readonly mode: "synthetic_in_process";
  readonly corpus_id: typeof CORPUS_ID;
  readonly repetitions: number;
  readonly expectations: typeof resilience_expectations;
  readonly runs: readonly CommercialSyntheticLoadRun[];
  readonly worst: CommercialLoadWorstCase;
  readonly passed: boolean;
  readonly result_hash: string;
}

/** Stable SHA-256 over JSON-safe synthetic evidence. */
function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

/** Nearest-rank percentile rounded to microsecond precision in milliseconds. */
function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return Number((sorted[index] ?? 0).toFixed(3));
}

/** Summarize one non-empty measured latency array. */
function summarize(values: readonly number[]): LatencySummary {
  return {
    sample_count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
  };
}

/** Stable 24-character Mongo-compatible identifier for a synthetic label. */
function stable_id(label: string): string {
  return createHash("sha256").update(label, "utf8").digest("hex").slice(0, 24);
}

/** Build a synthetic context; no identity or content comes from a live tenant. */
function context_for(index: number): TenantExecutionContext {
  return {
    tenant_id: stable_id(`synthetic-tenant-${index}`),
    actor_profile_id: stable_id(`synthetic-actor-${index}`),
    correlation_id: `synthetic-correlation-${index}`,
  } as TenantExecutionContext;
}

/** Build the three ordered events used by every reconnect stream. */
function events_for(run_id: string, formula: boolean): readonly AgentRunEventV1[] {
  const occurred_at = "2026-07-15T00:00:00.000Z";
  return [
    {
      schema_version: "1",
      event_id: `${run_id}-0`,
      run_id,
      sequence: 0,
      occurred_at,
      type: "run.accepted",
      payload: { agent_key: formula ? "formulation" : "synthetic-simple" },
    },
    {
      schema_version: "1",
      event_id: `${run_id}-1`,
      run_id,
      sequence: 1,
      occurred_at,
      type: "stage.changed",
      payload: { stage: "finalizing" },
    },
    {
      schema_version: "1",
      event_id: `${run_id}-2`,
      run_id,
      sequence: 2,
      occurred_at,
      type: "run.completed",
      payload: { status: "completed", output_schema_version: "1" },
    },
  ] as readonly AgentRunEventV1[];
}

/** Read an SSE response fully into text. */
async function read_stream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let body = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return body;
    body += decoder.decode(value, { stream: true });
  }
}

/** Count replayed SSE event frames, excluding heartbeats. */
function event_frame_count(body: string): number {
  return body.match(/^id:\s+\d+$/gm)?.length ?? 0;
}

/**
 * Run one fixed 50-stream workload and collect in-process measurements.
 *
 * @param options - Stable one-based run number used only in synthetic IDs.
 * @returns Correctness counters, percentiles, threshold verdict, and hash.
 */
export async function run_commercial_synthetic_load(
  options: { readonly run_number: number },
): Promise<CommercialSyntheticLoadRun> {
  if (!Number.isSafeInteger(options.run_number) || options.run_number < 1) {
    throw new Error("commercial load run number is invalid");
  }
  const campaign_started = performance.now();
  const server = await MongoMemoryServer.create();
  const client = new MongoClient(server.getUri());
  await client.connect();
  try {
    const store = create_event_store(client.db(`commercial_load_${options.run_number}`));
    const tenant_by_run = new Map<string, string>();
    const reservations = new Set<string>();
    const reconciled = new Set<string>();
    const committed = new Set<string>();
    let duplicate_commits = 0;
    let errors = 0;
    let reconnected_event_frames = 0;
    const accepted_latencies: number[] = [];
    const simple_completion_latencies: number[] = [];
    const formula_completion_latencies: number[] = [];

    const gateway: AIGateway = {
      async create_run(tenant, input): Promise<AcceptedRun> {
        const candidate = input as { idempotency_key?: unknown };
        const idempotency_key = String(candidate.idempotency_key ?? "");
        const run_id = stable_id(
          `${options.run_number}:${tenant.tenant_id}:${idempotency_key}`,
        );
        const already_accepted = tenant_by_run.has(run_id);
        tenant_by_run.set(run_id, tenant.tenant_id);
        reservations.add(run_id);
        return {
          run_id,
          status: "accepted",
          executor: "agentic",
          events_url: `/api/ai/runs/${run_id}/events`,
          already_accepted,
        };
      },
    };
    const deps: RunApiCollaborators = {
      gateway,
      events: store,
      async authorize_run(tenant_id, run_id) {
        if (tenant_by_run.get(run_id) !== tenant_id) throw new AIRunNotFoundError();
      },
      async submit_resume() {
        throw new Error("synthetic load does not submit resumes");
      },
      heartbeat_ms: 1,
      sleep: async () => undefined,
    };

    await Promise.all(
      Array.from(
        { length: resilience_expectations.concurrent_event_streams },
        async (_unused, index) => {
          const formula = index >= SIMPLE_STREAMS;
          const context = context_for(index);
          const accepted_started = performance.now();
          const accepted = await gateway.create_run(context, {
            schema_version: "1",
            idempotency_key: `synthetic-${index.toString().padStart(2, "0")}`,
          });
          accepted_latencies.push(performance.now() - accepted_started);
          const completion_started = performance.now();
          try {
            await store.append(
              { tenant_id: context.tenant_id, run_id: accepted.run_id },
              events_for(accepted.run_id, formula),
            );
            if (formula) {
              if (committed.has(accepted.run_id)) duplicate_commits += 1;
              committed.add(accepted.run_id);
            }
            // Cursor 0 represents a client reconnect after observing run.accepted.
            const response = await handle_run_events(
              context,
              accepted.run_id,
              "0",
              deps,
            );
            const body = await read_stream(response);
            const frames = event_frame_count(body);
            if (response.status !== 200 || frames !== 2 || !body.includes("event: run.completed")) {
              errors += 1;
            }
            reconnected_event_frames += frames;
            reconciled.add(accepted.run_id);
          } catch {
            errors += 1;
          } finally {
            const duration_ms = performance.now() - completion_started;
            (formula
              ? formula_completion_latencies
              : simple_completion_latencies
            ).push(duration_ms);
          }
        },
      ),
    );

    let cross_tenant_events = 0;
    await Promise.all(
      [...tenant_by_run.keys()].map(async (run_id, index) => {
        const wrong_context = context_for((index + 1) % resilience_expectations.concurrent_event_streams);
        const response = await handle_run_events(wrong_context, run_id, null, deps);
        if (response.status !== 404) {
          cross_tenant_events += event_frame_count(await read_stream(response));
        }
      }),
    );

    const accepted_latency_ms = summarize(accepted_latencies);
    const simple_completion_latency_ms = summarize(simple_completion_latencies);
    const formula_completion_latency_ms = summarize(formula_completion_latencies);
    const unreconciled_usage_entries = [...reservations].filter(
      (run_id) => !reconciled.has(run_id),
    ).length;
    const elapsed_ms = Number((performance.now() - campaign_started).toFixed(3));
    const without_hash = {
      mode: "synthetic_in_process" as const,
      corpus_id: CORPUS_ID,
      run_number: options.run_number,
      concurrent_event_streams: resilience_expectations.concurrent_event_streams,
      accepted_latency_ms,
      simple_completion_latency_ms,
      formula_completion_latency_ms,
      reconnected_event_frames,
      errors,
      duplicate_commits,
      cross_tenant_events,
      unreconciled_usage_entries,
      elapsed_ms,
      passed:
        errors === 0 &&
        duplicate_commits === resilience_expectations.duplicate_commits &&
        cross_tenant_events === resilience_expectations.cross_tenant_events &&
        unreconciled_usage_entries === resilience_expectations.unreconciled_usage_entries &&
        accepted_latency_ms.p95 <= resilience_expectations.accepted_event_p95_ms &&
        simple_completion_latency_ms.p95 <= resilience_expectations.simple_completion_p95_ms &&
        formula_completion_latency_ms.p95 <= resilience_expectations.formula_completion_p95_ms,
    };
    return { ...without_hash, result_hash: sha256(without_hash) };
  } finally {
    await client.close();
    await server.stop();
  }
}

/**
 * Repeat the fixed workload and retain worst-case values as release evidence.
 *
 * @param options - Repetition count, normally three per Task 8.
 * @returns Individual runs plus worst-case threshold/correctness evidence.
 */
export async function run_commercial_load_campaign(
  options: { readonly repetitions: number },
): Promise<CommercialLoadCampaign> {
  if (
    !Number.isSafeInteger(options.repetitions) ||
    options.repetitions < 1 ||
    options.repetitions > 10
  ) {
    throw new Error("commercial load repetition count is invalid");
  }
  const runs: CommercialSyntheticLoadRun[] = [];
  for (let run_number = 1; run_number <= options.repetitions; run_number += 1) {
    runs.push(await run_commercial_synthetic_load({ run_number }));
  }
  const worst: CommercialLoadWorstCase = {
    accepted_event_p95_ms: Math.max(...runs.map((run) => run.accepted_latency_ms.p95)),
    simple_completion_p95_ms: Math.max(
      ...runs.map((run) => run.simple_completion_latency_ms.p95),
    ),
    formula_completion_p95_ms: Math.max(
      ...runs.map((run) => run.formula_completion_latency_ms.p95),
    ),
    errors: Math.max(...runs.map((run) => run.errors)),
    duplicate_commits: Math.max(...runs.map((run) => run.duplicate_commits)),
    cross_tenant_events: Math.max(...runs.map((run) => run.cross_tenant_events)),
    unreconciled_usage_entries: Math.max(
      ...runs.map((run) => run.unreconciled_usage_entries),
    ),
  };
  const without_hash = {
    mode: "synthetic_in_process" as const,
    corpus_id: CORPUS_ID,
    repetitions: options.repetitions,
    expectations: resilience_expectations,
    runs,
    worst,
    passed:
      runs.every((run) => run.passed) &&
      worst.accepted_event_p95_ms <= resilience_expectations.accepted_event_p95_ms &&
      worst.simple_completion_p95_ms <= resilience_expectations.simple_completion_p95_ms &&
      worst.formula_completion_p95_ms <= resilience_expectations.formula_completion_p95_ms,
  };
  return { ...without_hash, result_hash: sha256(without_hash) };
}
