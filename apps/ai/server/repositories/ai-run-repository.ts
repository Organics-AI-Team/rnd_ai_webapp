/**
 * Persistence for governed AI runs (G4.9).
 *
 * The gateway creates a run idempotently (unique `[tenantId, idempotencyKey]`),
 * the worker reads the pinned run and marks its terminal status, and routes read
 * a run tenant-scoped. Access is by `tenant_id` string rather than a full
 * TenantExecutionContext because the worker rebuilds tenant identity from a
 * claimed job before it has one. This repository is the sanctioned access point
 * for the `ai_runs` collection.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { ObjectId, type ClientSession, type Db, type Document, type WithId } from "mongodb";

/** Canonical not-found code for every run lookup failure mode. */
export const AI_RUN_NOT_FOUND = "AI_RUN_NOT_FOUND";

/** Terminal-and-interim run lifecycle states (mirrors AIRunStatus). */
export type AIRunStatus =
  | "queued"
  | "running"
  | "waiting_clarification"
  | "waiting_approval"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

/** Thrown when a run is missing, malformed, or cross-tenant. */
export class AIRunNotFoundError extends Error {
  /** Stable machine code. */
  readonly code = AI_RUN_NOT_FOUND;
  constructor() {
    super("The requested AI run was not found.");
    this.name = "AIRunNotFoundError";
  }
}

/** Persistence operations for governed runs. */
export interface AIRunRepository {
  /**
   * Create a run idempotently on `[tenantId, idempotencyKey]`. A duplicate key
   * returns the existing run with `created: false` so a retried gateway call
   * never double-creates.
   *
   * @param input - Tenant id and the full AIRun document (must carry idempotencyKey).
   * @param now - Deterministic create timestamp.
   * @param session - Optional Mongo session for a transactional create.
   * @returns The stored run and whether this call inserted it.
   */
  create(
    input: { tenant_id: string; document: Record<string, unknown> },
    now: Date,
    session?: ClientSession,
  ): Promise<{ run: WithId<Document>; created: boolean }>;

  /**
   * Find a run by its tenant and idempotency key.
   *
   * @param tenant_id - Verified tenant id.
   * @param idempotency_key - The run's idempotency key.
   * @returns The run, or null.
   */
  find_by_idempotency(
    tenant_id: string,
    idempotency_key: string,
  ): Promise<WithId<Document> | null>;

  /**
   * Fetch a run tenant-scoped by id.
   *
   * @param tenant_id - Verified tenant id.
   * @param run_id - Run id.
   * @returns The run.
   * @throws AIRunNotFoundError for cross-tenant, missing, or malformed ids.
   */
  get(tenant_id: string, run_id: string): Promise<WithId<Document>>;

  /**
   * Patch a run's status and terminal fields tenant-scoped.
   *
   * @param tenant_id - Verified tenant id.
   * @param run_id - Run id.
   * @param patch - Status and related fields to set.
   * @returns The updated run.
   * @throws AIRunNotFoundError for cross-tenant or missing runs.
   */
  mark_status(
    tenant_id: string,
    run_id: string,
    patch: Record<string, unknown>,
  ): Promise<WithId<Document>>;
}

/**
 * Whether a thrown error is a MongoDB duplicate-key error.
 *
 * @param error - The caught error.
 * @returns True for E11000.
 */
function is_duplicate_key(error: unknown): boolean {
  return Boolean(error) && (error as { code?: number }).code === 11000;
}

/**
 * Parse a run id, folding a malformed id into a never-matching ObjectId.
 *
 * @param run_id - Caller-supplied run id.
 * @returns The parsed or a never-matching ObjectId.
 */
function run_object_id(run_id: string): ObjectId {
  return ObjectId.isValid(run_id) ? new ObjectId(run_id) : new ObjectId();
}

/**
 * Create the AI run repository bound to a database handle.
 *
 * @param db - Connected MongoDB database.
 * @returns Repository over the ai_runs collection.
 */
export function create_ai_run_repository(db: Db): AIRunRepository {
  const runs = db.collection("ai_runs");

  return {
    async create({ tenant_id, document }, now, session) {
      const idempotency_key = String(document.idempotencyKey);
      const stored = {
        ...document,
        tenantId: tenant_id,
        status: document.status ?? "queued",
        createdAt: now,
        updatedAt: now,
      };
      try {
        const result = await runs.insertOne(stored, { session });
        return { run: { _id: result.insertedId, ...stored } as WithId<Document>, created: true };
      } catch (error) {
        if (is_duplicate_key(error)) {
          const existing = await runs.findOne(
            { tenantId: tenant_id, idempotencyKey: idempotency_key },
            { session },
          );
          if (existing) return { run: existing, created: false };
        }
        throw error;
      }
    },

    async find_by_idempotency(tenant_id, idempotency_key) {
      return runs.findOne({ tenantId: tenant_id, idempotencyKey: idempotency_key });
    },

    async get(tenant_id, run_id) {
      const run = await runs.findOne({ tenantId: tenant_id, _id: run_object_id(run_id) });
      if (!run) throw new AIRunNotFoundError();
      return run;
    },

    async mark_status(tenant_id, run_id, patch) {
      const updated = await runs.findOneAndUpdate(
        { tenantId: tenant_id, _id: run_object_id(run_id) },
        { $set: { ...patch, updatedAt: new Date() } },
        { returnDocument: "after" },
      );
      if (!updated) throw new AIRunNotFoundError();
      return updated;
    },
  };
}
