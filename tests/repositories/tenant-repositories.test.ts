import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db, type WithId, type Document } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { build_tenant_execution_context } from "../../apps/ai/server/auth/tenant-execution-context";
import { TENANT_ROLE_PERMISSIONS } from "../../packages/shared-types/src/auth";
import type { RequestPrincipal, TenantRole } from "../../packages/shared-types/src/auth";
import type { TenantExecutionContext } from "../../packages/shared-types/src/tenant";

import {
  ResourceNotFoundError,
  SECURITY_INPUT_FIELDS,
} from "../../apps/ai/server/repositories/tenant-repository-base";
import { create_product_repository } from "../../apps/ai/server/repositories/product-repository";
import { create_stock_repository } from "../../apps/ai/server/repositories/stock-repository";
import { create_order_repository } from "../../apps/ai/server/repositories/order-repository";
import { create_formula_repository } from "../../apps/ai/server/repositories/formula-repository";
import { create_calculation_repository } from "../../apps/ai/server/repositories/calculation-repository";
import { create_conversation_repository } from "../../apps/ai/server/repositories/conversation-repository";
import { create_feedback_repository } from "../../apps/ai/server/repositories/feedback-repository";
import { create_audit_log_repository } from "../../apps/ai/server/repositories/audit-log-repository";

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;

let products: ReturnType<typeof create_product_repository>;
let stock: ReturnType<typeof create_stock_repository>;
let orders: ReturnType<typeof create_order_repository>;
let formulas: ReturnType<typeof create_formula_repository>;
let calculations: ReturnType<typeof create_calculation_repository>;
let conversations: ReturnType<typeof create_conversation_repository>;
let feedback: ReturnType<typeof create_feedback_repository>;
let audit_logs: ReturnType<typeof create_audit_log_repository>;

const TENANT_A = "507f1f77bcf86cd7994390a1";
const TENANT_B = "507f1f77bcf86cd7994390b1";
const PROFILE_A_USER = "507f1f77bcf86cd79943a001";
const PROFILE_A_USER_2 = "507f1f77bcf86cd79943a002";
const PROFILE_A_MANAGER = "507f1f77bcf86cd79943a003";
const PROFILE_B_MANAGER = "507f1f77bcf86cd79943b001";
const MISSING_ID = "ffffffffffffffffffffffff";
const INVALID_ID = "not-an-object-id";

const TENANT_COLLECTIONS = [
  "products",
  "stock_entries",
  "orders",
  "formulas",
  "formula_version_logs",
  "formula_comments",
  "price_calculations",
  "conversations",
  "chat_threads",
  "chat_messages",
  "feedback",
  "tenant_audit_events",
];

/**
 * Build a member-mode tenant execution context for tests.
 *
 * @param tenant_id - Tenant string ID the context is scoped to.
 * @param profile_id - Internal actor profile ID.
 * @param role - Tenant role deciding the permission catalogue.
 * @returns Frozen TenantExecutionContext in member mode.
 */
function make_context(
  tenant_id: string,
  profile_id: string,
  role: TenantRole,
): TenantExecutionContext {
  const principal: RequestPrincipal = {
    auth_provider: "clerk",
    provider_user_id: `user_${profile_id}`,
    internal_user_id: profile_id,
    active_tenant_id: tenant_id,
    platform_role: null,
    tenant_role: role,
    permissions: TENANT_ROLE_PERMISSIONS[role],
    membership_status: "active",
  };
  return build_tenant_execution_context(principal, null, {
    clerk_organization_id: `org_${tenant_id}`,
    membership_id: `mem_${profile_id}`,
  });
}

const a_user = () => make_context(TENANT_A, PROFILE_A_USER, "user");
const a_user_2 = () => make_context(TENANT_A, PROFILE_A_USER_2, "user");
const a_manager = () => make_context(TENANT_A, PROFILE_A_MANAGER, "manager");
const b_manager = () => make_context(TENANT_B, PROFILE_B_MANAGER, "manager");

/**
 * Capture a rejected promise's error for shape comparison.
 *
 * @param promise - Promise expected to reject.
 * @returns The rejection error.
 */
async function capture_error(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected promise to reject");
}

/**
 * Extract the externally observable error shape (name/code/message).
 *
 * @param error - Captured error.
 * @returns Plain shape object for equality assertions.
 */
