/**
 * Content-free structured commercial AI events (G5.6).
 *
 * Construction is allowlist-only and replaces the raw tenant identifier with
 * a stable pseudonym. Serialization and export are impossible without first
 * passing through the fail-closed redactor.
 */

import { createHmac } from "node:crypto";
import type { Db } from "mongodb";

import { redact_event } from "./redaction";

/** Event families emitted by commercial AI platform boundaries. */
export type CommercialEventName =
  | "auth.completed"
  | "auth.failed"
  | "tenant.changed"
  | "run.accepted"
  | "run.completed"
  | "run.failed"
  | "node.completed"
  | "node.failed"
  | "tool.completed"
  | "tool.failed"
  | "provider.completed"
  | "provider.failed"
  | "usage.reconciled"
  | "approval.pending"
  | "approval.decided"
  | "webhook.processed"
  | "webhook.failed"
  | "checkpoint.saved"
  | "retrieval.completed"
  | "migration.completed"
  | "migration.failed"
  | "security.violation";

/** Security conditions that stop G5 rollout immediately. */
export type CommercialSecuritySignal =
  | "cross_tenant_disclosure"
  | "unauthorized_commit"
  | "approval_bypass"
  | "hard_budget_bypass";

/** A complete content-free event safe for metric aggregation. */
export interface CommercialEvent {
  readonly schema_version: "1";
  readonly event_name: CommercialEventName;
  readonly occurred_at: string;
  readonly correlation_id: string;
  readonly tenant_pseudonym: string;
  readonly run_id: string | null;
  readonly deployment_id: string | null;
  readonly orchestrator_version: string | null;
  readonly policy_version: number | null;
  readonly prompt_version: string | null;
  readonly tool_name: string | null;
  readonly tool_version: string | null;
  readonly phase: string | null;
  readonly duration_ms: number | null;
  readonly status: "ok" | "error" | "pending";
  readonly error_code: string | null;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly total_tokens: number;
  readonly cost_microusd: number;
  readonly evidence_count: number | null;
  readonly task_success: boolean | null;
  readonly security_signal: CommercialSecuritySignal | null;
  readonly retrieval_count: number | null;
  readonly budget_reserved_microusd: number | null;
  readonly budget_actual_microusd: number | null;
  readonly webhook_lag_ms: number | null;
  readonly checkpoint_lag_ms: number | null;
  readonly approval_age_ms: number | null;
}

/** Allowlisted inputs accepted from event-producing boundaries. */
export interface CommercialEventInput {
  readonly event_name: CommercialEventName;
  readonly tenant_id: string;
  readonly correlation_id: string;
  readonly run_id?: string | null;
  readonly deployment_id?: string | null;
  readonly orchestrator_version?: string | null;
  readonly policy_version?: number | null;
  readonly prompt_version?: string | null;
  readonly tool_name?: string | null;
  readonly tool_version?: string | null;
  readonly phase?: string | null;
  readonly duration_ms?: number | null;
  readonly status: "ok" | "error" | "pending";
  readonly error_code?: string | null;
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cost_microusd?: number;
  readonly evidence_count?: number | null;
  readonly task_success?: boolean | null;
  readonly security_signal?: CommercialSecuritySignal | null;
  readonly retrieval_count?: number | null;
  readonly budget_reserved_microusd?: number | null;
  readonly budget_actual_microusd?: number | null;
  readonly webhook_lag_ms?: number | null;
  readonly checkpoint_lag_ms?: number | null;
  readonly approval_age_ms?: number | null;
}

/** Tenant pseudonym function; raw tenant IDs never enter an event. */
export type TenantPseudonymizer = (tenant_id: string) => string;

/** Injectable construction dependencies. */
export interface CommercialEventSources {
  readonly pseudonymizer: TenantPseudonymizer;
  readonly now?: () => Date;
}

/** Export boundary that receives only serialized, redacted JSON. */
export interface CommercialEventExporter {
  write(serialized_redacted_event: string): Promise<void>;
}

/** Safe validation error for malformed event dimensions. */
export class CommercialEventInvalidError extends Error {
  readonly code = "COMMERCIAL_EVENT_INVALID";

  /** Create a safe event validation failure. */
  constructor() {
    super("Commercial event dimensions are invalid.");
    this.name = "CommercialEventInvalidError";
  }
}

/** Require a finite, non-negative, safe integer metric. */
function count(value: number | undefined, fallback = 0): number {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate < 0) {
    throw new CommercialEventInvalidError();
  }
  return candidate;
}

/** Require an optional finite, non-negative, safe integer metric. */
function optional_count(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : count(value);
}

/** Normalize an optional dimension to a non-empty string or null. */
function dimension(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) {
    throw new CommercialEventInvalidError();
  }
  return normalized;
}

