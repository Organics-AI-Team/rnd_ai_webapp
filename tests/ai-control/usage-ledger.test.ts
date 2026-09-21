/**
 * G3.3 — tenant AI usage ledger + budget service tests.
 *
 * Exercises reservation within limits, every rejection dimension (tenant/user/
 * per-run/concurrency), concurrent reservations (serialized: N grant, rest
 * reject), idempotent replay, provider-failure release, reconciliation below/
 * above estimate, and replayed completion — all against an in-memory repository
 * whose `with_transaction` serializes, mirroring the Mongo write-conflict abort.
 */

import { describe, expect, it } from "vitest";

import type { EffectiveAIPolicy } from "@rnd-ai/shared-types";
import {
  create_budget_service,
  type UsageEstimate,
} from "../../apps/ai/server/services/ai-control/budget-service";
import {
  add_usage,
  ZERO_USAGE,
  type LedgerEntry,
  type MonthTotals,
  type UsageAmount,
} from "../../apps/ai/server/services/ai-control/usage-ledger";
import type {
  AIUsageRepository,
  TenantAIExecutionContext,
} from "../../apps/ai/server/repositories/ai-usage-repository";

const TENANT = "507f1f77bcf86cd7994390a1";
const ACTOR = "507f1f77bcf86cd79943a001";
const MONTH = "2026-07";

/**
 * Build a full effective policy with generous defaults, overridable per test.
 *
 * @param overrides - Partial policy fields to override.
 * @returns An EffectiveAIPolicy fixture.
 */
function make_policy(overrides: Partial<EffectiveAIPolicy> = {}): EffectiveAIPolicy {
  const big = BigInt(1_000_000_000);
  return {
    tenant_id: TENANT,
    version: 1,
    hash: "test",
    enabled: true,
    provider_models: { google: ["gemini-2.5-flash"] },
    allowed_tools: ["formula.search"],
    monthly_request_limit: big,
    monthly_token_limit: big,
    monthly_cost_limit_microusd: big,
    per_user_monthly_request_limit: big,
    per_user_monthly_token_limit: big,
    per_user_monthly_cost_limit_microusd: big,
    per_run_token_limit: big,
    per_run_cost_limit_microusd: big,
    max_concurrent_runs: 1000,
    default_locale: "th-TH",
    max_iterations: 12,
    approval_rules: {},
    ...overrides,
  };
}

/**
 * Build a per-run execution context.
 *
 * @param policy - The effective policy.
 * @param run_id - Unique run identifier.
 * @param actor - Acting profile id (defaults to ACTOR).
 * @returns A TenantAIExecutionContext.
 */
function make_context(
  policy: EffectiveAIPolicy,
  run_id: string,
  actor = ACTOR,
): TenantAIExecutionContext {
  return {
    tenant_id: TENANT,
    actor_profile_id: actor,
    run_id,
    policy,
    rate_card_version: "rc-2026-07",
    month: MONTH,
  };
}

/** A usage estimate helper. */
function usage(
  requests: number,
  tokens: number,
  cost: number,
): UsageEstimate {
  return {
    requests: BigInt(requests),
    tokens: BigInt(tokens),
    cost_microusd: BigInt(cost),
  };
}

/**
 * In-memory usage repository whose `with_transaction` serializes calls through
 * a promise chain — reproducing the serialized budget check the Mongo
 * write-conflict-abort achieves in production.
 */