function error_shape(error: Error): Record<string, unknown> {
  return {
    name: error.name,
    code: (error as ResourceNotFoundError).code,
    message: error.message,
  };
}

/** One table entry describing a repository's tenant-scoped CRUD surface. */
interface CrudSpec {
  readonly name: string;
  readonly code: string;
  readonly create: (context: TenantExecutionContext) => Promise<WithId<Document>>;
  readonly create_with: (
    context: TenantExecutionContext,
    extra: Record<string, unknown>,
  ) => Promise<WithId<Document>>;
  readonly get: (context: TenantExecutionContext, id: string) => Promise<unknown>;
  readonly list: (context: TenantExecutionContext) => Promise<unknown[]>;
  readonly update: (context: TenantExecutionContext, id: string) => Promise<unknown>;
  readonly remove: (context: TenantExecutionContext, id: string) => Promise<unknown>;
}

/** Shared secondary keys so tenant A and B rows are indistinguishable except by tenant. */
const SHARED_KEYS = { name: "Shared Name", sku: "SKU-001", referenceCode: "REF-9" };

const crud_specs: readonly CrudSpec[] = [
  {
    name: "product",
    code: "PRODUCT_NOT_FOUND",
    create: (ctx) => products.create_product(ctx, { ...SHARED_KEYS }),
    create_with: (ctx, extra) => products.create_product(ctx, { ...SHARED_KEYS, ...extra }),
    get: (ctx, id) => products.get_product(ctx, id),
    list: (ctx) => products.list_products(ctx),
    update: (ctx, id) => products.update_product(ctx, id, { name: "Updated" }),
    remove: (ctx, id) => products.delete_product(ctx, id),
  },
  {
    name: "stock_entry",
    code: "STOCK_ENTRY_NOT_FOUND",
    create: (ctx) => stock.create_stock_entry(ctx, { ...SHARED_KEYS, quantity: 5 }),
    create_with: (ctx, extra) => stock.create_stock_entry(ctx, { ...SHARED_KEYS, ...extra }),
    get: (ctx, id) => stock.get_stock_entry(ctx, id),
    list: (ctx) => stock.list_stock_entries(ctx),
    update: (ctx, id) => stock.update_stock_entry(ctx, id, { quantity: 6 }),
    remove: (ctx, id) => stock.delete_stock_entry(ctx, id),
  },
  {
    name: "order",
    code: "ORDER_NOT_FOUND",
    create: (ctx) => orders.create_order(ctx, { ...SHARED_KEYS, total: 100 }),
    create_with: (ctx, extra) => orders.create_order(ctx, { ...SHARED_KEYS, ...extra }),
    get: (ctx, id) => orders.get_order(ctx, id),
    list: (ctx) => orders.list_orders(ctx),
    update: (ctx, id) => orders.update_order(ctx, id, { total: 200 }),
    remove: (ctx, id) => orders.delete_order(ctx, id),
  },
  {
    name: "formula",
    code: "FORMULA_NOT_FOUND",
    create: (ctx) => formulas.create_formula(ctx, { ...SHARED_KEYS, status: "draft" }),
    create_with: (ctx, extra) => formulas.create_formula(ctx, { ...SHARED_KEYS, ...extra }),
    get: (ctx, id) => formulas.get_formula(ctx, id),
    list: (ctx) => formulas.list_formulas(ctx),
    update: (ctx, id) => formulas.update_own_draft(ctx, id, { name: "Updated" }),
    remove: (ctx, id) => formulas.delete_formula(ctx, id),
  },
  {
    name: "calculation",
    code: "CALCULATION_NOT_FOUND",
    create: (ctx) => calculations.create_calculation(ctx, { ...SHARED_KEYS, result: 42 }),
    create_with: (ctx, extra) => calculations.create_calculation(ctx, { ...SHARED_KEYS, ...extra }),
    get: (ctx, id) => calculations.get_calculation(ctx, id),
    list: (ctx) => calculations.list_calculations(ctx),
    update: (ctx, id) => calculations.update_calculation(ctx, id, { result: 43 }),
    remove: (ctx, id) => calculations.delete_calculation(ctx, id),
  },
  {
    name: "conversation",
    code: "CONVERSATION_NOT_FOUND",
    create: (ctx) => conversations.create_conversation(ctx, { ...SHARED_KEYS, title: "Chat" }),
    create_with: (ctx, extra) =>
      conversations.create_conversation(ctx, { ...SHARED_KEYS, ...extra }),
    get: (ctx, id) => conversations.get_conversation(ctx, id),
    list: (ctx) => conversations.list_conversations(ctx),
    update: (ctx, id) => conversations.update_conversation(ctx, id, { title: "Renamed" }),
    remove: (ctx, id) => conversations.delete_conversation(ctx, id),
  },
  {
    name: "feedback",
    code: "FEEDBACK_NOT_FOUND",
    create: (ctx) => feedback.create_feedback(ctx, { ...SHARED_KEYS, rating: 5 }),
    create_with: (ctx, extra) => feedback.create_feedback(ctx, { ...SHARED_KEYS, ...extra }),
    get: (ctx, id) => feedback.get_feedback(ctx, id),
    list: (ctx) => feedback.list_feedback(ctx),
    update: (ctx, id) => feedback.update_feedback(ctx, id, { rating: 1 }),
    remove: (ctx, id) => feedback.delete_feedback(ctx, id),
  },
];

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db("tenant_repositories_test");
  products = create_product_repository(db);
  stock = create_stock_repository(db);
  orders = create_order_repository(db);
  formulas = create_formula_repository(db);
  calculations = create_calculation_repository(db);
  conversations = create_conversation_repository(db);
  feedback = create_feedback_repository(db);
  audit_logs = create_audit_log_repository(db);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

