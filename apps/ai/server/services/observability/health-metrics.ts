/**
 * Aggregate commercial AI health metrics and G5 stop signals (G5.6).
 *
 * Metrics consume only the content-free CommercialEvent contract. The Mongo
 * reader uses an explicit projection so tenant IDs, prompts, documents, raw
 * payloads, and incident evidence are never fetched into the operations view.
 */

import type { Db, Document } from "mongodb";

import type {
  CommercialEvent,
  CommercialEventName,
  CommercialSecuritySignal,
} from "./commercial-events";

const MINUTE_MS = 60_000;
const THIRTY_MINUTES_MS = 30 * MINUTE_MS;

/** Immutable automatic stop thresholds from G5 Task 5. */
export const G5_STOP_THRESHOLDS = Object.freeze({
  error_rate: 0.03,
  error_window_minutes: 15,
  task_success_drop_percentage_points: 5,
  task_success_window_minutes: 30,
  latency_slo_multiplier: 2,
  latency_window_minutes: 30,
});

/** Histogram buckets shared by the operations page and telemetry exporters. */
export const LATENCY_HISTOGRAM_BUCKETS_MS = Object.freeze([
  100,
  250,
  500,
  1_000,
  2_000,
  5_000,
  10_000,
  30_000,
  90_000,
]);

/** Inputs required to compare live health with approved rollout targets. */
export interface HealthMetricConfig {
  readonly now?: () => Date;
  readonly latency_slo_ms: number;
  readonly approved_candidate_task_success_rate: number;
}

/** One automatic rollout stop signal. */
export interface G5StopSignal {
  readonly code:
    | "CROSS_TENANT_DISCLOSURE"
    | "UNAUTHORIZED_COMMIT"
    | "APPROVAL_BYPASS"
    | "HARD_BUDGET_BYPASS"
    | "ERROR_RATE_EXCEEDED"
    | "TASK_SUCCESS_REGRESSION"
    | "LATENCY_SLO_EXCEEDED";
  readonly severity: "critical" | "high";
  readonly automatic_action: "stop_rollout";
  readonly observed: number;
  readonly threshold: number;
  readonly window_minutes: number;
}

/** Aggregate health snapshot exposed to platform operations. */
export interface CommercialHealthMetrics {
  readonly generated_at: string;
  readonly error_rate_15m: {
    readonly total_runs: number;
    readonly error_runs: number;
    readonly rate: number;
  };
  readonly latency_30m: {
    readonly sample_count: number;
    readonly p50_ms: number | null;
    readonly p95_ms: number | null;
    readonly p99_ms: number | null;
    readonly histogram: ReadonlyArray<{
      readonly le_ms: number;
      readonly count: number;
    }>;
  };
  readonly task_success_30m: {
    readonly total_runs: number;
    readonly successful_runs: number;
    readonly rate: number | null;
    readonly approved_candidate_rate: number;
    readonly drop_percentage_points: number | null;
  };
  readonly budget_mismatch_30m: {
    readonly reconciled_count: number;
    readonly mismatch_count: number;
    readonly mismatch_rate: number;
    readonly absolute_mismatch_microusd: number;
  };
  readonly webhook_lag_30m: LagMetric;
  readonly checkpoint_lag_30m: LagMetric;
  readonly retrieval_30m: {
    readonly total: number;
    readonly empty: number;
    readonly empty_rate: number;
  };
  readonly evidence_coverage_30m: {
    readonly eligible_runs: number;
    readonly covered_runs: number;
    readonly rate: number;
  };
  readonly approval_age_30m: {
    readonly pending_count: number;
    readonly p95_ms: number | null;
    readonly max_ms: number | null;
  };
  readonly stop_signals: readonly G5StopSignal[];
}

/** Distribution summary for webhook/checkpoint lag. */
export interface LagMetric {
  readonly sample_count: number;
  readonly p95_ms: number | null;
  readonly max_ms: number | null;
}