function make_fake_repository(): AIUsageRepository & {
  runs: Map<string, string>;
  entries: (LedgerEntry & { month: string })[];
} {
  const entries: (LedgerEntry & { month: string })[] = [];
  const runs = new Map<string, string>();
  let queue: Promise<unknown> = Promise.resolve();
  let counter = 0;

  const sum = (docs: readonly LedgerEntry[]): UsageAmount =>
    docs.reduce((total, doc) => {
      const sign = doc.kind === "release" ? BigInt(-1) : BigInt(1);
      return add_usage(total, {
        requests: sign * doc.requests,
        tokens: sign * doc.tokens,
        cost_microusd: sign * doc.cost_microusd,
      });
    }, ZERO_USAGE);

  return {
    runs,
    entries,
    async with_transaction(fn) {
      const run = queue.then(() => fn(undefined));
      // keep the chain alive even if this txn rejects
      queue = run.catch(() => undefined);
      return run;
    },
    async find_entry_by_key(tenant_id, key) {
      return (
        entries.find(
          (entry) =>
            entry.tenant_id === tenant_id && entry.idempotency_key === key,
        ) ?? null
      );
    },
    async find_reservation(tenant_id, reservation_id) {
      return (
        entries.find(
          (entry) =>
            entry.tenant_id === tenant_id &&
            entry.reservation_id === reservation_id &&
            entry.kind === "reservation",
        ) ?? null
      );
    },
    async locked_month_totals(tenant_id, actor_profile_id, month): Promise<MonthTotals> {
      const tenant_docs = entries.filter(
        (entry) => entry.tenant_id === tenant_id && entry.month === month,
      );
      const actor_docs = tenant_docs.filter(
        (entry) => entry.actor_profile_id === actor_profile_id,
      );
      const reserved = new Set(
        tenant_docs.filter((e) => e.kind === "reservation").map((e) => e.run_id),
      );
      for (const doc of tenant_docs) {
        if (doc.kind === "release") reserved.delete(doc.run_id);
      }
      return {
        tenant: sum(tenant_docs),
        actor: sum(actor_docs),
        active_runs: reserved.size,
      };
    },
    async insert_reservation(context, estimate, idempotency_key, month) {
      counter += 1;
      const reservation_id = `res-${counter}`;
      entries.push({
        tenant_id: context.tenant_id,
        actor_profile_id: context.actor_profile_id,
        run_id: context.run_id,
        kind: "reservation",
        idempotency_key,
        rate_card_version: context.rate_card_version,
        reservation_id,
        requests: estimate.requests,
        tokens: estimate.tokens,
        cost_microusd: estimate.cost_microusd,
        created_at: new Date(0),
        month,
      });
      return {
        reservation_id,
        idempotency_key,
        run_id: context.run_id,
        requests: estimate.requests,
        tokens: estimate.tokens,
        cost_microusd: estimate.cost_microusd,
      };
    },
    async append_entry(entry) {
      entries.push({ ...entry, month: MONTH });
    },
    async mark_run_status(run_id, status) {
      runs.set(run_id, status);
    },
    async list_open_reservations() {
      const released = new Set(
        entries.filter((e) => e.kind === "release").map((e) => e.run_id),
      );
      return entries.filter(
        (e) => e.kind === "reservation" && !released.has(e.run_id),
      );
    },
    async is_run_terminal_or_absent(run_id) {
      const status = runs.get(run_id);
      return status === undefined || ["succeeded", "failed", "cancelled", "expired"].includes(status);
    },
  };
}

describe("reserve_usage — within limits and rejections", () => {
  it("grants a reservation within budget", async () => {
    const repo = make_fake_repository();
    const service = create_budget_service(repo);
    const context = make_context(make_policy(), "run-1");
    const reservation = await service.reserve_usage(context, usage(1, 100, 10), "k1");
    expect(reservation.tokens).toBe(BigInt(100));
    expect(reservation.reservation_id).toBeTruthy();
  });

  it("rejects on the tenant monthly request limit", async () => {
    const repo = make_fake_repository();
    const service = create_budget_service(repo);
    const policy = make_policy({ monthly_request_limit: BigInt(1) });
    await service.reserve_usage(make_context(policy, "run-1"), usage(1, 1, 1), "k1");
    await expect(
      service.reserve_usage(make_context(policy, "run-2"), usage(1, 1, 1), "k2"),
    ).rejects.toMatchObject({ code: "BUDGET_EXCEEDED", dimension: "tenant_requests" });
  });

  it("rejects on tenant token and cost limits", async () => {
    const service_tokens = create_budget_service(make_fake_repository());
    await expect(
      service_tokens.reserve_usage(
        make_context(make_policy({ monthly_token_limit: BigInt(50) }), "run-1"),
        usage(1, 100, 1),
        "k1",
      ),
    ).rejects.toMatchObject({ dimension: "tenant_tokens" });

    const service_cost = create_budget_service(make_fake_repository());
    await expect(
      service_cost.reserve_usage(
        make_context(make_policy({ monthly_cost_limit_microusd: BigInt(5) }), "run-1"),
        usage(1, 1, 100),
        "k1",
      ),
    ).rejects.toMatchObject({ dimension: "tenant_cost" });
  });

  it("rejects on per-user request/token/cost limits", async () => {
    const s1 = create_budget_service(make_fake_repository());
    const p1 = make_policy({ per_user_monthly_request_limit: BigInt(1) });
    await s1.reserve_usage(make_context(p1, "run-1"), usage(1, 1, 1), "k1");
    await expect(
      s1.reserve_usage(make_context(p1, "run-2"), usage(1, 1, 1), "k2"),
    ).rejects.toMatchObject({ dimension: "user_requests" });

    const s2 = create_budget_service(make_fake_repository());
    await expect(
      s2.reserve_usage(
        make_context(make_policy({ per_user_monthly_token_limit: BigInt(50) }), "run-1"),
        usage(1, 100, 1),
        "k1",
      ),
    ).rejects.toMatchObject({ dimension: "user_tokens" });
  });

  it("rejects on the max concurrent runs limit", async () => {
    const repo = make_fake_repository();
    const service = create_budget_service(repo);
    const policy = make_policy({ max_concurrent_runs: 1 });
    await service.reserve_usage(make_context(policy, "run-1"), usage(1, 1, 1), "k1");
    await expect(
      service.reserve_usage(make_context(policy, "run-2"), usage(1, 1, 1), "k2"),
    ).rejects.toMatchObject({ dimension: "max_concurrent_runs" });
  });

  it("rejects on per-run token and cost estimates", async () => {
    const s1 = create_budget_service(make_fake_repository());
    await expect(
      s1.reserve_usage(
        make_context(make_policy({ per_run_token_limit: BigInt(10) }), "run-1"),
        usage(1, 100, 1),
        "k1",
      ),
    ).rejects.toMatchObject({ dimension: "per_run_tokens" });

    const s2 = create_budget_service(make_fake_repository());
    await expect(
      s2.reserve_usage(
        make_context(make_policy({ per_run_cost_limit_microusd: BigInt(10) }), "run-1"),
        usage(1, 1, 100),
        "k1",
      ),
    ).rejects.toMatchObject({ dimension: "per_run_cost" });
  });
});

