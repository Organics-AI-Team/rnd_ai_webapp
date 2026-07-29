/**
 * Durable run-job queue with Mongo compare-and-set leases (G4.9).
 *
 * The gateway enqueues one job per run/command; the private worker claims a job
 * with an atomic lease, heartbeats to renew it, and completes or releases it.
 * Claiming is a single `findOneAndUpdate` compare-and-set so two workers can
 * never own the same job, and an expired lease (crashed worker) is reclaimable
 * on the next claim. Enqueue is idempotent on
 * `[runId, command, idempotencyKey]`, so a retried action never double-schedules
 * while a later interrupt for the same run can enqueue a new resume job. The worker is a platform process: this
 * queue is deliberately not tenant-scoped — the worker rebuilds the tenant
 * context from the pinned AIRun after claiming.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { ObjectId, type ClientSession, type Db, type Document, type WithId } from "mongodb";

/** The command a job carries to the worker. */
export type RunJobCommand = "start" | "resume";

/** A claimed job the worker will execute. */
export interface ClaimedRunJob {
  readonly job_id: string;
  readonly tenant_id: string;
  readonly run_id: string;
  readonly command: RunJobCommand;
  /** Trusted graph resume value, present only for resume commands. */
  readonly resume_payload?: unknown;
  readonly attempts: number;
}

/** Arguments for enqueuing a run job. */
export interface EnqueueRunJobInput {
  readonly tenant_id: string;
  readonly run_id: string;
  readonly command: RunJobCommand;
  /** Stable key for this start/resume action, reused only when that action is retried. */
  readonly idempotency_key: string;
  /** Server-normalized graph resume value; clients never write this directly. */
  readonly resume_payload?: unknown;
}

/** Durable, leased run-job queue. */
export interface RunJobQueue {
  enqueue(
    input: EnqueueRunJobInput,
    now: Date,
    session?: ClientSession,
  ): Promise<{ job_id: string; created: boolean }>;
  claim(args: {
    worker_id: string;
    now: Date;
    lease_ms: number;
  }): Promise<ClaimedRunJob | null>;
  heartbeat(args: {
    job_id: string;
    worker_id: string;
    now: Date;
    lease_ms: number;
  }): Promise<boolean>;
  complete(args: { job_id: string; worker_id: string }): Promise<boolean>;
  release(args: {
    job_id: string;
    worker_id: string;
    now: Date;
    backoff_ms: number;
    error?: string;
  }): Promise<boolean>;
  fail(args: {
    job_id: string;
    worker_id: string;
    now: Date;
    error: string;
  }): Promise<boolean>;
}

/**
 * Map a stored job document to the claimed-job shape.
 *
 * @param document - The ai_run_jobs document.
 * @returns The claimed-job projection.
 */
function to_claimed_job(document: WithId<Document>): ClaimedRunJob {
  return {
    job_id: String(document._id),
    tenant_id: String(document.tenantId),
    run_id: String(document.runId),
    command: document.command as RunJobCommand,
    ...(document.resumePayload !== undefined ? { resume_payload: document.resumePayload } : {}),
    attempts: Number(document.attempts ?? 0),
  };
}

/**
 * Create the run-job queue bound to a database handle.
 *
 * @param db - Connected MongoDB database.
 * @returns Queue instance backed by the ai_run_jobs collection.
 */
export function create_run_job_queue(db: Db): RunJobQueue {
  const jobs = db.collection("ai_run_jobs");

  return {
    async enqueue(input, now, session) {
      // Idempotent on [runId, command, idempotencyKey]: the unique index plus $setOnInsert means
      // a retried enqueue never double-schedules. `upsertedId` is set only when
      // this call performed the insert.
      const result = await jobs.updateOne(
        {
          runId: input.run_id,
          command: input.command,
          idempotencyKey: input.idempotency_key,
        },
        {
          $setOnInsert: {
            tenantId: input.tenant_id,
            runId: input.run_id,
            command: input.command,
            idempotencyKey: input.idempotency_key,
            ...(input.resume_payload !== undefined
              ? { resumePayload: input.resume_payload }
              : {}),
            status: "available",
            leaseOwner: null,
            leaseExpiresAt: null,
            heartbeatAt: null,
            attempts: 0,
            availableAt: now,
            lastError: null,
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true, session },
      );
      if (result.upsertedId) {
        return { job_id: String(result.upsertedId), created: true };
      }
      const existing = await jobs.findOne(
        {
          runId: input.run_id,
          command: input.command,
          idempotencyKey: input.idempotency_key,
        },
        { projection: { _id: 1 }, session },
      );
      return { job_id: String(existing?._id), created: false };
    },

    async claim(args) {
      const lease_expires = new Date(args.now.getTime() + args.lease_ms);
      const result = await jobs.findOneAndUpdate(
        {
          $or: [
            { status: "available", availableAt: { $lte: args.now } },
            { status: "leased", leaseExpiresAt: { $lt: args.now } },
          ],
        },
        {
          $set: {
            status: "leased",
            leaseOwner: args.worker_id,
            leaseExpiresAt: lease_expires,
            heartbeatAt: args.now,
            updatedAt: args.now,
          },
          $inc: { attempts: 1 },
        },
        { sort: { availableAt: 1, createdAt: 1 }, returnDocument: "after" },
      );
      const document = result as WithId<Document> | null;
      return document ? to_claimed_job(document) : null;
    },

    async heartbeat(args) {
      const lease_expires = new Date(args.now.getTime() + args.lease_ms);
      const result = await jobs.updateOne(
        { _id: object_id(args.job_id), status: "leased", leaseOwner: args.worker_id },
        { $set: { leaseExpiresAt: lease_expires, heartbeatAt: args.now, updatedAt: args.now } },
      );
      return result.matchedCount === 1;
    },

    async complete(args) {
      const result = await jobs.updateOne(
        { _id: object_id(args.job_id), leaseOwner: args.worker_id },
        { $set: { status: "completed", updatedAt: new Date() } },
      );
      return result.matchedCount === 1;
    },

    async release(args) {
      const result = await jobs.updateOne(
        { _id: object_id(args.job_id), leaseOwner: args.worker_id },
        {
          $set: {
            status: "available",
            leaseOwner: null,
            leaseExpiresAt: null,
            availableAt: new Date(args.now.getTime() + args.backoff_ms),
            lastError: args.error ?? null,
            updatedAt: args.now,
          },
        },
      );
      return result.matchedCount === 1;
    },

    async fail(args) {
      const result = await jobs.updateOne(
        { _id: object_id(args.job_id), status: "leased", leaseOwner: args.worker_id },
        {
          $set: {
            status: "failed",
            leaseOwner: null,
            leaseExpiresAt: null,
            lastError: args.error,
            failedAt: args.now,
            updatedAt: args.now,
          },
        },
      );
      return result.matchedCount === 1;
    },
  };
}

/**
 * Parse a job id string into an ObjectId, folding a malformed id into a fresh
 * (never-matching) ObjectId so an invalid id updates nothing.
 *
 * @param id - Job id string.
 * @returns The parsed or a never-matching ObjectId.
 */
function object_id(id: string): ObjectId {
  return ObjectId.isValid(id) ? new ObjectId(id) : new ObjectId();
}
