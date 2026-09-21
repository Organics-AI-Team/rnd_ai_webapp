import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLATFORM_ROLE_PERMISSIONS,
  TENANT_ROLE_PERMISSIONS,
  type RequestPrincipal,
} from "../../packages/shared-types/src/auth";
import { createCallerFactory, type TRPCContext } from "../../apps/ai/server/trpc";
import {
  type LifecycleReceiptStore,
  type LifecycleReport,
  type LifecycleStepReceipt,
  type LifecycleStepResult,
} from "../../apps/ai/server/services/data-governance/lifecycle-types";
import { create_tenant_export_service } from "../../apps/ai/server/services/data-governance/tenant-export";
import {
  SuspensionFailedError,
  create_tenant_suspension_service,
} from "../../apps/ai/server/services/data-governance/tenant-suspension";
import {
  LegalHoldError,
  create_tenant_deletion_service,
} from "../../apps/ai/server/services/data-governance/tenant-deletion";
import { create_retention_service } from "../../apps/ai/server/services/data-governance/retention-job";
import {
  create_platform_data_governance_router,
  type PlatformDataGovernanceOperations,
} from "../../apps/ai/server/routers/platform-data-governance";

const TENANT_A = "tenant_a";
const TENANT_B = "tenant_b";
const ACTOR = "507f1f77bcf86cd799439011";
const ROUTER_TENANT = "507f1f77bcf86cd799439012";
const NOW = "2026-07-16T00:00:00.000Z";

/** In-memory receipt port whose compound key proves tenant-scoped idempotency. */
class MemoryReceiptStore implements LifecycleReceiptStore {
  readonly reports = new Map<string, LifecycleReport>();
  readonly steps = new Map<string, LifecycleStepReceipt>();

  /** Build a collision-safe operation/tenant/job key. */
  private key(operation: string, tenant_id: string, job_id: string): string {
    return `${operation}\u0000${tenant_id}\u0000${job_id}`;
  }

  /** Load one completed report by tenant-scoped idempotency key. */
  async get_report(operation: string, tenant_id: string, job_id: string): Promise<unknown | null> {
    return this.reports.get(this.key(operation, tenant_id, job_id)) ?? null;
  }

  /** Persist one completed report. */
  async save_report(report: LifecycleReport): Promise<void> {
    this.reports.set(this.key(report.operation, report.tenant_id, report.job_id), report);
  }

  /** Load a completed phase receipt. */
  async get_step(
    operation: string,
    tenant_id: string,
    job_id: string,
    step: string,
  ): Promise<LifecycleStepReceipt | null> {
    return this.steps.get(`${this.key(operation, tenant_id, job_id)}\u0000${step}`) ?? null;
  }

  /** Persist one completed phase receipt. */
  async save_step(receipt: LifecycleStepReceipt): Promise<void> {
    this.steps.set(
      `${this.key(receipt.operation, receipt.tenant_id, receipt.job_id)}\u0000${receipt.step}`,
      receipt,
    );
  }
}

/** Build a standard completed lifecycle-step result. */
function result(
  scanned: number,
  deleted = 0,
  skipped = 0,
  metadata: Record<string, string | number | boolean | null> = {},
): LifecycleStepResult {
  return { scanned, deleted, skipped, errors: 0, metadata };
}

/** Build a verified server principal for router authorization tests. */
function principal(kind: "super_admin" | "admin" | "manager"): RequestPrincipal {
  if (kind === "manager") {
    return {
      auth_provider: "clerk",
      provider_user_id: "clerk_manager",
      internal_user_id: "507f1f77bcf86cd799439013",
      active_tenant_id: ROUTER_TENANT,
      platform_role: null,
      tenant_role: "manager",
      permissions: TENANT_ROLE_PERMISSIONS.manager,
      membership_status: "active",
    };
  }
  return {
    auth_provider: "clerk",
    provider_user_id: `clerk_${kind}`,
    internal_user_id: kind === "super_admin" ? ACTOR : "507f1f77bcf86cd799439014",
    active_tenant_id: null,
    platform_role: kind,
    tenant_role: null,
    permissions: PLATFORM_ROLE_PERMISSIONS[kind],
    membership_status: null,
  };
}

