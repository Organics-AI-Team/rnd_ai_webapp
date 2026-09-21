import { ObjectId, type Document, type WithId } from "mongodb";
import { describe, expect, it, vi } from "vitest";

import {
  PinnedExecutorMismatchError,
  create_pinned_run_executor,
} from "../../apps/ai/server/services/ai-gateway/pinned-run-executor";
import type { ClaimedRunJob } from "../../apps/ai/server/services/ai-gateway/run-job-queue";
import type { RunExecutor } from "../../apps/ai/server/services/ai-gateway/run-worker";

const run_id = "507f1f77bcf86cd7994390e1";
const job: ClaimedRunJob = {
  job_id: "job-a",
  tenant_id: "tenant-a",
  run_id,
  command: "start",
  attempts: 1,
};

function run(executor: string): WithId<Document> {
  return { _id: new ObjectId(run_id), tenantId: "tenant-a", executor };
}

function fake(status: "completed" | "failed"): RunExecutor & { execute: ReturnType<typeof vi.fn> } {
  return {
    execute: vi.fn(async () => ({ status, events: [] })),
  } as RunExecutor & { execute: ReturnType<typeof vi.fn> };
}

describe("pinned run executor", () => {
  it("dispatches agentic and legacy runs only to their stored executor", async () => {
    const agentic = fake("completed");
    const legacy = fake("completed");
    const dispatcher = create_pinned_run_executor({ agentic, legacy });

    await dispatcher.execute(job, run("agentic"));
    await dispatcher.execute(job, run("legacy"));

    expect(agentic.execute).toHaveBeenCalledTimes(1);
    expect(legacy.execute).toHaveBeenCalledTimes(1);
  });

  it("fails closed for an unknown pin and never falls back", async () => {
    const agentic = fake("completed");
    const legacy = fake("completed");
    const dispatcher = create_pinned_run_executor({ agentic, legacy });

    await expect(dispatcher.execute(job, run("other"))).rejects.toBeInstanceOf(
      PinnedExecutorMismatchError,
    );
    expect(agentic.execute).not.toHaveBeenCalled();
    expect(legacy.execute).not.toHaveBeenCalled();
  });
});
