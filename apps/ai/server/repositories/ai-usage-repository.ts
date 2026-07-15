/**
 * Tenant AI usage repository (G3.3).
 *
 * Persists the append-only usage ledger and computes month-to-date totals for
 * budget decisions. The reservation write also bumps a per-tenant-month counter
 * document inside the same transaction so two concurrent reservations conflict
 * on that shared write — the loser aborts and retries against fresh totals,
 * making the budget check serialize correctly under concurrency.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import {
  ObjectId,
  type ClientSession,
  type Db,
  type Document,
} from "mongodb";
import type { EffectiveAIPolicy } from "@rnd-ai/shared-types";
import {
  add_usage,
  ZERO_USAGE,
  type LedgerEntry,
  type LedgerEntryKind,
  type MonthTotals,
  type UsageAmount,
} from "../services/ai-control/usage-ledger";

const LEDGER_COLLECTION = "ai_usage_ledger";
const COUNTER_COLLECTION = "ai_usage_counters";
const RUNS_COLLECTION = "ai_runs";

/** Run states that no longer count against the concurrency budget. */
export const TERMINAL_RUN_STATUSES: readonly string[] = Object.freeze([
  "succeeded",
  "failed",
  "cancelled",
  "expired",
]);

/**
 * Trusted per-run execution context for usage accounting. Never sourced from
 * model or client input.
 */
export interface TenantAIExecutionContext {
  readonly tenant_id: string;
  readonly actor_profile_id: string;
  readonly run_id: string;
  readonly policy: EffectiveAIPolicy;
  readonly rate_card_version: string;
  /** Billing month key, e.g. "2026-07". Defaults to the entry's own month. */
  readonly month?: string;
}

/** A granted reservation returned to the caller. */
export interface UsageReservation extends UsageAmount {
  readonly reservation_id: string;
  readonly idempotency_key: string;
  readonly run_id: string;
}

/**
 * Repository port consumed by the budget service. A `session` is an opaque
 * transaction handle passed back into each call within `with_transaction`.
 */
export interface AIUsageRepository {
  with_transaction<T>(fn: (session: unknown) => Promise<T>): Promise<T>;
  find_entry_by_key(
    tenant_id: string,
    idempotency_key: string,
    session: unknown,
  ): Promise<LedgerEntry | null>;
  find_reservation(
    tenant_id: string,
    reservation_id: string,
    session: unknown,
  ): Promise<LedgerEntry | null>;
  locked_month_totals(
    tenant_id: string,
    actor_profile_id: string,
    month: string,
    session: unknown,
  ): Promise<MonthTotals>;
  insert_reservation(
    context: TenantAIExecutionContext,
    estimate: UsageAmount,
    idempotency_key: string,
    month: string,
    session: unknown,
  ): Promise<UsageReservation>;
  append_entry(entry: LedgerEntry, session: unknown): Promise<void>;
  mark_run_status(
    run_id: string,
    status: string,
    session: unknown,
  ): Promise<void>;
  list_open_reservations(session: unknown): Promise<LedgerEntry[]>;
  is_run_terminal_or_absent(run_id: string, session: unknown): Promise<boolean>;
}

/**
 * Derive the billing month key for a date.
 *
 * @param when - The date.
 * @returns "YYYY-MM".
 */