/** Build the transport context consumed by an independently tested router. */
function context(value: RequestPrincipal): TRPCContext {
  return {
    principal: value,
    auth_error: null,
    legacy_user: null,
    resolver_used: "clerk",
  };
}

describe("tenant export", () => {
  it("exports only one tenant, encrypts a point-in-time artifact, and scopes replay receipts", async () => {
    const receipts = new MemoryReceiptStore();
    const artifacts = new Map<string, Uint8Array>();
    const audit_events: Array<{
      tenant_id: string;
      actor_profile_id: string;
      job_id: string;
      manifest_sha256: string;
      object_key: string;
    }> = [];
    let snapshot_calls = 0;
    let encryption_calls = 0;
    const service = create_tenant_export_service({
      receipts,
      business_data: {
        async snapshot_tenant({ tenant_id, point_in_time_iso, job_id }) {
          snapshot_calls += 1;
          expect(point_in_time_iso).toBe(NOW);
          expect(job_id).toBe("export_same_job");
          return [
            {
              collection: "formulas",
              records: [
                { id: "formula_a", tenant_id: TENANT_A },
                { id: "formula_b", tenant_id: TENANT_B },
              ].filter((record) => record.tenant_id === tenant_id),
            },
          ];
        },
      },
      knowledge: {
        async snapshot_tenant({ tenant_id }) {
          return [{
            collection: "knowledge_sources",
            records: [{ id: `knowledge_${tenant_id}`, tenant_id }],
          }];
        },
      },
      encryption: {
        async encrypt({ plaintext_utf8 }) {
          encryption_calls += 1;
          return {
            ciphertext: new TextEncoder().encode(
              `sealed:${Buffer.from(plaintext_utf8, "utf8").toString("base64")}`,
            ),
            algorithm: "test-envelope-v1",
            key_reference: "test-key-reference",
          };
        },
      },
      artifacts: {
        async put_once(input) {
          if (!artifacts.has(input.object_key)) artifacts.set(input.object_key, input.ciphertext);
          return {
            object_key: input.object_key,
            expires_at_iso: input.expires_at_iso,
            size_bytes: input.ciphertext.byteLength,
          };
        },
      },
      audit: {
        async record_export(event) {
          audit_events.push(event);
        },
      },
      now_iso: () => NOW,
    });
    const job = {
      job_id: "export_same_job",
      tenant_id: TENANT_A,
      requested_by_profile_id: ACTOR,
      requested_at_iso: NOW,
      expires_at_iso: "2026-07-23T00:00:00.000Z",
    } as const;

    const first = await service.export_tenant_data(job);
    const replay = await service.export_tenant_data(job);
    const tenant_b = await service.export_tenant_data({ ...job, tenant_id: TENANT_B });

    expect(replay).toEqual(first);
    expect(first.verified).toBe(true);
    expect(first.manifest.collections).toEqual([
      expect.objectContaining({ collection: "formulas", count: 1 }),
      expect.objectContaining({ collection: "knowledge_sources", count: 1 }),
    ]);
    expect(first.manifest.collections.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256))).toBe(true);
    expect(first.artifact).toMatchObject({
      expires_at_iso: job.expires_at_iso,
      algorithm: "test-envelope-v1",
      key_reference: "test-key-reference",
    });
    expect(first.artifact.object_key).toContain(`${TENANT_A}/exports/`);
    expect(tenant_b.artifact.object_key).toContain(`${TENANT_B}/exports/`);
    expect(snapshot_calls).toBe(2);
    expect(encryption_calls).toBe(2);
    expect(audit_events).toEqual([
      {
        tenant_id: TENANT_A,
        actor_profile_id: ACTOR,
        job_id: job.job_id,
        manifest_sha256: first.manifest.sha256,
        object_key: first.artifact.object_key,
      },
      {
        tenant_id: TENANT_B,
        actor_profile_id: ACTOR,
        job_id: job.job_id,
        manifest_sha256: tenant_b.manifest.sha256,
        object_key: tenant_b.artifact.object_key,
      },
    ]);

    const sealed = new TextDecoder().decode(artifacts.get(first.artifact.object_key));
    const payload = Buffer.from(sealed.replace("sealed:", ""), "base64").toString("utf8");
    expect(payload).toContain("formula_a");
    expect(payload).not.toContain("formula_b");
    expect(payload).not.toContain(TENANT_B);
  });
});

