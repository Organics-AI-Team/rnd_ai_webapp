/** G5.6 aggregate health windows, histograms, and automatic stop signals. */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CommercialEvent } from "../../apps/ai/server/services/observability/commercial-events";
import {
  G5_STOP_THRESHOLDS,
  compute_health_metrics,
  load_platform_operations_data,
} from "../../apps/ai/server/services/observability/health-metrics";

const NOW = new Date("2026-07-15T12:00:00.000Z");
const CONFIG = {
  now: () => NOW,
  latency_slo_ms: 1_000,
  approved_candidate_task_success_rate: 0.8,
};

/** Build a complete content-free event fixture. */
function event(
  overrides: Partial<CommercialEvent> = {},
): CommercialEvent {
  return {
    schema_version: "1",
    event_name: "run.completed",
    occurred_at: new Date(NOW.getTime() - 60_000).toISOString(),
    correlation_id: "corr-1",
    tenant_pseudonym: "tenant_abc123",
    run_id: "run-1",
    deployment_id: "deployment-1",
    orchestrator_version: "ooda-v2",
    policy_version: 1,
    prompt_version: "prompt-v1",
    tool_name: null,
    tool_version: null,
    phase: "finalize",
    duration_ms: 100,
    status: "ok",
    error_code: null,
    input_tokens: 10,
    output_tokens: 5,
    total_tokens: 15,
    cost_microusd: 100,
    evidence_count: 1,
    task_success: true,
    security_signal: null,
    retrieval_count: null,
    budget_reserved_microusd: null,
    budget_actual_microusd: null,
    webhook_lag_ms: null,
    checkpoint_lag_ms: null,
    approval_age_ms: null,
    ...overrides,
  };
}

/** Create N terminal events with a chosen number of failures/successes. */
function terminal_events(
  total: number,
  failures: number,
  successes: number,
  duration_ms = 100,
): CommercialEvent[] {
  return Array.from({ length: total }, (_unused, index) =>
    event({
      correlation_id: `corr-${index}`,
      run_id: `run-${index}`,
      event_name: index < failures ? "run.failed" : "run.completed",
      status: index < failures ? "error" : "ok",
      error_code: index < failures ? "PROVIDER_UNAVAILABLE" : null,
      task_success: index < successes,
      duration_ms,
    }),
  );
}