/** Non-content incident metadata shown on the platform page. */
export interface PlatformIncidentSummary {
  readonly incident_id: string;
  readonly signal_code: string;
  readonly severity: "critical" | "high" | "medium" | "low";
  readonly status: "open" | "investigating" | "mitigating";
  readonly started_at: string;
  readonly updated_at: string;
}

/** Complete aggregate/non-content operations page model. */
export interface PlatformOperationsData {
  readonly metrics: CommercialHealthMetrics;
  readonly active_incidents: readonly PlatformIncidentSummary[];
  readonly source: {
    readonly event_collection: "ai_commercial_events";
    readonly incident_collection: "ai_incidents";
    readonly window_started_at: string;
    readonly generated_at: string;
  };
}

/** Return a ratio, using zero for an empty denominator. */
function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/** Compute a nearest-rank percentile over non-negative values. */
function percentile(values: readonly number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[index] ?? null;
}

/** Parse an event timestamp and reject invalid/future values. */
function event_time(event: CommercialEvent, now_ms: number): number | null {
  const value = new Date(event.occurred_at).getTime();
  return Number.isFinite(value) && value <= now_ms ? value : null;
}

/** Select events inside a trailing window. */
function in_window(
  events: readonly CommercialEvent[],
  now_ms: number,
  window_ms: number,
): CommercialEvent[] {
  const start = now_ms - window_ms;
  return events.filter((item) => {
    const timestamp = event_time(item, now_ms);
    return timestamp !== null && timestamp >= start;
  });
}

/** Identify terminal run events used as reliability denominators. */
function terminal_run(event: CommercialEvent): boolean {
  return event.event_name === "run.completed" || event.event_name === "run.failed";
}

/** Summarize a lag/age distribution. */
function lag_metric(values: readonly number[]): LagMetric {
  return {
    sample_count: values.length,
    p95_ms: percentile(values, 0.95),
    max_ms: values.length > 0 ? Math.max(...values) : null,
  };
}

/** Build one stop signal with stable action metadata. */
function stop_signal(
  code: G5StopSignal["code"],
  severity: G5StopSignal["severity"],
  observed: number,
  threshold: number,
  window_minutes: number,
): G5StopSignal {
  return Object.freeze({
    code,
    severity,
    automatic_action: "stop_rollout" as const,
    observed,
    threshold,
    window_minutes,
  });
}

/** Map an immediate security event to its stable stop code. */
function security_stop_code(
  signal: CommercialSecuritySignal,
): G5StopSignal["code"] {
  return signal.toUpperCase() as G5StopSignal["code"];
}

/**
 * Compute aggregate operational health and automatic G5 stop signals.
 *
 * @param events - Content-free commercial events.
 * @param config - Current clock, latency SLO, and approved success baseline.
 * @returns Immutable-style aggregate metrics for platform operations.
 */