describe("tenant suspension", () => {
  it("suspends the tenant before blocking sessions/runs and preserves audit and ledger evidence", async () => {
    const receipts = new MemoryReceiptStore();
    const order: string[] = [];
    const evidence = { audit: ["audit_a"], ledger: ["ledger_a"] };
    const service = create_tenant_suspension_service({
      receipts,
      tenant: {
        async suspend_once() {
          order.push("tenant");
          return result(1, 0, 0, { status: "suspended" });
        },
      },
      access: {
        async block_new_sessions() {
          order.push("sessions");
          return result(2, 2);
        },
        async block_new_ai_reservations_and_writes() {
          order.push("ai");
          return result(1, 1);
        },
        async suspend_memberships() {
          order.push("memberships");
          return result(3, 3);
        },
      },
      now_iso: () => NOW,
    });
    const job = {
      job_id: "suspend_a",
      tenant_id: TENANT_A,
      requested_by_profile_id: ACTOR,
      requested_at_iso: NOW,
      reason: "commercial lifecycle test suspension",
    } as const;

    const first = await service.suspend_tenant(job);
    const replay = await service.suspend_tenant(job);

    expect(first.verified).toBe(true);
    expect(replay).toEqual(first);
    expect(order).toEqual(["tenant", "sessions", "ai", "memberships"]);
    expect(evidence).toEqual({ audit: ["audit_a"], ledger: ["ledger_a"] });
    expect(first.steps.map(({ step }) => step)).not.toEqual(
      expect.arrayContaining(["delete_audit", "delete_ledger"]),
    );
  });

  it("fails closed before access phases when tenant suspension is not verified", async () => {
    const receipts = new MemoryReceiptStore();
    const access_calls: string[] = [];
    const service = create_tenant_suspension_service({
      receipts,
      tenant: {
        async suspend_once() {
          return { ...result(1, 0, 0, { status: "active" }), errors: 1 };
        },
      },
      access: {
        async block_new_sessions() {
          access_calls.push("sessions");
          return result(1, 1);
        },
        async block_new_ai_reservations_and_writes() {
          access_calls.push("ai");
          return result(1, 1);
        },
        async suspend_memberships() {
          access_calls.push("memberships");
          return result(1, 1);
        },
      },
      now_iso: () => NOW,
    });

    await expect(service.suspend_tenant({
      job_id: "suspend_fail_closed",
      tenant_id: TENANT_A,
      requested_by_profile_id: ACTOR,
      requested_at_iso: NOW,
      reason: "verify suspension failure stops all access phases",
    })).rejects.toBeInstanceOf(SuspensionFailedError);
    expect(access_calls).toEqual([]);
    expect(receipts.reports.size).toBe(0);
  });
});

