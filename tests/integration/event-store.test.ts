/**
 * G4.9b — ordered, versioned run-event store.
 *
 * Proves append is idempotent on [runId, sequence], replay after a Last-Event-ID
 * returns exactly the later events in order, and events are tenant-scoped on read.
 * Exercised against a real in-memory MongoDB.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  create_event_store,
  type EventStore,
} from "../../apps/ai/server/services/ai-gateway/event-store";
import type { AgentRunEventV1 } from "@rnd-ai/shared-types/src/ai/contracts";

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let store: EventStore;

const TENANT_A = "507f1f77bcf86cd7994390a1";
const TENANT_B = "507f1f77bcf86cd7994390b1";
const RUN = "507f1f77bcf86cd79943c001";
const HASH = "a".repeat(64);
const A = { tenant_id: TENANT_A, run_id: RUN };

/** Build a valid AgentRunEventV1 with the given sequence/type/payload. */
function event(sequence: number, type: string, payload: unknown): AgentRunEventV1 {
  return {
    schema_version: "1",
    event_id: `evt_${sequence}`,
    run_id: RUN,
    sequence,
    occurred_at: "2026-07-15T00:00:00.000Z",
    type,
    payload,
  } as AgentRunEventV1;
}

const STREAM: AgentRunEventV1[] = [
  event(0, "run.accepted", { agent_key: "formulation", context_pack_hash: HASH, orchestrator_version: "1.0.0" }),
  event(1, "stage.changed", { stage: "thinking" }),
  event(2, "run.completed", { status: "completed", output_schema_version: "1" }),
];

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db("test_event_store");
  store = create_event_store(db);
});

afterAll(async () => {
  await client.close();
  await server.stop();
});

beforeEach(async () => {
  await db.collection("ai_run_events").deleteMany({});
});

describe("event store", () => {
  it("appends and replays all events in order", async () => {
    const { appended } = await store.append(A, STREAM);
    expect(appended).toBe(3);
    const replayed = await store.replay(A, -1);
    expect(replayed.map((e) => e.sequence)).toEqual([0, 1, 2]);
    expect(replayed.map((e) => e.type)).toEqual(["run.accepted", "stage.changed", "run.completed"]);
  });

  it("replays only events after a Last-Event-ID", async () => {
    await store.append(A, STREAM);
    const replayed = await store.replay(A, 0);
    expect(replayed.map((e) => e.sequence)).toEqual([1, 2]);
  });

  it("is idempotent — a re-appended sequence is not duplicated", async () => {
    await store.append(A, STREAM);
    const second = await store.append(A, STREAM);
    expect(second.appended).toBe(0);
    expect(await db.collection("ai_run_events").countDocuments({ runId: RUN })).toBe(3);
  });

  it("appends only the new tail when some events already exist", async () => {
    await store.append(A, STREAM.slice(0, 2)); // seq 0,1
    const { appended } = await store.append(A, STREAM); // seq 0,1,2 -> only 2 is new
    expect(appended).toBe(1);
    expect((await store.replay(A, -1)).map((e) => e.sequence)).toEqual([0, 1, 2]);
  });

  it("does not replay another tenant's run", async () => {
    await store.append(A, STREAM);
    const cross = await store.replay({ tenant_id: TENANT_B, run_id: RUN }, -1);
    expect(cross).toEqual([]);
  });

  it("reports the latest sequence", async () => {
    expect(await store.latest_sequence(A)).toBe(-1);
    await store.append(A, STREAM);
    expect(await store.latest_sequence(A)).toBe(2);
  });
});