describe("commercial health metrics", () => {
  it("computes bounded aggregate quality, lag, mismatch, retrieval, evidence, and approval metrics", () => {
    const old = event({
      occurred_at: new Date(NOW.getTime() - 31 * 60_000).toISOString(),
      status: "error",
      event_name: "run.failed",
      duration_ms: 99_999,
    });
    const metrics = compute_health_metrics(
      [
        event({ duration_ms: 100, evidence_count: 2, task_success: true }),
        event({
          event_name: "run.failed",
          status: "error",
          error_code: "PROVIDER_UNAVAILABLE",
          duration_ms: 400,
          evidence_count: 0,
          task_success: false,
        }),
        event({
          event_name: "usage.reconciled",
          run_id: null,
          duration_ms: null,
          task_success: null,
          budget_reserved_microusd: 100,
          budget_actual_microusd: 120,
        }),
        event({
          event_name: "webhook.processed",
          run_id: null,
          duration_ms: null,
          task_success: null,
          webhook_lag_ms: 600,
        }),
        event({
          event_name: "checkpoint.saved",
          duration_ms: null,
          task_success: null,
          checkpoint_lag_ms: 300,
        }),
        event({
          event_name: "retrieval.completed",
          duration_ms: null,
          task_success: null,
          retrieval_count: 0,
        }),
        event({
          event_name: "retrieval.completed",
          duration_ms: null,
          task_success: null,
          retrieval_count: 3,
        }),
        event({
          event_name: "approval.pending",
          duration_ms: null,
          task_success: null,
          approval_age_ms: 10_000,
        }),
        event({
          event_name: "approval.pending",
          duration_ms: null,
          task_success: null,
          approval_age_ms: 20_000,
        }),
        old,
      ],
      CONFIG,
    );

    expect(metrics.error_rate_15m).toEqual({
      total_runs: 2,
      error_runs: 1,
      rate: 0.5,
    });
    expect(metrics.latency_30m).toMatchObject({
      sample_count: 2,
      p50_ms: 100,
      p95_ms: 400,
      p99_ms: 400,
    });
    expect(metrics.latency_30m.histogram).toContainEqual({ le_ms: 500, count: 2 });
    expect(metrics.budget_mismatch_30m).toEqual({
      reconciled_count: 1,
      mismatch_count: 1,
      mismatch_rate: 1,
      absolute_mismatch_microusd: 20,
    });
    expect(metrics.webhook_lag_30m).toEqual({ sample_count: 1, p95_ms: 600, max_ms: 600 });
    expect(metrics.checkpoint_lag_30m).toEqual({ sample_count: 1, p95_ms: 300, max_ms: 300 });
    expect(metrics.retrieval_30m).toEqual({ total: 2, empty: 1, empty_rate: 0.5 });
    expect(metrics.evidence_coverage_30m).toEqual({ eligible_runs: 2, covered_runs: 1, rate: 0.5 });
    expect(metrics.approval_age_30m).toEqual({ pending_count: 2, p95_ms: 20_000, max_ms: 20_000 });
  });

  it.each([
    "cross_tenant_disclosure",
    "unauthorized_commit",
    "approval_bypass",
    "hard_budget_bypass",
  ] as const)("raises an immediate stop signal for %s", (security_signal) => {
    const metrics = compute_health_metrics(
      [event({ event_name: "security.violation", security_signal })],
      CONFIG,
    );

    expect(metrics.stop_signals).toContainEqual(
      expect.objectContaining({
        code: security_signal.toUpperCase(),
        severity: "critical",
        automatic_action: "stop_rollout",
        window_minutes: 0,
      }),
    );
  });

  it("uses strict G5 error-rate, task-success, and latency stop boundaries", () => {
    const error_over = compute_health_metrics(terminal_events(100, 4, 96), CONFIG);
    const error_boundary = compute_health_metrics(terminal_events(100, 3, 97), CONFIG);

    const success_over = compute_health_metrics(terminal_events(100, 0, 74), CONFIG);
    const success_boundary = compute_health_metrics(terminal_events(100, 0, 75), CONFIG);

    const latency_over = compute_health_metrics(
      [
        ...terminal_events(18, 0, 18, 100),
        ...terminal_events(2, 0, 2, 2_001).map((value, index) => ({
          ...value,
          correlation_id: `slow-${index}`,
        })),
      ],
      CONFIG,
    );
    const latency_boundary = compute_health_metrics(
      [
        ...terminal_events(18, 0, 18, 100),
        ...terminal_events(2, 0, 2, 2_000).map((value, index) => ({
          ...value,
          correlation_id: `boundary-${index}`,
        })),
      ],
      CONFIG,
    );

    expect(error_over.stop_signals.map((signal) => signal.code)).toContain("ERROR_RATE_EXCEEDED");
    expect(error_boundary.stop_signals.map((signal) => signal.code)).not.toContain("ERROR_RATE_EXCEEDED");
    expect(success_over.stop_signals.map((signal) => signal.code)).toContain("TASK_SUCCESS_REGRESSION");
    expect(success_boundary.stop_signals.map((signal) => signal.code)).not.toContain("TASK_SUCCESS_REGRESSION");
    expect(latency_over.stop_signals.map((signal) => signal.code)).toContain("LATENCY_SLO_EXCEEDED");
    expect(latency_boundary.stop_signals.map((signal) => signal.code)).not.toContain("LATENCY_SLO_EXCEEDED");
    expect(G5_STOP_THRESHOLDS).toMatchObject({
      error_rate: 0.03,
      error_window_minutes: 15,
      task_success_drop_percentage_points: 5,
      latency_slo_multiplier: 2,
      latency_window_minutes: 30,
    });
  });
});

describe("platform operations data source", () => {
  let server: MongoMemoryServer;
  let client: MongoClient;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = new MongoClient(server.getUri());
    await client.connect();
  });

  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });

  it("projects aggregate metrics and incident metadata without tenant content", async () => {
    const db = client.db("observability");
    await db.collection("ai_commercial_events").insertOne({
      ...event(),
      occurred_at: new Date(NOW.getTime() - 60_000),
      tenantId: "tenant-a-secret-id",
      prompt: "private tenant prompt",
      documentText: "private tenant document",
    });
    await db.collection("ai_incidents").insertOne({
      incident_id: "inc-1",
      signal_code: "PROVIDER_OUTAGE",
      severity: "high",
      status: "investigating",
      started_at: new Date(NOW.getTime() - 120_000),
      updated_at: new Date(NOW.getTime() - 30_000),
      tenantId: "tenant-a-secret-id",
      evidence: "private incident evidence",
    });

    const result = await load_platform_operations_data(db, CONFIG);
    const serialized = JSON.stringify(result);

    expect(result.active_incidents).toContainEqual({
      incident_id: "inc-1",
      signal_code: "PROVIDER_OUTAGE",
      severity: "high",
      status: "investigating",
      started_at: new Date(NOW.getTime() - 120_000).toISOString(),
      updated_at: new Date(NOW.getTime() - 30_000).toISOString(),
    });
    expect(serialized).not.toContain("tenant-a-secret-id");
    expect(serialized).not.toContain("private tenant prompt");
    expect(serialized).not.toContain("private tenant document");
    expect(serialized).not.toContain("private incident evidence");
  });
});