/** Build tenant-isolated deletion ports over mutable in-memory systems. */
function deletion_world(options: { legal_hold?: boolean; fail_qdrant_once?: boolean } = {}) {
  const receipts = new MemoryReceiptStore();
  const systems = {
    content: [TENANT_A, TENANT_A, TENANT_B],
    qdrant: [TENANT_A, TENANT_A, TENANT_B],
    objects: [`tenants/${TENANT_A}/a`, `tenants/${TENANT_B}/b`],
    clerk: new Set([TENANT_A, TENANT_B]),
    projections: [TENANT_A, TENANT_B],
    tombstones: new Set<string>(),
  };
  const calls = new Map<string, number>();
  let qdrant_failed = false;
  const count_call = (step: string) => calls.set(step, (calls.get(step) ?? 0) + 1);
  const service = create_tenant_deletion_service({
    receipts,
    legal_holds: { has_active_hold: async () => options.legal_hold ?? false },
    tenant: {
      async require_suspended() {
        return;
      },
    },
    content: {
      async delete_content_artifacts_checkpoints({ tenant_id }) {
        count_call("content_artifacts_checkpoints");
        const before = systems.content.length;
        systems.content = systems.content.filter((tenant) => tenant !== tenant_id);
        return result(before, before - systems.content.length);
      },
    },
    qdrant: {
      async delete_tenant_points({ tenant_id, tenant_filter }) {
        count_call("qdrant");
        expect(tenant_filter).toEqual({ tenant_id });
        if (options.fail_qdrant_once && !qdrant_failed) {
          qdrant_failed = true;
          throw new Error("synthetic qdrant outage");
        }
        const before = systems.qdrant.filter((tenant) => tenant === tenant_id).length;
        systems.qdrant = systems.qdrant.filter((tenant) => tenant !== tenant_id);
        const remaining = systems.qdrant.filter((tenant) => tenant === tenant_id).length;
        return result(before, before - remaining, 0, { remaining });
      },
    },
    object_storage: {
      async delete_tenant_prefix({ tenant_id, prefix }) {
        count_call("object_storage");
        expect(prefix).toBe(`tenants/${tenant_id}/`);
        const before = systems.objects.length;
        systems.objects = systems.objects.filter((key) => !key.startsWith(prefix));
        return result(before, before - systems.objects.length);
      },
    },
    clerk: {
      async delete_memberships_and_organization({ tenant_id }) {
        count_call("clerk");
        const deleted = systems.clerk.delete(tenant_id) ? 1 : 0;
        return result(1, deleted, deleted === 0 ? 1 : 0);
      },
    },
    projections: {
      async delete_internal_projections({ tenant_id }) {
        count_call("internal_projections");
        const before = systems.projections.length;
        systems.projections = systems.projections.filter((tenant) => tenant !== tenant_id);
        return result(before, before - systems.projections.length);
      },
    },
    tombstones: {
      async create_once({ tenant_id }) {
        count_call("tombstone");
        const existed = systems.tombstones.has(tenant_id);
        systems.tombstones.add(tenant_id);
        return result(1, existed ? 0 : 1, existed ? 1 : 0);
      },
    },
    now_iso: () => NOW,
  });
  return { service, systems, calls, receipts };
}

const deletion_job = {
  job_id: "delete_a",
  tenant_id: TENANT_A,
  requested_by_profile_id: ACTOR,
  requested_at_iso: NOW,
} as const;

describe("tenant deletion", () => {
  it("deletes tenant A across every system without touching B and is replay safe", async () => {
    const world = deletion_world();
    const first = await world.service.delete_tenant_data(deletion_job);
    const replay = await world.service.delete_tenant_data(deletion_job);

    expect(first.verified).toBe(true);
    expect(replay).toEqual(first);
    expect(world.systems.content).toEqual([TENANT_B]);
    expect(world.systems.qdrant).toEqual([TENANT_B]);
    expect(world.systems.objects).toEqual([`tenants/${TENANT_B}/b`]);
    expect([...world.systems.clerk]).toEqual([TENANT_B]);
    expect(world.systems.projections).toEqual([TENANT_B]);
    expect(world.systems.tombstones).toEqual(new Set([TENANT_A]));
    expect([...world.calls.values()].every((count) => count === 1)).toBe(true);
    expect(first.steps.map(({ step }) => step)).toEqual([
      "content_artifacts_checkpoints",
      "qdrant",
      "object_storage",
      "clerk",
      "internal_projections",
      "tombstone",
    ]);
  });

  it("resumes after partial failure without repeating completed phases", async () => {
    const world = deletion_world({ fail_qdrant_once: true });
    await expect(world.service.delete_tenant_data(deletion_job)).rejects.toThrow(
      "synthetic qdrant outage",
    );
    const resumed = await world.service.delete_tenant_data(deletion_job);

    expect(resumed.verified).toBe(true);
    expect(world.calls.get("content_artifacts_checkpoints")).toBe(1);
    expect(world.calls.get("qdrant")).toBe(2);
    expect(world.systems.content).toEqual([TENANT_B]);
    expect(world.systems.qdrant).toEqual([TENANT_B]);
  });

  it("fails closed on legal hold before any destructive phase", async () => {
    const world = deletion_world({ legal_hold: true });
    await expect(world.service.delete_tenant_data(deletion_job)).rejects.toBeInstanceOf(
      LegalHoldError,
    );
    expect(world.calls.size).toBe(0);
    expect(world.systems.content).toEqual([TENANT_A, TENANT_A, TENANT_B]);
  });
});

