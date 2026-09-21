import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { appRouter } from "@/server/index";
import type { PlatformOperationsData } from "@/server/services/observability/health-metrics";
import { createCallerFactory, createTRPCContext } from "@/server/trpc";

export const dynamic = "force-dynamic";

const DEFAULT_LATENCY_SLO_MS = 30_000;
const DEFAULT_APPROVED_CANDIDATE_TASK_SUCCESS_RATE = 0.8;

/** Parse one positive integer environment setting without weakening defaults. */
function positive_integer(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Parse one unit-interval environment setting without weakening defaults. */
function unit_rate(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

/** Render a unit rate as a compact percentage. */
function percent(value: number | null): string {
  return value === null ? "No samples" : `${(value * 100).toFixed(1)}%`;
}

/** Render milliseconds without presenting false sub-second precision. */
function duration(value: number | null): string {
  if (value === null) return "No samples";
  if (value < 1_000) return `${value.toLocaleString()} ms`;
  return `${(value / 1_000).toFixed(1)} s`;
}

/** Load Mongo only after the route-level platform authorization succeeds. */
async function load_operations_data(): Promise<PlatformOperationsData> {
  const [{ get_main_client_promise }, { load_platform_operations_data }] =
    await Promise.all([
      import("@rnd-ai/shared-database"),
      import("@/server/services/observability/health-metrics"),
    ]);
  const client = await get_main_client_promise();
  return load_platform_operations_data(client.db(), {
    latency_slo_ms: positive_integer(
      process.env.AI_LATENCY_SLO_MS,
      DEFAULT_LATENCY_SLO_MS,
    ),
    approved_candidate_task_success_rate: unit_rate(
      process.env.AI_APPROVED_CANDIDATE_TASK_SUCCESS_RATE,
      DEFAULT_APPROVED_CANDIDATE_TASK_SUCCESS_RATE,
    ),
  });
}

/** One summary card for the answer-first health row. */
function SummaryCard({
  description,
  title,
  value,
}: {
  readonly description: string;
  readonly title: string;
  readonly value: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-gray-500">{description}</CardContent>
    </Card>
  );
}

/** Aggregate, non-content operations view shared by the authenticated page. */
export function PlatformAiOperationsView({
  data,
}: {
  readonly data: PlatformOperationsData;
}) {
  const { metrics } = data;
  const rollout_stopped = metrics.stop_signals.length > 0;
  const operational_rows = [
    {
      metric: "Usage budget mismatch",
      value: percent(metrics.budget_mismatch_30m.mismatch_rate),
      detail: `${metrics.budget_mismatch_30m.mismatch_count}/${metrics.budget_mismatch_30m.reconciled_count} reconciliations`,
    },
    {
      metric: "Webhook lag p95",
      value: duration(metrics.webhook_lag_30m.p95_ms),
      detail: `${metrics.webhook_lag_30m.sample_count} samples`,
    },
    {
      metric: "Checkpoint lag p95",
      value: duration(metrics.checkpoint_lag_30m.p95_ms),
      detail: `${metrics.checkpoint_lag_30m.sample_count} samples`,
    },
    {
      metric: "Empty retrieval rate",
      value: percent(metrics.retrieval_30m.empty_rate),
      detail: `${metrics.retrieval_30m.empty}/${metrics.retrieval_30m.total} retrievals`,
    },
    {
      metric: "Pending approval age p95",
      value: duration(metrics.approval_age_30m.p95_ms),
      detail: `${metrics.approval_age_30m.pending_count} pending`,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Commercial AI operations</h1>
          <p className="mt-1 text-sm text-gray-500">
            Aggregate platform health only. Tenant content requires a separate, time-bound support grant.
          </p>
        </div>
        <Badge variant={rollout_stopped ? "destructive" : "line"}>
          {rollout_stopped ? "Rollout stopped" : "No automatic stop signal"}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <SummaryCard
          title="Error rate"
          value={percent(metrics.error_rate_15m.rate)}
          description={`${metrics.error_rate_15m.error_runs}/${metrics.error_rate_15m.total_runs} terminal runs · 15 min`}
        />
        <SummaryCard
          title="Latency p95"
          value={duration(metrics.latency_30m.p95_ms)}
          description={`${metrics.latency_30m.sample_count} terminal runs · 30 min`}
        />
        <SummaryCard
          title="Task success"
          value={percent(metrics.task_success_30m.rate)}
          description={`Approved candidate ${percent(metrics.task_success_30m.approved_candidate_rate)} · 30 min`}
        />
        <SummaryCard
          title="Evidence coverage"
          value={percent(metrics.evidence_coverage_30m.rate)}
          description={`${metrics.evidence_coverage_30m.covered_runs}/${metrics.evidence_coverage_30m.eligible_runs} eligible terminal runs`}
        />
        <SummaryCard
          title="Active incidents"
          value={data.active_incidents.length.toLocaleString()}
          description={`${metrics.stop_signals.length} automatic stop signals`}
        />
        <SummaryCard
          title="Latency p99"
          value={duration(metrics.latency_30m.p99_ms)}
          description={`p50 ${duration(metrics.latency_30m.p50_ms)} · 30 min`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Operational diagnostics</CardTitle>
          <CardDescription>Aggregate counters and lag distributions over 30 minutes.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead>Observed</TableHead>
                <TableHead>Sample</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operational_rows.map((row) => (
                <TableRow key={row.metric}>
                  <TableCell className="font-medium">{row.metric}</TableCell>
                  <TableCell>{row.value}</TableCell>
                  <TableCell className="text-gray-500">{row.detail}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active incidents and stop signals</CardTitle>
          <CardDescription>Content-free incident metadata; newest recorded incidents first.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.active_incidents.length === 0 ? (
            <p className="text-sm text-gray-500">No active incidents.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Signal</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.active_incidents.map((incident) => (
                  <TableRow key={incident.incident_id}>
                    <TableCell className="font-mono text-xs">{incident.signal_code}</TableCell>
                    <TableCell>
                      <Badge variant={incident.severity === "critical" ? "destructive" : "pending"}>
                        {incident.severity}
                      </Badge>
                    </TableCell>
                    <TableCell>{incident.status}</TableCell>
                    <TableCell>
                      <time dateTime={incident.started_at}>{new Date(incident.started_at).toLocaleString()}</time>
                    </TableCell>
                    <TableCell>
                      <time dateTime={incident.updated_at}>{new Date(incident.updated_at).toLocaleString()}</time>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-gray-500">
        Fresh at <time dateTime={data.source.generated_at}>{new Date(data.source.generated_at).toLocaleString()}</time>
        {" · "}window starts <time dateTime={data.source.window_started_at}>{new Date(data.source.window_started_at).toLocaleString()}</time>
        {" · sources "}{data.source.event_collection}, {data.source.incident_collection}
      </p>
    </div>
  );
}

/** Platform-admin operations page with authorization before database access. */
export default async function PlatformAiOperationsPage() {
  const caller = createCallerFactory(appRouter)(await createTRPCContext());
  try {
    await caller.platformAiSettings.getConstraints();
  } catch {
    return (
      <div className="space-y-2">
        <h1 className="text-base font-semibold">Commercial AI operations</h1>
        <p className="text-sm text-gray-500">A platform role is required.</p>
      </div>
    );
  }

  let data: Awaited<ReturnType<typeof load_operations_data>>;
  try {
    data = await load_operations_data();
  } catch {
    return (
      <div className="space-y-2">
        <h1 className="text-base font-semibold">Commercial AI operations</h1>
        <Badge variant="destructive">Telemetry unavailable</Badge>
        <p className="text-sm text-gray-500">
          Aggregate health could not be loaded. Treat monitoring as unavailable and pause rollout changes.
        </p>
      </div>
    );
  }
  return <PlatformAiOperationsView data={data} />;
}
