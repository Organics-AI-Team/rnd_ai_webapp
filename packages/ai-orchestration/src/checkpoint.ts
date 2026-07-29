/**
 * Durable checkpointing for the governed loop (G4.7).
 *
 * Builds the LangGraph thread ID from INTERNAL tenant + thread IDs only (never a
 * client-controlled raw key) and provides a lazy MongoDBSaver getter so the
 * checkpoint package is loaded as a deployment concern, not a module-import side
 * effect. Tests use an in-memory saver via the same thread-config helper.
 */

import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { MongoClient } from "mongodb";

// Re-export the loop's own LangGraph primitives so callers (and tests) resolve
// the SAME module instance the compiled graph uses — avoiding a MemorySaver/
// Command version skew across duplicate installs.
export { Command, MemorySaver } from "@langchain/langgraph";

/** Database that holds the LangGraph checkpoint collections. */
export const LANGGRAPH_CHECKPOINT_DB = "langgraph";

/**
 * Build the durable thread ID from internal identifiers only. A client can
 * never supply this key; it is derived from the verified tenant and the
 * server-resolved thread ID.
 *
 * @param tenant_id - Verified internal tenant ID.
 * @param thread_id - Internal conversation thread ID.
 * @returns The namespaced checkpoint thread key.
 */
export function build_checkpoint_thread_id(
  tenant_id: string,
  thread_id: string,
): string {
  return `tenant:${tenant_id}::thread:${thread_id}`;
}

/**
 * LangGraph recursion backstop, far above the governor's own iteration,
 * budget, and deadline limits — those are the real stop conditions. The
 * default (25) fired BEFORE the governor on productive multi-tool runs:
 * one loop iteration spans several graph nodes, so 16 policy iterations
 * need well over 25 super-steps. Overridable for tests via env.
 */
const GRAPH_RECURSION_LIMIT = Number(
  process.env.AI_GRAPH_RECURSION_LIMIT ?? 250,
);

/**
 * Build the LangGraph thread config for invoke/stream/resume.
 *
 * @param tenant_id - Verified internal tenant ID.
 * @param thread_id - Internal conversation thread ID.
 * @returns The `{ configurable, recursionLimit }` config.
 */
export function build_thread_config(
  tenant_id: string,
  thread_id: string,
): { configurable: { thread_id: string }; recursionLimit: number } {
  return {
    configurable: { thread_id: build_checkpoint_thread_id(tenant_id, thread_id) },
    recursionLimit: GRAPH_RECURSION_LIMIT,
  };
}

/**
 * Lazily construct the MongoDB checkpoint saver. The checkpoint package is
 * imported on demand so a deployment without it never fails at module load.
 *
 * @param client - Connected MongoClient owned by the gateway.
 * @param db_name - Checkpoint database name (defaults to LANGGRAPH_CHECKPOINT_DB).
 * @returns A checkpoint saver ready to compile the graph with.
 */
export async function get_mongodb_saver(
  client: MongoClient,
  db_name: string = LANGGRAPH_CHECKPOINT_DB,
): Promise<BaseCheckpointSaver> {
  const module = await import("@langchain/langgraph-checkpoint-mongodb");
  return new module.MongoDBSaver({ client, dbName: db_name });
}