beforeEach(async () => {
  for (const name of TENANT_COLLECTIONS) {
    await db.collection(name).deleteMany({});
  }
});

describe("tenant-scoped CRUD (table-driven)", () => {
  for (const spec of crud_specs) {
    it(`${spec.name}: scopes get/list/update/delete and hides other tenants`, async () => {
      const created_a = await spec.create(a_user());
      const created_b = await spec.create(b_manager());
      const id_a = String(created_a._id);
      const id_b = String(created_b._id);

      await expect(spec.get(a_user(), id_a)).resolves.toMatchObject({
        tenantId: TENANT_A,
      });
      const listed_a = await spec.list(a_user());
      expect(listed_a).toHaveLength(1);
      const listed_b = await spec.list(b_manager());
      expect(listed_b).toHaveLength(1);

      // Cross-tenant, missing, and malformed IDs are indistinguishable.
      const cross_error = await capture_error(spec.get(a_user(), id_b));
      const missing_error = await capture_error(spec.get(a_user(), MISSING_ID));
      const invalid_error = await capture_error(spec.get(a_user(), INVALID_ID));
      expect(cross_error).toBeInstanceOf(ResourceNotFoundError);
      expect(cross_error).toMatchObject({ code: spec.code });
      expect(error_shape(missing_error)).toEqual(error_shape(cross_error));
      expect(error_shape(invalid_error)).toEqual(error_shape(cross_error));

      // Cross-tenant update and delete fail with the same shape and leave B intact.
      const update_error = await capture_error(spec.update(a_user(), id_b));
      expect(error_shape(update_error)).toEqual(error_shape(cross_error));
      const delete_error = await capture_error(spec.remove(a_user(), id_b));
      expect(error_shape(delete_error)).toEqual(error_shape(cross_error));
      await expect(spec.get(b_manager(), id_b)).resolves.toBeTruthy();

      // Own delete works and subsequent get is not found.
      await spec.remove(a_user(), id_a);
      await expect(spec.get(a_user(), id_a)).rejects.toMatchObject({
        code: spec.code,
      });
    });

    for (const field of SECURITY_INPUT_FIELDS) {
      it(`${spec.name}: rejects security field "${field}" before database access`, async () => {
        await expect(
          spec.create_with(a_user(), { [field]: TENANT_B }),
        ).rejects.toThrow(/security field/);
        const stored = await spec.list(a_user());
        expect(stored).toHaveLength(0);
      });
    }
  }

  it("stamps tenant and actor ownership from the context on create", async () => {
    const created = await formulas.create_formula(a_user(), { name: "Mine" });
    expect(created).toMatchObject({
      tenantId: TENANT_A,
      ownerProfileId: PROFILE_A_USER,
    });
    const product = await products.create_product(a_user(), { name: "P" });
    expect(product).toMatchObject({
      tenantId: TENANT_A,
      actorProfileId: PROFILE_A_USER,
    });
  });
});

