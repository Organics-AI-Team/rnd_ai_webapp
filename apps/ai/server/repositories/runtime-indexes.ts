import type { Db } from "mongodb";

const initialized = new WeakMap<Db, Promise<void>>();

export function ensure_runtime_indexes(db: Db): Promise<void> {
  const existing = initialized.get(db);
  if (existing) return existing;
  const pending = Promise.all([
    db.collection("chat_messages").createIndex(
      { tenantId: 1, runId: 1, role: 1 },
      { unique: true, name: "uniq_chat_message_tenant_run_role", partialFilterExpression: { runId: { $type: "string" }, role: "assistant" } },
    ),
    db.collection("formulas").createIndex(
      { tenantId: 1, formulaCode: 1 },
      { unique: true, name: "uniq_formula_tenant_code", partialFilterExpression: { formulaCode: { $type: "string" } } },
    ),
    db.collection("formula_comments").createIndex(
      { tenantId: 1, formulaId: 1, idempotencyKey: 1 },
      {
        unique: true,
        name: "uniq_formula_comment_idempotency",
        partialFilterExpression: { idempotencyKey: { $type: "string" } },
      },
    ),
    db.collection("formula_version_logs").createIndex(
      { tenantId: 1, formulaId: 1, action: 1, idempotencyKey: 1 },
      {
        unique: true,
        name: "uniq_formula_version_log_idempotency",
        partialFilterExpression: { idempotencyKey: { $type: "string" } },
      },
    ),
    db.collection("products").createIndex(
      { tenantId: 1, productCode: 1 },
      { unique: true, name: "uniq_product_tenant_code", partialFilterExpression: { productCode: { $type: "string" } } },
    ),
    db.collection("material_index_outbox").createIndex(
      { tenantId: 1, productId: 1, operation: 1 },
      { unique: true, name: "uniq_material_index_operation" },
    ),
    db.collection("material_index_outbox").createIndex(
      { status: 1, nextAttemptAt: 1, lockedUntil: 1 },
      { name: "material_index_claim_queue" },
    ),
    db.collection("user_logs").createIndex(
      { organizationId: 1, createdAt: -1 },
      { name: "user_logs_tenant_created_at" },
    ),
    db.collection("tenant_audit_events").createIndex(
      { tenantId: 1, idempotencyKey: 1 },
      {
        unique: true,
        name: "uniq_tenant_audit_idempotency",
        partialFilterExpression: { idempotencyKey: { $type: "string" } },
      },
    ),
    db.collection("credit_transactions").createIndex(
      { organizationId: 1, createdAt: -1 },
      { name: "credit_transactions_tenant_created_at" },
    ),
    db.collection("orders").createIndex(
      { tenantId: 1, createdAt: -1 },
      { name: "orders_tenant_created_at" },
    ),
    db.collection("orders").createIndex(
      { tenantId: 1, actorProfileId: 1, createdAt: -1 },
      { name: "orders_tenant_actor_created_at" },
    ),
    db.collection("orders").createIndex(
      { tenantId: 1, idempotencyKey: 1 },
      {
        unique: true,
        name: "uniq_client_order_tenant_idempotency",
        partialFilterExpression: {
          orderSource: "client",
          idempotencyKey: { $type: "string" },
        },
      },
    ),
    db.collection("ai_runs").createIndex(
      { tenantId: 1, idempotencyKey: 1 },
      { unique: true, name: "uniq_ai_run_tenant_idempotency" },
    ),
    db.collection("ai_runs").createIndex(
      { correlationId: 1 },
      {
        unique: true,
        name: "uniq_ai_run_correlation",
        partialFilterExpression: { correlationId: { $type: "string" } },
      },
    ),
    db.collection("ai_run_jobs").createIndex(
      { runId: 1, command: 1, idempotencyKey: 1 },
      { unique: true, name: "uniq_ai_run_job_command" },
    ),
    db.collection("ai_run_jobs").createIndex(
      { status: 1, availableAt: 1, createdAt: 1 },
      { name: "idx_ai_run_job_available" },
    ),
    db.collection("ai_run_jobs").createIndex(
      { status: 1, leaseExpiresAt: 1 },
      { name: "ai_run_jobs_expired_lease_claim" },
    ),
    db.collection("ai_run_events").createIndex(
      { runId: 1, sequence: 1 },
      { unique: true, name: "uniq_ai_run_event_sequence" },
    ),
    db.collection("ai_run_events").createIndex(
      { tenantId: 1, runId: 1, sequence: 1 },
      { name: "idx_ai_run_event_replay" },
    ),
  ]).then(() => undefined);
  initialized.set(db, pending);
  return pending.catch((error) => {
    if (initialized.get(db) === pending) initialized.delete(db);
    throw error;
  });
}
