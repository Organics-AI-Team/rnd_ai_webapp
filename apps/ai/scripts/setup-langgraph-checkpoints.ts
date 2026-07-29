/**
 * Deployment step: initialize/verify the LangGraph MongoDB checkpoint saver.
 *
 * Run explicitly during deployment (never as a module-import side effect):
 *   tsx apps/ai/scripts/setup-langgraph-checkpoints.ts
 *
 * Connects with MONGODB_URI, constructs the MongoDBSaver against the langgraph
 * database, and runs its setup() so the checkpoint collections/indexes exist.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { MongoClient } from "mongodb";
import {
  LANGGRAPH_CHECKPOINT_DB,
  get_mongodb_saver,
} from "../../../packages/ai-orchestration/src/checkpoint";

/**
 * Initialize the checkpoint saver collections/indexes.
 *
 * @returns Resolves when setup completes.
 * @throws Error when MONGODB_URI is not set or the connection fails.
 */
async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is required to set up LangGraph checkpoints.");
  }
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const saver = (await get_mongodb_saver(client, LANGGRAPH_CHECKPOINT_DB)) as {
      setup?: () => Promise<void>;
    };
    if (typeof saver.setup === "function") {
      await saver.setup();
    }
    console.log(
      `[setup-langgraph-checkpoints] ready — db "${LANGGRAPH_CHECKPOINT_DB}"`,
    );
  } finally {
    await client.close();
  }
}

const invoked_directly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  /setup-langgraph-checkpoints\.ts$/.test(process.argv[1] ?? "");

if (invoked_directly) {
  main().catch((error) => {
    console.error("[setup-langgraph-checkpoints] failed:", error);
    process.exitCode = 1;
  });
}

export { main as setup_langgraph_checkpoints };