describe("nested formula resources", () => {
  it("scopes comments by tenant and parent formula", async () => {
    const formula_a = await formulas.create_formula(a_user(), { name: "FA" });
    const formula_b = await formulas.create_formula(b_manager(), { name: "FB" });
    const id_a = String(formula_a._id);
    const id_b = String(formula_b._id);

    await formulas.add_comment(a_user(), id_a, { body: "note A" });
    await formulas.add_comment(b_manager(), id_b, { body: "note B" });

    const comments_a = await formulas.list_comments(a_user(), id_a);
    expect(comments_a).toHaveLength(1);
    expect(comments_a[0]).toMatchObject({ body: "note A", tenantId: TENANT_A });

    await expect(formulas.list_comments(a_user(), id_b)).rejects.toMatchObject({
      code: "FORMULA_NOT_FOUND",
    });
    await expect(
      formulas.add_comment(a_user(), id_b, { body: "leak" }),
    ).rejects.toMatchObject({ code: "FORMULA_NOT_FOUND" });
  });

  it("scopes version logs by tenant and parent formula", async () => {
    const formula_a = await formulas.create_formula(a_user(), { name: "FA" });
    const formula_b = await formulas.create_formula(b_manager(), { name: "FB" });
    const id_a = String(formula_a._id);
    const id_b = String(formula_b._id);

    await formulas.add_version_log(a_user(), id_a, { note: "v1" });
    await formulas.add_version_log(b_manager(), id_b, { note: "v1" });

    const logs_a = await formulas.list_version_logs(a_user(), id_a);
    expect(logs_a).toHaveLength(1);
    expect(logs_a[0]).toMatchObject({ note: "v1", tenantId: TENANT_A });

    await expect(
      formulas.list_version_logs(a_user(), id_b),
    ).rejects.toMatchObject({ code: "FORMULA_NOT_FOUND" });
    await expect(
      formulas.add_version_log(a_user(), id_b, { note: "leak" }),
    ).rejects.toMatchObject({ code: "FORMULA_NOT_FOUND" });
  });
});

describe("chat threads and messages", () => {
  it("scopes messages by tenant and parent thread", async () => {
    const thread_a = await conversations.create_thread(a_user(), { title: "TA" });
    const thread_b = await conversations.create_thread(b_manager(), { title: "TB" });
    const id_a = String(thread_a._id);
    const id_b = String(thread_b._id);

    await conversations.add_chat_message(a_user(), id_a, { body: "hello A" });
    await conversations.add_chat_message(b_manager(), id_b, { body: "hello B" });

    const messages_a = await conversations.list_chat_messages(a_user(), id_a);
    expect(messages_a).toHaveLength(1);
    expect(messages_a[0]).toMatchObject({ body: "hello A", tenantId: TENANT_A });

    await expect(
      conversations.list_chat_messages(a_user(), id_b),
    ).rejects.toMatchObject({ code: "THREAD_NOT_FOUND" });
    await expect(
      conversations.add_chat_message(a_user(), id_b, { body: "leak" }),
    ).rejects.toMatchObject({ code: "THREAD_NOT_FOUND" });
  });

  it("allows thread updates only for the owning profile", async () => {
    const thread = await conversations.create_thread(a_user(), { title: "Mine" });
    const id = String(thread._id);

    await expect(
      conversations.update_own_thread(a_user(), id, { title: "Renamed" }),
    ).resolves.toMatchObject({ title: "Renamed" });

    const same_tenant_error = await capture_error(
      conversations.update_own_thread(a_user_2(), id, { title: "Hijack" }),
    );
    const cross_tenant_error = await capture_error(
      conversations.update_own_thread(b_manager(), id, { title: "Hijack" }),
    );
    expect(same_tenant_error).toMatchObject({ code: "THREAD_NOT_FOUND" });
    expect(error_shape(cross_tenant_error)).toEqual(error_shape(same_tenant_error));
  });
});

