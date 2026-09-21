/**
 * Ordered, versioned run-event store (G4.9).
 *
 * Persists every `AgentRunEventV1` uniquely keyed by `[runId, sequence]` — the
 * worker appends before sending, so a reconnecting client can replay exactly the
 * events after its Last-Event-ID with no gaps or duplicates. Append is idempotent
 * (a retried append of the same sequence is a no-op), and replay is tenant-scoped
 * so a run's events can never be read across tenant boundaries.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import type { ClientSession, Db } from "mongodb";
import type { AgentRunEventV1 } from "@rnd-ai/shared-types/src/ai/contracts";

/** Identifies one run within its tenant. */
export interface RunRef {
  readonly tenant_id: string;
  readonly run_id: string;
}

/** Ordered, tenant-scoped event persistence for governed runs. */
export interface EventStore {
  /**
   * Append events for a run, idempotently on `[runId, sequence]`.
   *
   * @param run - Tenant + run the events belong to.
   * @param events - Versioned events to persist (any already-stored sequence is
   *                 skipped).
   * @param session - Optional Mongo session for transactional appends.
   * @returns The count of newly stored events.
   */
  append(
    run: RunRef,
    events: readonly AgentRunEventV1[],
    session?: ClientSession,
  ): Promise<{ appended: number }>;

  /**
   * Replay a run's events after a given sequence, in order.
   *
   * @param run - Tenant + run to replay.
   * @param after_sequence - Exclusive lower bound (Last-Event-ID); use -1 for all.
   * @returns Events with sequence strictly greater, ascending.
   */
  replay(run: RunRef, after_sequence: number): Promise<AgentRunEventV1[]>;

  /**
   * The highest stored sequence for a run, or -1 when none exist.
   *
   * @param run - Tenant + run to inspect.
   * @returns The latest sequence, or -1.
   */
  latest_sequence(run: RunRef): Promise<number>;
}

/**
 * Create the run-event store bound to a database handle.
 *
 * @param db - Connected MongoDB database.
 * @returns Event store backed by the ai_run_events collection.
 */
export function create_event_store(db: Db): EventStore {
  const events = db.collection("ai_run_events");

  return {
    async append(run, new_events, session) {
      if (new_events.length === 0) return { appended: 0 };
      const operations = new_events.map((event) => ({
        updateOne: {
          filter: { runId: run.run_id, sequence: event.sequence },
          update: {
            $setOnInsert: {
              tenantId: run.tenant_id,
              runId: run.run_id,
              sequence: event.sequence,
              type: event.type,
              event,
              occurredAt: new Date(event.occurred_at),
              createdAt: new Date(event.occurred_at),
            },
          },
          upsert: true,
        },
      }));
      const result = await events.bulkWrite(operations, { ordered: true, session });
      return { appended: result.upsertedCount };
    },

    async replay(run, after_sequence) {
      const documents = await events
        .find({ tenantId: run.tenant_id, runId: run.run_id, sequence: { $gt: after_sequence } })
        .sort({ sequence: 1 })
        .toArray();
      return documents.map((document) => document.event as AgentRunEventV1);
    },

    async latest_sequence(run) {
      const document = await events
        .find({ tenantId: run.tenant_id, runId: run.run_id })
        .sort({ sequence: -1 })
        .limit(1)
        .next();
      return document ? Number(document.sequence) : -1;
    },
  };
}