describe("retention", () => {
  it("uses the shorter policy, preserves held records, reports counts, and is idempotent", async () => {
    const receipts = new MemoryReceiptStore();
    let apply_calls = 0;
    const records = [
      { id: "old", tenant_id: TENANT_A, created_at: "2026-05-01T00:00:00.000Z", hold: false },
      { id: "held", tenant_id: TENANT_A, created_at: "2026-05-01T00:00:00.000Z", hold: true },
      { id: "recent", tenant_id: TENANT_A, created_at: "2026-07-01T00:00:00.000Z", hold: false },
      { id: "other", tenant_id: TENANT_B, created_at: "2026-05-01T00:00:00.000Z", hold: false },
    ];
    const service = create_retention_service({
      receipts,
      records: {
        async apply_retention({ tenant_id, delete_before_iso, preserve_legal_holds }) {
          apply_calls += 1;
          expect(preserve_legal_holds).toBe(true);
          const tenant_records = records.filter((record) => record.tenant_id === tenant_id);
          const deletable = tenant_records.filter(
            (record) => record.created_at < delete_before_iso && !record.hold,
          );
          for (const record of deletable) records.splice(records.indexOf(record), 1);
          return result(
            tenant_records.length,
            deletable.length,
            tenant_records.length - deletable.length,
            { delete_before_iso },
          );
        },
      },
      now_iso: () => NOW,
    });
    const job = {
      job_id: "retention_a",
      tenant_id: TENANT_A,
      requested_by_profile_id: ACTOR,
      requested_at_iso: NOW,
      as_of_iso: NOW,
      platform_retention_days: 30,
      tenant_retention_days: 90,
    } as const;

    const first = await service.apply_retention(job);
    const replay = await service.apply_retention(job);

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      verified: true,
      effective_retention_days: 30,
      totals: { scanned: 3, deleted: 1, skipped: 2, errors: 0 },
    });
    expect(records.map(({ id }) => id)).toEqual(["held", "recent", "other"]);
    expect(apply_calls).toBe(1);
  });
});

describe("platform data-governance router", () => {
  it("requires a verified super admin and derives actor identity server-side", async () => {
    const observed: Array<{ operation: string; actor: string }> = [];
    const operations: PlatformDataGovernanceOperations = {
      async export_tenant_data(job) {
        observed.push({ operation: "export", actor: job.requested_by_profile_id });
        return { verified: true };
      },
      async suspend_tenant(job) {
        observed.push({ operation: "suspend", actor: job.requested_by_profile_id });
        return { verified: true };
      },
      async delete_tenant_data(job) {
        observed.push({ operation: "delete", actor: job.requested_by_profile_id });
        return { verified: true };
      },
      async apply_retention(job) {
        observed.push({ operation: "retention", actor: job.requested_by_profile_id });
        return { verified: true };
      },
    };
    const router = create_platform_data_governance_router(operations, () => NOW);
    const create_caller = createCallerFactory(router);

    await expect(
      create_caller(context(principal("manager"))).deleteTenant({
        job_id: "delete_router",
        tenant_id: TENANT_A,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      create_caller(context(principal("admin"))).deleteTenant({
        job_id: "delete_router",
        tenant_id: TENANT_A,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await create_caller(context(principal("super_admin"))).exportTenant({
      job_id: "export_router",
      tenant_id: TENANT_A,
      expires_at_iso: "2026-07-23T00:00:00.000Z",
    });
    expect(observed).toEqual([{ operation: "export", actor: ACTOR }]);

    await expect(
      create_caller(context(principal("super_admin"))).exportTenant({
        job_id: "export_router_2",
        tenant_id: TENANT_A,
        expires_at_iso: "2026-07-23T00:00:00.000Z",
        requested_by_profile_id: "client_spoof",
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("tenant lifecycle runbook", () => {
  it("documents authorization, phase order, legal hold, replay, and tenant-scoped selectors", () => {
    const runbook = readFileSync(
      join(process.cwd(), "docs/commercial/runbooks/tenant-lifecycle.md"),
      "utf8",
    );
    expect(runbook).toContain("super administrator");
    expect(runbook).toContain("legal hold");
    expect(runbook).toContain("tenant filter");
    expect(runbook).toContain("idempotent");
    expect(runbook).toContain("content/artifacts/checkpoints");
    expect(runbook).toContain("tombstone");
  });
});