describe("owner-only draft updates", () => {
  it("allows a user to update only their own draft formulas", async () => {
    const draft = await formulas.create_formula(a_user(), { name: "Draft" });
    const id = String(draft._id);

    await expect(
      formulas.update_own_draft(a_user(), id, { name: "Draft v2" }),
    ).resolves.toMatchObject({ name: "Draft v2" });

    await expect(
      formulas.update_own_draft(a_user_2(), id, { name: "Steal" }),
    ).rejects.toMatchObject({ code: "FORMULA_NOT_FOUND" });

    await db
      .collection("formulas")
      .updateOne({ name: "Draft v2" }, { $set: { status: "testing" } });
    await expect(
      formulas.update_own_draft(a_user(), id, { name: "Too late" }),
    ).rejects.toMatchObject({ code: "FORMULA_NOT_FOUND" });
  });
});

describe("manager review surfaces", () => {
  it("gates the review queue behind formula:confirm", async () => {
    await formulas.create_formula(a_user(), { name: "In review", status: "testing" });
    await formulas.create_formula(b_manager(), { name: "In review", status: "testing" });

    const denied = await capture_error(formulas.list_review_queue(a_user()));
    expect(denied).toMatchObject({ code: "FORBIDDEN" });
    expect(denied).not.toBeInstanceOf(ResourceNotFoundError);

    const queue = await formulas.list_review_queue(a_manager());
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ tenantId: TENANT_A, status: "testing" });
  });

  it("gates confirmation behind formula:confirm and scopes it by tenant", async () => {
    const formula = await formulas.create_formula(a_user(), {
      name: "Confirm me",
      status: "testing",
    });
    const id = String(formula._id);

    await expect(
      formulas.confirm_formula(a_user(), id, "key-1"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      formulas.confirm_formula(b_manager(), id, "key-1"),
    ).rejects.toMatchObject({ code: "FORMULA_NOT_FOUND" });

    const confirmed = await formulas.confirm_formula(a_manager(), id, "key-1");
    expect(confirmed).toMatchObject({
      status: "confirmed",
      confirmedByProfileId: PROFILE_A_MANAGER,
    });

    const logs = await db
      .collection("formula_version_logs")
      .find({ formulaId: id, action: "confirm" })
      .toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      tenantId: TENANT_A,
      idempotencyKey: "key-1",
      writeState: "complete",
    });
  });

  it("replays a confirmation idempotently and repairs a pending write", async () => {
    const formula = await formulas.create_formula(a_user(), {
      name: "Idempotent",
      status: "testing",
    });
    const id = String(formula._id);

    await formulas.confirm_formula(a_manager(), id, "key-2");
    await formulas.confirm_formula(a_manager(), id, "key-2");
    const logs = await db
      .collection("formula_version_logs")
      .find({ formulaId: id, action: "confirm", idempotencyKey: "key-2" })
      .toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ writeState: "complete" });

    // A crashed confirm leaves a pending log; a retry completes it.
    await db
      .collection("formula_version_logs")
      .updateOne(
        { formulaId: id, idempotencyKey: "key-2" },
        { $set: { writeState: "pending" } },
      );
    await formulas.confirm_formula(a_manager(), id, "key-2");
    const repaired = await db
      .collection("formula_version_logs")
      .find({ formulaId: id, action: "confirm", idempotencyKey: "key-2" })
      .toArray();
    expect(repaired).toHaveLength(1);
    expect(repaired[0]).toMatchObject({ writeState: "complete" });
  });
});

describe("audit log repository", () => {
  it("appends and lists audit events per tenant only", async () => {
    await audit_logs.append_audit_event(a_user(), {
      action: "formula.read",
      resource_type: "formula",
      resource_id: MISSING_ID,
    });
    await audit_logs.append_audit_event(b_manager(), { action: "formula.read" });

    const events_a = await audit_logs.list_audit_events(a_user());
    expect(events_a).toHaveLength(1);
    expect(events_a[0]).toMatchObject({
      tenantId: TENANT_A,
      actorProfileId: PROFILE_A_USER,
      action: "formula.read",
      accessMode: "member",
    });
    expect(events_a[0]?.correlationId).toBeTruthy();

    const events_b = await audit_logs.list_audit_events(b_manager());
    expect(events_b).toHaveLength(1);
    expect(events_b[0]).toMatchObject({ tenantId: TENANT_B });
  });

  it("rejects security fields in audit metadata input", async () => {
    await expect(
      audit_logs.append_audit_event(a_user(), {
        action: "x",
        tenantId: TENANT_B,
      } as never),
    ).rejects.toThrow(/security field/);
  });
});
