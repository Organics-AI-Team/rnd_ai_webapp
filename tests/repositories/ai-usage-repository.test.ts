import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { create_ai_usage_repository } from "../../apps/ai/server/repositories/ai-usage-repository";

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db("ai_usage_repository");
}, 60_000);

afterAll(async () => {
  await client.close();
  await server.stop();
});

beforeEach(async () => {
  await Promise.all([
    db.collection("ai_usage_ledger").deleteMany({}),
    db.collection("ai_runs").deleteMany({}),
  ]);
});

describe("AI usage repository document mapping", () => {
  it("hydrates stored camelCase strings into a bigint ledger entry", async () => {
    const reservation_id = new ObjectId();
    await db.collection("ai_usage_ledger").insertOne({
      _id: reservation_id,
      tenantId: "tenant-a",
      actorProfileId: "actor-a",
      runId: "run-a",
      month: "2026-07",
      kind: "reservation",
      idempotencyKey: "reserve-a",
      rateCardVersion: "rate-v1",
      requests: "1",
      tokens: "250",
      costMicrousd: "999",
      createdAt: new Date("2026-07-16T00:00:00.000Z"),
    });
    const repository = create_ai_usage_repository(db);

    await expect(repository.find_entry_by_key("tenant-a", "reserve-a", undefined)).resolves.toEqual({
      tenant_id: "tenant-a",
      actor_profile_id: "actor-a",
      run_id: "run-a",
      kind: "reservation",
      idempotency_key: "reserve-a",
      rate_card_version: "rate-v1",
      reservation_id: reservation_id.toHexString(),
      requests: 1n,
      tokens: 250n,
      cost_microusd: 999n,
      created_at: new Date("2026-07-16T00:00:00.000Z"),
    });
    await expect(
      repository.find_reservation("tenant-a", reservation_id.toHexString(), undefined),
    ).resolves.toMatchObject({ reservation_id: reservation_id.toHexString(), tokens: 250n });
  });

  it("treats the canonical completed run state as terminal", async () => {
    const run_id = new ObjectId();
    await db.collection("ai_runs").insertOne({ _id: run_id, status: "completed" });
    const repository = create_ai_usage_repository(db);
    await expect(
      repository.is_run_terminal_or_absent(run_id.toHexString(), undefined),
    ).resolves.toBe(true);
  });
});