export function compute_health_metrics(
  events: readonly CommercialEvent[],
  config: HealthMetricConfig,
): CommercialHealthMetrics {
  if (
    !Number.isSafeInteger(config.latency_slo_ms) ||
    config.latency_slo_ms <= 0 ||
    !Number.isFinite(config.approved_candidate_task_success_rate) ||
    config.approved_candidate_task_success_rate < 0 ||
    config.approved_candidate_task_success_rate > 1
  ) {
    throw new Error("Commercial health metric configuration is invalid.");
  }
  const now = config.now?.() ?? new Date();
  const now_ms = now.getTime();
  const events_15m = in_window(
    events,
    now_ms,
    G5_STOP_THRESHOLDS.error_window_minutes * MINUTE_MS,
  );
  const events_30m = in_window(events, now_ms, THIRTY_MINUTES_MS);
  const terminal_15m = events_15m.filter(terminal_run);
  const terminal_30m = events_30m.filter(terminal_run);

  const error_runs = terminal_15m.filter(
    (item) => item.status === "error" || item.event_name === "run.failed",
  ).length;
  const error_rate = ratio(error_runs, terminal_15m.length);

  const durations = terminal_30m
    .map((item) => item.duration_ms)
    .filter((value): value is number => value !== null);
  const p95_latency = percentile(durations, 0.95);

  const task_events = terminal_30m.filter(
    (item) => typeof item.task_success === "boolean",
  );
  const successful_runs = task_events.filter((item) => item.task_success).length;
  const task_success_rate =
    task_events.length === 0 ? null : successful_runs / task_events.length;
  const task_success_drop =
    task_success_rate === null
      ? null
      : (config.approved_candidate_task_success_rate - task_success_rate) * 100;

  const reconciliations = events_30m.filter(
    (item) =>
      item.event_name === "usage.reconciled" &&
      item.budget_reserved_microusd !== null &&
      item.budget_actual_microusd !== null,
  );
  const mismatches = reconciliations.filter(
    (item) => item.budget_reserved_microusd !== item.budget_actual_microusd,
  );
  const absolute_mismatch = reconciliations.reduce(
    (total, item) =>
      total +
      Math.abs(
        (item.budget_reserved_microusd ?? 0) -
          (item.budget_actual_microusd ?? 0),
      ),
    0,
  );

  const webhook_lags = events_30m
    .map((item) => item.webhook_lag_ms)
    .filter((value): value is number => value !== null);
  const checkpoint_lags = events_30m
    .map((item) => item.checkpoint_lag_ms)
    .filter((value): value is number => value !== null);
  const retrievals = events_30m.filter(
    (item) =>
      item.event_name === "retrieval.completed" && item.retrieval_count !== null,
  );
  const empty_retrievals = retrievals.filter(
    (item) => item.retrieval_count === 0,
  ).length;
  const evidence_runs = terminal_30m.filter(
    (item) => item.evidence_count !== null,
  );
  const covered_runs = evidence_runs.filter(
    (item) => (item.evidence_count ?? 0) > 0,
  ).length;
  const approval_ages = events_30m
    .filter((item) => item.event_name === "approval.pending")
    .map((item) => item.approval_age_ms)
    .filter((value): value is number => value !== null);

  const stop_signals: G5StopSignal[] = [];
  for (const signal of new Set(
    events_30m
      .map((item) => item.security_signal)
      .filter((value): value is CommercialSecuritySignal => value !== null),
  )) {
    stop_signals.push(
      stop_signal(security_stop_code(signal), "critical", 1, 0, 0),
    );
  }
  if (
    terminal_15m.length > 0 &&
    error_rate > G5_STOP_THRESHOLDS.error_rate
  ) {
    stop_signals.push(
      stop_signal(
        "ERROR_RATE_EXCEEDED",
        "high",
        error_rate,
        G5_STOP_THRESHOLDS.error_rate,
        G5_STOP_THRESHOLDS.error_window_minutes,
      ),
    );
  }
  if (
    task_success_drop !== null &&
    task_success_drop >
      G5_STOP_THRESHOLDS.task_success_drop_percentage_points + Number.EPSILON * 100
  ) {
    stop_signals.push(
      stop_signal(
        "TASK_SUCCESS_REGRESSION",
        "high",
        task_success_drop,
        G5_STOP_THRESHOLDS.task_success_drop_percentage_points,
        G5_STOP_THRESHOLDS.task_success_window_minutes,
      ),
    );
  }
  const latency_threshold =
    config.latency_slo_ms * G5_STOP_THRESHOLDS.latency_slo_multiplier;
  if (p95_latency !== null && p95_latency > latency_threshold) {
    stop_signals.push(
      stop_signal(
        "LATENCY_SLO_EXCEEDED",
        "high",
        p95_latency,
        latency_threshold,
        G5_STOP_THRESHOLDS.latency_window_minutes,
      ),
    );
  }

  return {
    generated_at: now.toISOString(),
    error_rate_15m: {
      total_runs: terminal_15m.length,
      error_runs,
      rate: error_rate,
    },
    latency_30m: {
      sample_count: durations.length,
      p50_ms: percentile(durations, 0.5),
      p95_ms: p95_latency,
      p99_ms: percentile(durations, 0.99),
      histogram: LATENCY_HISTOGRAM_BUCKETS_MS.map((le_ms) => ({
        le_ms,
        count: durations.filter((duration) => duration <= le_ms).length,
      })),
    },
    task_success_30m: {
      total_runs: task_events.length,
      successful_runs,
      rate: task_success_rate,
      approved_candidate_rate: config.approved_candidate_task_success_rate,
      drop_percentage_points: task_success_drop,
    },
    budget_mismatch_30m: {
      reconciled_count: reconciliations.length,
      mismatch_count: mismatches.length,
      mismatch_rate: ratio(mismatches.length, reconciliations.length),
      absolute_mismatch_microusd: absolute_mismatch,
    },
    webhook_lag_30m: lag_metric(webhook_lags),
    checkpoint_lag_30m: lag_metric(checkpoint_lags),
    retrieval_30m: {
      total: retrievals.length,
      empty: empty_retrievals,
      empty_rate: ratio(empty_retrievals, retrievals.length),
    },
    evidence_coverage_30m: {
      eligible_runs: evidence_runs.length,
      covered_runs,
      rate: ratio(covered_runs, evidence_runs.length),
    },
    approval_age_30m: {
      pending_count: approval_ages.length,
      p95_ms: percentile(approval_ages, 0.95),
      max_ms: approval_ages.length > 0 ? Math.max(...approval_ages) : null,
    },
    stop_signals: Object.freeze(stop_signals),
  };
}