/**
 * Create a stable HMAC tenant pseudonymizer.
 *
 * @param secret - Deployment secret used only for pseudonym generation.
 * @returns Deterministic tenant pseudonym function.
 */
export function create_hmac_tenant_pseudonymizer(
  secret: string,
): TenantPseudonymizer {
  if (secret.length < 24) throw new CommercialEventInvalidError();
  return (tenant_id) => {
    if (!tenant_id.trim()) throw new CommercialEventInvalidError();
    const digest = createHmac("sha256", secret)
      .update(tenant_id)
      .digest("hex")
      .slice(0, 24);
    return `tenant_${digest}`;
  };
}

/**
 * Construct one content-free commercial event from allowlisted dimensions.
 *
 * @param input - Typed event dimensions; arbitrary extra fields are ignored.
 * @param sources - Tenant pseudonymizer and injectable clock.
 * @returns Frozen event containing no raw tenant ID or content fields.
 */
export function create_commercial_event(
  input: CommercialEventInput,
  sources: CommercialEventSources,
): CommercialEvent {
  if (!input.correlation_id.trim() || !input.tenant_id.trim()) {
    throw new CommercialEventInvalidError();
  }
  const input_tokens = count(input.input_tokens);
  const output_tokens = count(input.output_tokens);
  const occurred_at = (sources.now?.() ?? new Date()).toISOString();
  const tenant_pseudonym = sources.pseudonymizer(input.tenant_id);
  if (!tenant_pseudonym || tenant_pseudonym === input.tenant_id) {
    throw new CommercialEventInvalidError();
  }
  return Object.freeze({
    schema_version: "1" as const,
    event_name: input.event_name,
    occurred_at,
    correlation_id: input.correlation_id,
    tenant_pseudonym,
    run_id: dimension(input.run_id),
    deployment_id: dimension(input.deployment_id),
    orchestrator_version: dimension(input.orchestrator_version),
    policy_version: optional_count(input.policy_version),
    prompt_version: dimension(input.prompt_version),
    tool_name: dimension(input.tool_name),
    tool_version: dimension(input.tool_version),
    phase: dimension(input.phase),
    duration_ms: optional_count(input.duration_ms),
    status: input.status,
    error_code: dimension(input.error_code),
    input_tokens,
    output_tokens,
    total_tokens: input_tokens + output_tokens,
    cost_microusd: count(input.cost_microusd),
    evidence_count: optional_count(input.evidence_count),
    task_success: input.task_success ?? null,
    security_signal: input.security_signal ?? null,
    retrieval_count: optional_count(input.retrieval_count),
    budget_reserved_microusd: optional_count(input.budget_reserved_microusd),
    budget_actual_microusd: optional_count(input.budget_actual_microusd),
    webhook_lag_ms: optional_count(input.webhook_lag_ms),
    checkpoint_lag_ms: optional_count(input.checkpoint_lag_ms),
    approval_age_ms: optional_count(input.approval_age_ms),
  });
}

/**
 * Redact and serialize an event. The unredacted object is never serialized.
 *
 * @param event - Event or event-like value from an internal boundary.
 * @returns JSON line containing only redacted data and redaction metadata.
 */
export function serialize_commercial_event(event: CommercialEvent): string {
  try {
    return JSON.stringify(redact_event(event));
  } catch {
    return JSON.stringify({
      event_name: "REDACTION_FAILURE",
      redaction_metadata: {
        status: "failure",
        replacement: "[REDACTED]",
        failures: [{ code: "REDACTION_FAILURE", path: "$" }],
      },
    });
  }
}

/**
 * Redact and export one event through a serialized-only port.
 *
 * @param event - Internal commercial event.
 * @param exporter - Destination accepting only already-redacted JSON.
 */
export async function export_commercial_event(
  event: CommercialEvent,
  exporter: CommercialEventExporter,
): Promise<void> {
  await exporter.write(serialize_commercial_event(event));
}

/**
 * Redact and persist an event to the aggregate commercial telemetry source.
 *
 * The Mongo collection never receives the original event object. Parsing the
 * already-redacted JSON creates a separate document before insertion.
 *
 * @param event - Internal commercial event.
 * @param db - Connected application database.
 */
export async function export_commercial_event_to_mongo(
  event: CommercialEvent,
  db: Db,
): Promise<void> {
  const redacted: unknown = JSON.parse(serialize_commercial_event(event));
  if (
    redacted === null ||
    typeof redacted !== "object" ||
    Array.isArray(redacted)
  ) {
    throw new CommercialEventInvalidError();
  }
  await db.collection("ai_commercial_events").insertOne({
    ...(redacted as Record<string, unknown>),
    ingested_at: new Date(),
  });
}