export function month_key(when: Date): string {
  const year = when.getUTCFullYear();
  const month = String(when.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Read a bigint from a stored numeric value.
 *
 * @param value - Raw value.
 * @returns The coerced bigint (0 when absent/unparseable).
 */
function to_bigint(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  return BigInt(0);
}

/**
 * Sum the signed ledger contribution of an entry: reservations and actuals add,
 * releases subtract (a release stores the negated amount as `released`).
 *
 * @param docs - Ledger documents.
 * @returns The aggregate usage amount.
 */
function sum_effective(docs: readonly Document[]): UsageAmount {
  return docs.reduce<UsageAmount>((total, doc) => {
    const sign = doc.kind === "release" ? BigInt(-1) : BigInt(1);
    return {
      requests: total.requests + sign * to_bigint(doc.requests),
      tokens: total.tokens + sign * to_bigint(doc.tokens),
      cost_microusd: total.cost_microusd + sign * to_bigint(doc.costMicrousd),
    };
  }, ZERO_USAGE);
}

/**
 * Create the Mongo-backed usage repository.
 *
 * @param db - Connected database exposing the ledger/counter/run collections.
 * @returns AIUsageRepository bound to that database.
 */
export function create_ai_usage_repository(db: Db): AIUsageRepository {
  const client = (db as unknown as { client?: { startSession(): ClientSession } })
    .client;

  return {
    async with_transaction(fn) {
      if (!client) {
        // No session support (e.g. standalone): run without an explicit txn.
        return fn(undefined);
      }
      const session = client.startSession();
      try {
        let result!: Awaited<ReturnType<typeof fn>>;
        await session.withTransaction(async () => {
          result = await fn(session);
        });
        return result;
      } finally {
        await session.endSession();
      }
    },

    async find_entry_by_key(tenant_id, idempotency_key, session) {
      const doc = await db
        .collection(LEDGER_COLLECTION)
        .findOne(
          { tenantId: tenant_id, idempotencyKey: idempotency_key },
          { session: session as ClientSession | undefined },
        );
      return doc ? (doc as unknown as LedgerEntry) : null;
    },

    async find_reservation(tenant_id, reservation_id, session) {
      const filter = ObjectId.isValid(reservation_id)
        ? { _id: new ObjectId(reservation_id), tenantId: tenant_id }
        : { reservationId: reservation_id, tenantId: tenant_id };
      const doc = await db
        .collection(LEDGER_COLLECTION)
        .findOne(filter, { session: session as ClientSession | undefined });
      return doc ? (doc as unknown as LedgerEntry) : null;
    },

    async locked_month_totals(tenant_id, actor_profile_id, month, session) {
      const opts = { session: session as ClientSession | undefined };
      const tenant_docs = await db
        .collection(LEDGER_COLLECTION)
        .find({ tenantId: tenant_id, month }, opts)
        .toArray();
      const actor_docs = tenant_docs.filter(
        (doc) => doc.actorProfileId === actor_profile_id,
      );
      // A run is active while it has a reservation with no matching release
      // (append-only — reservations are never mutated).
      const reserved = new Set(
        tenant_docs
          .filter((doc) => doc.kind === "reservation")
          .map((doc) => String(doc.runId)),
      );
      for (const doc of tenant_docs) {
        if (doc.kind === "release") reserved.delete(String(doc.runId));
      }
      return {
        tenant: sum_effective(tenant_docs),
        actor: sum_effective(actor_docs),
        active_runs: reserved.size,
      };
    },

    async insert_reservation(context, estimate, idempotency_key, month, session) {
      const opts = { session: session as ClientSession | undefined };
      const reservation_id = new ObjectId();
      await db.collection(LEDGER_COLLECTION).insertOne(
        {
          _id: reservation_id,
          tenantId: context.tenant_id,
          actorProfileId: context.actor_profile_id,
          runId: context.run_id,
          month,
          kind: "reservation" as LedgerEntryKind,
          idempotencyKey: idempotency_key,
          rateCardVersion: context.rate_card_version,
          requests: estimate.requests.toString(),
          tokens: estimate.tokens.toString(),
          costMicrousd: estimate.cost_microusd.toString(),
          createdAt: new Date(),
        },
        opts,
      );
      // Shared per-tenant-month counter bump forces a write-conflict abort on a
      // racing reservation, serializing the budget check.
      await db.collection(COUNTER_COLLECTION).updateOne(
        { tenantId: context.tenant_id, month },
        { $inc: { reservationCount: 1 } },
        { upsert: true, ...opts },
      );
      return {
        reservation_id: reservation_id.toString(),
        idempotency_key,
        run_id: context.run_id,
        requests: estimate.requests,
        tokens: estimate.tokens,
        cost_microusd: estimate.cost_microusd,
      };
    },

    async append_entry(entry, session) {
      await db.collection(LEDGER_COLLECTION).insertOne(
        {
          tenantId: entry.tenant_id,
          actorProfileId: entry.actor_profile_id,
          runId: entry.run_id,
          month: month_key(entry.created_at),
          kind: entry.kind,
          idempotencyKey: entry.idempotency_key,
          rateCardVersion: entry.rate_card_version,
          reservationId: entry.reservation_id ?? null,
          requests: entry.requests.toString(),
          tokens: entry.tokens.toString(),
          costMicrousd: entry.cost_microusd.toString(),
          released: entry.released ?? false,
          createdAt: entry.created_at,
        },
        { session: session as ClientSession | undefined },
      );
    },

    async mark_run_status(run_id, status, session) {
      const filter = ObjectId.isValid(run_id)
        ? { _id: new ObjectId(run_id) }
        : { correlationId: run_id };
      await db
        .collection(RUNS_COLLECTION)
        .updateOne(
          filter,
          { $set: { status, updatedAt: new Date() } },
          { session: session as ClientSession | undefined },
        );
    },

    async list_open_reservations(session) {
      const opts = { session: session as ClientSession | undefined };
      const [reservations, releases] = await Promise.all([
        db.collection(LEDGER_COLLECTION).find({ kind: "reservation" }, opts).toArray(),
        db.collection(LEDGER_COLLECTION).find({ kind: "release" }, opts).toArray(),
      ]);
      const released_runs = new Set(releases.map((doc) => String(doc.runId)));
      return reservations
        .filter((doc) => !released_runs.has(String(doc.runId)))
        .map((doc) => ({
          tenant_id: String(doc.tenantId),
          actor_profile_id: String(doc.actorProfileId),
          run_id: String(doc.runId),
          kind: "reservation" as LedgerEntryKind,
          idempotency_key: String(doc.idempotencyKey),
          rate_card_version: String(doc.rateCardVersion),
          reservation_id: String(doc._id),
          requests: to_bigint(doc.requests),
          tokens: to_bigint(doc.tokens),
          cost_microusd: to_bigint(doc.costMicrousd),
          created_at: doc.createdAt instanceof Date ? doc.createdAt : new Date(),
        }));
    },

    async is_run_terminal_or_absent(run_id, session) {
      const filter = ObjectId.isValid(run_id)
        ? { _id: new ObjectId(run_id) }
        : { correlationId: run_id };
      const run = await db
        .collection(RUNS_COLLECTION)
        .findOne(filter, { session: session as ClientSession | undefined });
      return !run || TERMINAL_RUN_STATUSES.includes(String(run.status));
    },
  };
}

export { add_usage };
