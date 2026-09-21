/**
 * Tenant AI budget service (G3.3).
 *
 * Orchestrates the usage ledger: reserve budget before a run (atomic,
 * concurrency-safe, idempotent), reconcile the actual against the reservation
 * exactly once, release on provider failure, and expire stale reservations for
 * terminal/absent runs. All monetary values are integer micro-USD bigint.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { ToolGovernanceError } from "./errors";
import {
  assert_budget_available,
  subtract_usage,
  type LedgerEntry,
  type UsageAmount,
} from "./usage-ledger";
import {
  month_key,
  type AIUsageRepository,
  type TenantAIExecutionContext,
  type UsageReservation,
} from "../../repositories/ai-usage-repository";

/** Estimated usage of a run (alias of a usage amount). */
export type UsageEstimate = UsageAmount;

/** Outcome of reconciling a run's actual usage against its reservation. */
export interface ReconcileResult {
  readonly reconciliation_required: boolean;
  readonly delta: UsageAmount;
}

/** Options for the budget service (injectable clock + overage tolerance). */
export interface BudgetServiceOptions {
  readonly clock?: () => Date;
  readonly overage_tolerance_microusd?: bigint;
}

/** The budget service surface. */
export interface BudgetService {
  reserve_usage(
    context: TenantAIExecutionContext,
    estimate: UsageEstimate,
    idempotency_key: string,
  ): Promise<UsageReservation>;
  reconcile_usage(
    context: TenantAIExecutionContext,
    reservation: UsageReservation,
    actual: UsageAmount,
    idempotency_key: string,
  ): Promise<ReconcileResult>;
  release_usage(
    context: TenantAIExecutionContext,
    reservation: UsageReservation,
    idempotency_key: string,
  ): Promise<void>;
  expire_stale_reservations(job_key: string): Promise<number>;
}

/**
 * Map a stored ledger entry back into a reservation handle (idempotent replay).
 *
 * @param entry - The reservation ledger entry.
 * @returns The reservation handle.
 */
function reservation_from_entry(entry: LedgerEntry): UsageReservation {
  return {
    reservation_id: entry.reservation_id ?? entry.idempotency_key,
    idempotency_key: entry.idempotency_key,
    run_id: entry.run_id,
    requests: entry.requests,
    tokens: entry.tokens,
    cost_microusd: entry.cost_microusd,
  };
}

/**
 * Create the budget service over a usage repository.
 *
 * @param repository - The usage repository (Mongo-backed or a test fake).
 * @param options - Optional injectable clock and overage tolerance.
 * @returns The budget service.
 */
export function create_budget_service(
  repository: AIUsageRepository,
  options: BudgetServiceOptions = {},
): BudgetService {
  const now = options.clock ?? (() => new Date());
  const tolerance = options.overage_tolerance_microusd ?? BigInt(0);

  return {
    /**
     * Reserve budget for a run inside a transaction. Replaying the same
     * idempotency key returns the existing reservation without double-charging.
     *
     * @throws UsageBudgetError when a budget dimension would be exceeded.
     */
    async reserve_usage(context, estimate, idempotency_key) {
      return repository.with_transaction(async (session) => {
        const existing = await repository.find_entry_by_key(
          context.tenant_id,
          idempotency_key,
          session,
        );
        if (existing) return reservation_from_entry(existing);

        const month = context.month ?? month_key(now());
        const totals = await repository.locked_month_totals(
          context.tenant_id,
          context.actor_profile_id,
          month,
          session,
        );
        assert_budget_available(totals, estimate, context.policy);
        return repository.insert_reservation(
          context,
          estimate,
          idempotency_key,
          month,
          session,
        );
      });
    },

    /**
     * Reconcile the actual usage against a reservation exactly once. Appends the
     * actual and a release that cancels the reservation. If the actual exceeds
     * the reservation beyond the overage tolerance, the run is marked
     * BUDGET_RECONCILIATION_REQUIRED for follow-up.
     */
    async reconcile_usage(context, reservation, actual, idempotency_key) {
      return repository.with_transaction(async (session) => {
        const delta = subtract_usage(actual, reservation);
        const existing = await repository.find_entry_by_key(
          context.tenant_id,
          idempotency_key,
          session,
        );
        if (existing) {
          // Replayed completion — already reconciled, do nothing again.
          return { reconciliation_required: false, delta };
        }

        const stamp = now();
        await repository.append_entry(
          {
            tenant_id: context.tenant_id,
            actor_profile_id: context.actor_profile_id,
            run_id: context.run_id,
            kind: "actual",
            idempotency_key,
            rate_card_version: context.rate_card_version,
            reservation_id: reservation.reservation_id,
            requests: actual.requests,
            tokens: actual.tokens,
            cost_microusd: actual.cost_microusd,
            created_at: stamp,
          },
          session,
        );
        await repository.append_entry(
          {
            tenant_id: context.tenant_id,
            actor_profile_id: context.actor_profile_id,
            run_id: context.run_id,
            kind: "release",
            idempotency_key: `${idempotency_key}:release`,
            rate_card_version: context.rate_card_version,
            reservation_id: reservation.reservation_id,
            requests: reservation.requests,
            tokens: reservation.tokens,
            cost_microusd: reservation.cost_microusd,
            released: true,
            created_at: stamp,
          },
          session,
        );

        const cost_overage = actual.cost_microusd - reservation.cost_microusd;
        const reconciliation_required = cost_overage > tolerance;
        if (reconciliation_required) {
          await repository.mark_run_status(
            context.run_id,
            "BUDGET_RECONCILIATION_REQUIRED",
            session,
          );
        }
        return { reconciliation_required, delta };
      });
    },

    /**
     * Release a reservation without any actual usage (e.g. the provider failed
     * before doing billable work). Idempotent on the release key.
     */
    async release_usage(context, reservation, idempotency_key) {
      await repository.with_transaction(async (session) => {
        const existing = await repository.find_entry_by_key(
          context.tenant_id,
          idempotency_key,
          session,
        );
        if (existing) return;
        await repository.append_entry(
          {
            tenant_id: context.tenant_id,
            actor_profile_id: context.actor_profile_id,
            run_id: context.run_id,
            kind: "release",
            idempotency_key,
            rate_card_version: context.rate_card_version,
            reservation_id: reservation.reservation_id,
            requests: reservation.requests,
            tokens: reservation.tokens,
            cost_microusd: reservation.cost_microusd,
            released: true,
            created_at: now(),
          },
          session,
        );
      });
    },

    /**
     * Release reservations whose run is terminal or absent. Each release carries
     * a per-run job idempotency key so re-running the job never double-releases.
     *
     * @returns The number of reservations released.
     */
    async expire_stale_reservations(job_key) {
      return repository.with_transaction(async (session) => {
        const open = await repository.list_open_reservations(session);
        let released = 0;
        for (const reservation of open) {
          const stale = await repository.is_run_terminal_or_absent(
            reservation.run_id,
            session,
          );
          if (!stale) continue;
          const key = `${job_key}:${reservation.run_id}`;
          const existing = await repository.find_entry_by_key(
            reservation.tenant_id,
            key,
            session,
          );
          if (existing) continue;
          await repository.append_entry(
            { ...reservation, kind: "release", idempotency_key: key, released: true, created_at: now() },
            session,
          );
          released += 1;
        }
        return released;
      });
    },
  };
}

export { ToolGovernanceError };
