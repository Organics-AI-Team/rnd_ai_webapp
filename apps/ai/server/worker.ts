/** Private, non-HTTP poll loop for durable governed AI run jobs. */

import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { require_server_ai_credentials } from "@rnd-ai/server-config";
import { main_client_promise as client_promise } from "../../../packages/shared-database/src/mongodb/connections";

import { create_production_legacy_run_executor } from "./legacy-run-executor";
import { create_ai_run_repository } from "./repositories/ai-run-repository";
import { create_completed_answer_repository } from "./repositories/conversation-repository";
import { ensure_runtime_indexes } from "./repositories/runtime-indexes";
import { auto_delete_material, auto_index_material } from "./services/auto-index-service";
import { create_event_store } from "./services/ai-gateway/event-store";
import { create_pinned_run_executor } from "./services/ai-gateway/pinned-run-executor";
import { create_production_agentic_run_executor } from "./services/ai-gateway/production-run-runtime";
import { create_run_job_queue } from "./services/ai-gateway/run-job-queue";
import {
  process_one_job,
  type RunWorkerDeps,
} from "./services/ai-gateway/run-worker";

function positive_integer(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid private worker configuration: ${key}`);
  }
  return parsed;
}

function required_bigint(env: NodeJS.ProcessEnv, key: string): bigint {
  const raw = env[key]?.trim();
  if (!raw || !/^\d+$/.test(raw)) {
    throw new Error(`Missing or invalid private worker configuration: ${key}`);
  }
  return BigInt(raw);
}

function required_string(env: NodeJS.ProcessEnv, key: string, fallback?: string): string {
  const value = env[key]?.trim() || fallback;
  if (!value) throw new Error(`Missing private worker configuration: ${key}`);
  return value;
}

function wait(duration_ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, duration_ms));
}

export function should_process_material_index_task(
  consecutive_material_tasks: number,
  max_consecutive_material_tasks: number,
): boolean {
  return consecutive_material_tasks < max_consecutive_material_tasks;
}

function safe_failure_code(error: unknown): string {
  const code =
    error &&
    typeof error === "object" &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "MATERIAL_INDEX_FAILED";
  return /^[A-Z][A-Z0-9_]{1,79}$/.test(code)
    ? code
    : "MATERIAL_INDEX_FAILED";
}

async function process_one_material_index_task(
  db: Db,
  max_attempts: number,
): Promise<boolean> {
  const now = new Date();
  const locked_until = new Date(now.getTime() + 60_000);
  const task = await db.collection("material_index_outbox").findOneAndUpdate(
    {
      $or: [
        { status: "pending", nextAttemptAt: { $lte: now } },
        { status: "processing", lockedUntil: { $lte: now } },
        { status: "processing", lockedUntil: { $exists: false } },
      ],
    },
    {
      $set: { status: "processing", lockedUntil: locked_until, updatedAt: now },
      $inc: { attempts: 1 },
    },
    { sort: { nextAttemptAt: 1 }, returnDocument: "after" },
  );
  if (!task) return false;
  try {
    if (task.operation === "delete") {
      await auto_delete_material(String(task.material?.rm_code ?? ""));
    } else {
      await auto_index_material(task.material as any);
    }
    await db.collection("material_index_outbox").updateOne(
      { _id: task._id, status: "processing", lockedUntil: locked_until },
      {
        $set: { status: "completed", completedAt: new Date(), updatedAt: new Date() },
        $unset: { lockedUntil: "" },
      },
    );
  } catch (error) {
    const attempts = Number(task.attempts ?? 1);
    const terminal = attempts >= max_attempts;
    const failure_code = safe_failure_code(error);
    await db.collection("material_index_outbox").updateOne(
      { _id: task._id, status: "processing", lockedUntil: locked_until },
      {
        $set: terminal
          ? {
              status: "failed",
              failedAt: new Date(),
              lastError: failure_code,
              updatedAt: new Date(),
            }
          : {
              status: "pending",
              nextAttemptAt: new Date(Date.now() + Math.min(300_000, 5_000 * 2 ** attempts)),
              lastError: failure_code,
              updatedAt: new Date(),
            },
        $unset: { lockedUntil: "" },
      },
    );
    console.error({
      boundary: "material-index-worker",
      event: terminal ? "task.failed" : "task.retry_scheduled",
      operation: task.operation,
      task_id: String(task._id),
      attempts,
      error_code: failure_code,
    });
  }
  return true;
}

/** Build the worker from private environment and run until SIGTERM/SIGINT. */
export async function run_private_worker(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const credentials = require_server_ai_credentials(env);
  if (
    Boolean(credentials.google_search_api_key) !==
    Boolean(credentials.google_search_cse_id)
  ) {
    throw new Error(
      "Incomplete private worker configuration: Google Custom Search credentials",
    );
  }
  const client = await client_promise;
  const db = client.db();
  await ensure_runtime_indexes(db);
  const now = () => new Date();
  const runtime_options = {
    gemini_api_key: credentials.gemini_api_key,
    rate_card_version: required_string(
      env,
      "AI_RATE_CARD_VERSION",
      "commercial-2026-07-v1",
    ),
    input_price_microusd_per_million_tokens: required_bigint(
      env,
      "AI_GEMINI_INPUT_PRICE_MICROUSD_PER_MILLION_TOKENS",
    ),
    output_price_microusd_per_million_tokens: required_bigint(
      env,
      "AI_GEMINI_OUTPUT_PRICE_MICROUSD_PER_MILLION_TOKENS",
    ),
    embedding_model: required_string(
      env,
      "AI_EMBEDDING_MODEL",
      "gemini-embedding-001",
    ),
    embedding_version: required_string(env, "AI_EMBEDDING_VERSION", "v1"),
    embedding_dimensions: positive_integer(env, "AI_EMBEDDING_DIMENSIONS", 768),
    ...(credentials.google_search_api_key && credentials.google_search_cse_id
      ? {
          google_search_api_key: credentials.google_search_api_key,
          google_search_cse_id: credentials.google_search_cse_id,
        }
      : {}),
    now,
  };
  const deps: RunWorkerDeps = {
    jobs: create_run_job_queue(db),
    runs: create_ai_run_repository(db),
    events: create_event_store(db),
    executor: create_pinned_run_executor({
      agentic: create_production_agentic_run_executor(client, db, {
        ...runtime_options,
        run_timeout_ms: positive_integer(env, "AI_RUN_TIMEOUT_MS", 300_000),
      }),
      legacy: create_production_legacy_run_executor(db, runtime_options),
    }),
    assistant_messages: create_completed_answer_repository(client, db),
    worker_id: `${hostname()}:${process.pid}:${randomUUID()}`,
    now,
    lease_ms: positive_integer(env, "AI_WORKER_LEASE_MS", 60_000),
    heartbeat_interval_ms: positive_integer(
      env,
      "AI_WORKER_HEARTBEAT_INTERVAL_MS",
      15_000,
    ),
    backoff_ms: positive_integer(env, "AI_WORKER_BACKOFF_MS", 5_000),
    max_attempts: positive_integer(env, "AI_WORKER_MAX_ATTEMPTS", 5),
    max_backoff_ms: positive_integer(env, "AI_WORKER_MAX_BACKOFF_MS", 60_000),
    retry_jitter: Math.random,
  };
  const poll_ms = positive_integer(env, "AI_WORKER_POLL_MS", 500);
  const material_index_max_attempts = positive_integer(
    env,
    "MATERIAL_INDEX_MAX_ATTEMPTS",
    5,
  );
  const material_index_max_consecutive_tasks = positive_integer(
    env,
    "MATERIAL_INDEX_MAX_CONSECUTIVE_TASKS",
    10,
  );
  let stopping = false;
  let consecutive_material_tasks = 0;
  const stop = () => { stopping = true; };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  console.info({ boundary: "ai-worker", event: "worker.started", worker_id: deps.worker_id });
  while (!stopping) {
    try {
      if (
        should_process_material_index_task(
          consecutive_material_tasks,
          material_index_max_consecutive_tasks,
        ) &&
        await process_one_material_index_task(db, material_index_max_attempts)
      ) {
        consecutive_material_tasks += 1;
        continue;
      }
      const outcome = await process_one_job(deps);
      consecutive_material_tasks = 0;
      if (!outcome.processed) {
        if (await process_one_material_index_task(db, material_index_max_attempts)) {
          consecutive_material_tasks = 1;
          continue;
        }
        await wait(poll_ms);
      }
    } catch (error) {
      console.error({
        boundary: "ai-worker",
        event: "worker.poll_failed",
        error_code: safe_failure_code(error),
        error_name: error instanceof Error ? error.name : "unknown",
      });
      await wait(poll_ms);
    }
  }
  console.info({ boundary: "ai-worker", event: "worker.stopped", worker_id: deps.worker_id });
}

if (require.main === module) {
  run_private_worker().catch((error: unknown) => {
    // Config-invariant messages name env KEYS, never secret values — safe to
    // log, and without it a fail-closed boot is undiagnosable from container
    // logs (observed: silent crash-loop on a half-set Google Search pair).
    console.error({
      boundary: "ai-worker",
      event: "worker.start_failed",
      reason: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
}