const EVENT_PROJECTION = Object.freeze({
  _id: 0,
  schema_version: 1,
  event_name: 1,
  occurred_at: 1,
  correlation_id: 1,
  tenant_pseudonym: 1,
  run_id: 1,
  deployment_id: 1,
  orchestrator_version: 1,
  policy_version: 1,
  prompt_version: 1,
  tool_name: 1,
  tool_version: 1,
  phase: 1,
  duration_ms: 1,
  status: 1,
  error_code: 1,
  input_tokens: 1,
  output_tokens: 1,
  total_tokens: 1,
  cost_microusd: 1,
  evidence_count: 1,
  task_success: 1,
  security_signal: 1,
  retrieval_count: 1,
  budget_reserved_microusd: 1,
  budget_actual_microusd: 1,
  webhook_lag_ms: 1,
  checkpoint_lag_ms: 1,
  approval_age_ms: 1,
});

/** Normalize a projected Mongo event into the aggregation contract. */
function projected_event(document: Document): CommercialEvent | null {
  const occurred_at =
    document.occurred_at instanceof Date
      ? document.occurred_at.toISOString()
      : typeof document.occurred_at === "string"
        ? document.occurred_at
        : null;
  if (
    !occurred_at ||
    typeof document.event_name !== "string" ||
    typeof document.correlation_id !== "string" ||
    typeof document.tenant_pseudonym !== "string"
  ) {
    return null;
  }
  const numeric = (value: unknown, fallback: number | null = null) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : fallback;
  const string_or_null = (value: unknown) =>
    typeof value === "string" ? value : null;
  return {
    schema_version: "1",
    event_name: document.event_name as CommercialEventName,
    occurred_at,
    correlation_id: document.correlation_id,
    tenant_pseudonym: document.tenant_pseudonym,
    run_id: string_or_null(document.run_id),
    deployment_id: string_or_null(document.deployment_id),
    orchestrator_version: string_or_null(document.orchestrator_version),
    policy_version: numeric(document.policy_version),
    prompt_version: string_or_null(document.prompt_version),
    tool_name: string_or_null(document.tool_name),
    tool_version: string_or_null(document.tool_version),
    phase: string_or_null(document.phase),
    duration_ms: numeric(document.duration_ms),
    status:
      document.status === "error" || document.status === "pending"
        ? document.status
        : "ok",
    error_code: string_or_null(document.error_code),
    input_tokens: numeric(document.input_tokens, 0) ?? 0,
    output_tokens: numeric(document.output_tokens, 0) ?? 0,
    total_tokens: numeric(document.total_tokens, 0) ?? 0,
    cost_microusd: numeric(document.cost_microusd, 0) ?? 0,
    evidence_count: numeric(document.evidence_count),
    task_success:
      typeof document.task_success === "boolean" ? document.task_success : null,
    security_signal: string_or_null(
      document.security_signal,
    ) as CommercialSecuritySignal | null,
    retrieval_count: numeric(document.retrieval_count),
    budget_reserved_microusd: numeric(document.budget_reserved_microusd),
    budget_actual_microusd: numeric(document.budget_actual_microusd),
    webhook_lag_ms: numeric(document.webhook_lag_ms),
    checkpoint_lag_ms: numeric(document.checkpoint_lag_ms),
    approval_age_ms: numeric(document.approval_age_ms),
  };
}

