/** Durable ports used by the governed control-plane ToolExecutor. */

import { ObjectId, type Db } from "mongodb";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";

import type {
  ApprovalServicePort,
  AuditLogPort,
  IdempotencyStorePort,
  ToolAuditEvent,
  ToolUsageEntry,
  UsageServicePort,
} from "../services/ai-control/tool-executor";
import { create_audit_log_repository } from "./audit-log-repository";

function identifier_values(value: string): Array<string | ObjectId> {
  return ObjectId.isValid(value) ? [value, new ObjectId(value)] : [value];
}

/** Complete persistence surface required by one runtime-bound ToolExecutor. */
export interface AIToolRuntimePorts {
  readonly usage_service: UsageServicePort;
  readonly audit_log: AuditLogPort;
  readonly approval_service: ApprovalServicePort;
  readonly idempotency_store: IdempotencyStorePort;
}

/** Create tenant-bound durable tool usage, audit, approval, and replay ports. */
export function create_ai_tool_runtime_ports(
  db: Db,
  tenant_context: TenantExecutionContext,
): AIToolRuntimePorts {
  const usage_events = db.collection("ai_tool_usage_events");
  const results = db.collection("ai_tool_results");
  const approvals = db.collection("ai_approvals");
  const audit = create_audit_log_repository(db);

  return {
    usage_service: {
      async record_tool_usage(entry: ToolUsageEntry) {
        if (
          entry.tenant_id !== tenant_context.tenant_id ||
          entry.actor_profile_id !== tenant_context.actor_profile_id
        ) {
          throw new Error("Tool usage scope is inconsistent.");
        }
        await usage_events.updateOne(
          {
            tenantId: entry.tenant_id,
            idempotencyKey: entry.idempotency_key,
          },
          {
            $setOnInsert: {
              tenantId: entry.tenant_id,
              actorProfileId: entry.actor_profile_id,
              runId: entry.run_id,
              toolName: entry.tool_name,
              toolVersion: entry.tool_version,
              idempotencyKey: entry.idempotency_key,
              toolCalls: entry.tool_calls,
              durationMs: entry.duration_ms,
              outcome: entry.outcome,
              occurredAt: new Date(entry.occurred_at),
              createdAt: new Date(),
            },
          },
          { upsert: true },
        );
      },
    },

    audit_log: {
      async record_tool_audit_event(event: ToolAuditEvent) {
        if (
          event.tenant_id !== tenant_context.tenant_id ||
          event.actor_profile_id !== tenant_context.actor_profile_id
        ) {
          throw new Error("Tool audit scope is inconsistent.");
        }
        await audit.append_audit_event(tenant_context, {
          action: `ai.tool.${event.outcome}`,
          resource_type: "ai_tool",
          resource_id: event.tool_name,
          metadata: {
            run_id: event.run_id,
            step_id: event.step_id,
            side_effect: event.side_effect,
            idempotency_key: event.idempotency_key,
            arguments_hash: event.arguments_hash,
            error_code: event.error_code,
            duration_ms: event.duration_ms,
            occurred_at: event.occurred_at,
          },
        });
      },
    },

    approval_service: {
      async has_manager_approval(query) {
        if (query.tenant_id !== tenant_context.tenant_id) return false;
        const checkpoint_id = `${query.run_id}:approval:${query.tool_name}:${query.arguments_hash}`;
        const approval = await approvals.findOne({
          tenantId: { $in: identifier_values(query.tenant_id) },
          runId: { $in: identifier_values(query.run_id) },
          checkpointId: checkpoint_id,
          status: "approved",
        });
        return approval !== null;
      },
    },

    idempotency_store: {
      async get(key) {
        const result = await results.findOne({
          tenantId: tenant_context.tenant_id,
          idempotencyKey: key,
          status: "completed",
        });
        return result?.output;
      },
      async put(key, output) {
        await results.updateOne(
          { tenantId: tenant_context.tenant_id, idempotencyKey: key },
          {
            $setOnInsert: {
              tenantId: tenant_context.tenant_id,
              actorProfileId: tenant_context.actor_profile_id,
              idempotencyKey: key,
              status: "completed",
              output,
              completedAt: new Date(),
              createdAt: new Date(),
            },
          },
          { upsert: true },
        );
      },
    },
  };
}
