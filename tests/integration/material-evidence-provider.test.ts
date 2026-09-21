/**
 * G4.8d wiring — raw-material-backed MaterialEvidenceProvider.
 *
 * Proves a material in the catalogue is returned available and evidence-backed
 * (keyed by both rm_code and catalogue id, sourced by its own code), and an
 * unknown material yields no evidence. A pure catalogue read, no credentials.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { create_material_evidence_provider } from "../../apps/ai/server/repositories/material-evidence-provider";
import type { MaterialEvidenceProvider } from "../../apps/ai/server/services/ai-control/formula-artifact-service";
import type { TrustedRuntimeContext } from "@rnd-ai/ai-orchestration";

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let provider: MaterialEvidenceProvider;

const CONTEXT = {} as TrustedRuntimeContext;
const ACTIVE_ID = new ObjectId();

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db("test_material_evidence");
  provider = create_material_evidence_provider(db);
});

afterAll(async () => {
  await client.close();
  await server.stop();
});

beforeEach(async () => {
  await db.collection("raw_materials_console").deleteMany({});
  await db.collection("raw_materials_console").insertOne({
    _id: ACTIVE_ID,
    rm_code: "RM_ACTIVE",
    trade_name: "Brightening Active",
    rm_cost: 1.5,
  });
});

describe("create_material_evidence_provider", () => {
  it("returns available, source-backed evidence for a catalogued material", async () => {
    const index = await provider.load_evidence(["RM_ACTIVE"], CONTEXT);
    expect(index.RM_ACTIVE).toEqual({
      usage_min: null,
      usage_max: null,
      available: true,
      source_ids: ["RM_ACTIVE"],
    });
  });

  it("keys evidence by both the rm_code and the catalogue id", async () => {
    const index = await provider.load_evidence(["RM_ACTIVE"], CONTEXT);
    expect(index[String(ACTIVE_ID)]).toBe(index.RM_ACTIVE);
  });

  it("returns no evidence for an unknown material", async () => {
    const index = await provider.load_evidence(["RM_UNKNOWN"], CONTEXT);
    expect(index.RM_UNKNOWN).toBeUndefined();
  });

  it("returns an empty index for no keys", async () => {
    expect(await provider.load_evidence([], CONTEXT)).toEqual({});
  });
});