/** Normalize active incident metadata without reading evidence or tenant fields. */
function projected_incident(document: Document): PlatformIncidentSummary | null {
  const started_at =
    document.started_at instanceof Date ? document.started_at.toISOString() : null;
  const updated_at =
    document.updated_at instanceof Date ? document.updated_at.toISOString() : null;
  if (
    typeof document.incident_id !== "string" ||
    typeof document.signal_code !== "string" ||
    !started_at ||
    !updated_at
  ) {
    return null;
  }
  const severity = new Set(["critical", "high", "medium", "low"]).has(
    document.severity,
  )
    ? (document.severity as PlatformIncidentSummary["severity"])
    : "high";
  const status = new Set(["open", "investigating", "mitigating"]).has(
    document.status,
  )
    ? (document.status as PlatformIncidentSummary["status"])
    : "open";
  return {
    incident_id: document.incident_id,
    signal_code: document.signal_code,
    severity,
    status,
    started_at,
    updated_at,
  };
}

/**
 * Load the aggregate, content-free platform operations model from MongoDB.
 *
 * @param db - Connected application database.
 * @param config - Health thresholds and injectable clock.
 * @returns Metrics and active incident metadata with no tenant content access.
 */
export async function load_platform_operations_data(
  db: Db,
  config: HealthMetricConfig,
): Promise<PlatformOperationsData> {
  const now = config.now?.() ?? new Date();
  const window_start = new Date(now.getTime() - THIRTY_MINUTES_MS);
  const [event_documents, incident_documents] = await Promise.all([
    db
      .collection("ai_commercial_events")
      .find(
        {
          $or: [
            { occurred_at: { $gte: window_start, $lte: now } },
            {
              occurred_at: {
                $gte: window_start.toISOString(),
                $lte: now.toISOString(),
              },
            },
          ],
        },
        { projection: EVENT_PROJECTION },
      )
      .limit(50_000)
      .toArray(),
    db
      .collection("ai_incidents")
      .find(
        { status: { $in: ["open", "investigating", "mitigating"] } },
        {
          projection: {
            _id: 0,
            incident_id: 1,
            signal_code: 1,
            severity: 1,
            status: 1,
            started_at: 1,
            updated_at: 1,
          },
        },
      )
      .sort({ started_at: -1 })
      .limit(100)
      .toArray(),
  ]);
  const events = event_documents
    .map(projected_event)
    .filter((value): value is CommercialEvent => value !== null);
  const metrics = compute_health_metrics(events, { ...config, now: () => now });
  const recorded_incidents = incident_documents
    .map(projected_incident)
    .filter((value): value is PlatformIncidentSummary => value !== null);
  const automatic_incidents: PlatformIncidentSummary[] = metrics.stop_signals.map(
    (signal) => ({
      incident_id: `automatic:${signal.code}`,
      signal_code: signal.code,
      severity: signal.severity,
      status: "open",
      started_at: metrics.generated_at,
      updated_at: metrics.generated_at,
    }),
  );
  return {
    metrics,
    active_incidents: [...automatic_incidents, ...recorded_incidents],
    source: {
      event_collection: "ai_commercial_events",
      incident_collection: "ai_incidents",
      window_started_at: window_start.toISOString(),
      generated_at: metrics.generated_at,
    },
  };
}