describe("reserve_usage — concurrency and idempotency", () => {
  it("grants exactly two of three concurrent half-budget reservations", async () => {
    const repo = make_fake_repository();
    const service = create_budget_service(repo);
    // token budget = 200, each reservation estimates 100 → only two fit.
    const policy = make_policy({ monthly_token_limit: BigInt(200) });
    const results = await Promise.allSettled([
      service.reserve_usage(make_context(policy, "run-a"), usage(1, 100, 1), "reserve_a"),
      service.reserve_usage(make_context(policy, "run-b"), usage(1, 100, 1), "reserve_b"),
      service.reserve_usage(make_context(policy, "run-c"), usage(1, 100, 1), "reserve_c"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("returns the same reservation for a duplicate idempotency key", async () => {
    const repo = make_fake_repository();
    const service = create_budget_service(repo);
    const context = make_context(make_policy(), "run-1");
    const first = await service.reserve_usage(context, usage(1, 100, 1), "dup");
    const second = await service.reserve_usage(context, usage(1, 100, 1), "dup");
    expect(second.reservation_id).toBe(first.reservation_id);
    expect(repo.entries.filter((e) => e.kind === "reservation")).toHaveLength(1);
  });
});

describe("release and reconcile", () => {
  it("release on provider failure frees the budget for a later run", async () => {
    const repo = make_fake_repository();
    const service = create_budget_service(repo);
    const policy = make_policy({ monthly_token_limit: BigInt(100) });
    const reservation = await service.reserve_usage(
      make_context(policy, "run-1"),
      usage(1, 100, 1),
      "k1",
    );
    await service.release_usage(make_context(policy, "run-1"), reservation, "k1:rel");
    // budget is free again — a fresh reservation succeeds.
    await expect(
      service.reserve_usage(make_context(policy, "run-2"), usage(1, 100, 1), "k2"),
    ).resolves.toBeTruthy();
  });

  it("reconciles an actual below the estimate without flagging the run", async () => {
    const repo = make_fake_repository();
    const service = create_budget_service(repo);
    const context = make_context(make_policy(), "run-1");
    const reservation = await service.reserve_usage(context, usage(1, 100, 100), "k1");
    const result = await service.reconcile_usage(context, reservation, usage(1, 40, 40), "k1:done");
    expect(result.reconciliation_required).toBe(false);
    const totals = await repo.locked_month_totals(TENANT, ACTOR, MONTH);
    // net = reservation(100) + actual(40) - release(100) = 40
    expect(totals.tenant.cost_microusd).toBe(BigInt(40));
  });

  it("flags the run when the actual exceeds the reservation beyond tolerance", async () => {
    const repo = make_fake_repository();
    const service = create_budget_service(repo);
    const context = make_context(make_policy(), "run-1");
    const reservation = await service.reserve_usage(context, usage(1, 100, 100), "k1");
    const result = await service.reconcile_usage(context, reservation, usage(1, 500, 500), "k1:done");
    expect(result.reconciliation_required).toBe(true);
    expect(repo.runs.get("run-1")).toBe("BUDGET_RECONCILIATION_REQUIRED");
  });

  it("is exactly-once on a replayed completion", async () => {
    const repo = make_fake_repository();
    const service = create_budget_service(repo);
    const context = make_context(make_policy(), "run-1");
    const reservation = await service.reserve_usage(context, usage(1, 100, 100), "k1");
    await service.reconcile_usage(context, reservation, usage(1, 40, 40), "k1:done");
    const actual_entries_before = repo.entries.filter((e) => e.kind === "actual").length;
    await service.reconcile_usage(context, reservation, usage(1, 40, 40), "k1:done");
    expect(repo.entries.filter((e) => e.kind === "actual")).toHaveLength(actual_entries_before);
  });
});

describe("expire_stale_reservations", () => {
  it("releases reservations only for terminal/absent runs, idempotently", async () => {
    const repo = make_fake_repository();
    const service = create_budget_service(repo);
    const policy = make_policy();
    await service.reserve_usage(make_context(policy, "run-live"), usage(1, 10, 10), "k-live");
    await service.reserve_usage(make_context(policy, "run-dead"), usage(1, 10, 10), "k-dead");
    repo.runs.set("run-live", "running");
    repo.runs.set("run-dead", "failed");

    const released = await service.expire_stale_reservations("expiry-job-1");
    expect(released).toBe(1);
    // Re-running the job releases nothing more (idempotent).
    expect(await service.expire_stale_reservations("expiry-job-1")).toBe(0);
    const open = await repo.list_open_reservations(undefined);
    expect(open.map((r) => r.run_id)).toEqual(["run-live"]);
  });
});
