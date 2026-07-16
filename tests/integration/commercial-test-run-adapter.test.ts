import { beforeEach, describe, expect, it } from "vitest";

import {
  create_commercial_test_run,
  reset_commercial_test_runs,
  resume_commercial_test_run,
  stream_commercial_test_run,
} from "../../apps/web/lib/server/commercial-test-run-adapter";

/** Build a strict public run input for one deterministic adapter scenario. */
function input(
  message: string,
  agent_key: "raw_material_research" | "formulation" | "sales_rnd" = "raw_material_research",
) {
  return {
    schema_version: "1",
    thread_id: `thread_${agent_key}`,
    agent_key,
    message,
    attachment_source_ids: [],
    response_preferences: { language: "en", detail: "standard" },
    idempotency_key: `idem_${agent_key}_12345678`,
  } as const;
}

/** Decode typed event objects from a deterministic SSE response. */
async function events(response: Response): Promise<Array<Record<string, unknown>>> {
  return (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

beforeEach(() => reset_commercial_test_runs());

describe("credential-free governed-run HTTP adapter", () => {
  it.each([
    ["raw_material_research", "knowledge.search"],
    ["formulation", "formula.search"],
    ["sales_rnd", "web.search"],
  ] as const)("completes %s with typed evidence and %s", async (agent_key, tool_name) => {
    const created = await create_commercial_test_run(
      input("scenario:normal", agent_key),
      "tenant_a",
    );
    expect(created.status).toBe(202);
    const accepted = await created.json() as { run_id: string };

    const streamed = await events(
      await stream_commercial_test_run(accepted.run_id, "tenant_a", null),
    );
    expect(streamed.map(({ type }) => type)).toEqual([
      "run.accepted",
      "action.started",
      "action.completed",
      "observation.added",
      "usage.updated",
      "run.completed",
    ]);
    expect(streamed.find(({ type }) => type === "action.completed"))
      .toMatchObject({ payload: { tool_name } });
    expect(streamed.at(-1)).toMatchObject({
      payload: {
        output: {
          answer: expect.any(String),
          citations: [{ source_id: expect.any(String) }],
        },
      },
    });
    expect(JSON.stringify(streamed)).not.toMatch(/chain.of.thought|hidden_reasoning/i);
  });

  it("moves formulation from one clarification to manager approval and confirmed artifact", async () => {
    const created = await create_commercial_test_run(
      input("scenario:clarification_approval", "formulation"),
      "tenant_a",
    );
    const { run_id } = await created.json() as { run_id: string };
    expect((await events(await stream_commercial_test_run(run_id, "tenant_a", null))).at(-1))
      .toMatchObject({ type: "clarification.required" });

    const clarified = await resume_commercial_test_run(
      run_id,
      "tenant_a",
      "student",
      { kind: "clarification", answer: "Target 5% niacinamide.", idempotency_key: "resume_clarify_123" },
    );
    expect(clarified.status).toBe(202);
    const after_clarification = await events(
      await stream_commercial_test_run(run_id, "tenant_a", "1"),
    );
    expect(after_clarification.at(-1)).toMatchObject({ type: "approval.required" });

    const student_approval = await resume_commercial_test_run(
      run_id,
      "tenant_a",
      "student",
      { kind: "approval", approval_id: `approval_${run_id}`, decision: "approve", idempotency_key: "resume_approve_123" },
    );
    expect(student_approval.status).toBe(403);
    const manager_approval = await resume_commercial_test_run(
      run_id,
      "tenant_a",
      "manager",
      { kind: "approval", approval_id: `approval_${run_id}`, decision: "approve", idempotency_key: "resume_approve_123" },
    );
    expect(manager_approval.status).toBe(202);
    const completed = await events(
      await stream_commercial_test_run(run_id, "tenant_a", "7"),
    );
    expect(completed.map(({ type }) => type)).toContain("artifact.updated");
    expect(completed.at(-1)).toMatchObject({
      type: "run.completed",
      payload: { output: { artifacts: [{ status: "confirmed" }] } },
    });
  });

  it("replays only events after Last-Event-ID and denies cross-tenant reads", async () => {
    const created = await create_commercial_test_run(
      input("scenario:reconnect"),
      "tenant_a",
    );
    const { run_id } = await created.json() as { run_id: string };
    expect(await events(await stream_commercial_test_run(run_id, "tenant_a", null)))
      .toHaveLength(3);
    const replay = await events(
      await stream_commercial_test_run(run_id, "tenant_a", "2"),
    );
    expect(replay[0]?.sequence).toBe(3);
    expect(replay.at(-1)?.type).toBe("run.completed");
    expect((await stream_commercial_test_run(run_id, "tenant_b", null)).status).toBe(404);
  });

  it.each([
    ["scenario:budget", "LIMIT_COST"],
    ["scenario:emergency", "POLICY_EMERGENCY_DISABLED"],
  ])("fails %s with the safe typed code %s", async (scenario, code) => {
    const created = await create_commercial_test_run(input(scenario), "tenant_a");
    const { run_id } = await created.json() as { run_id: string };
    const streamed = await events(
      await stream_commercial_test_run(run_id, "tenant_a", null),
    );
    expect(streamed.at(-1)).toMatchObject({ type: "run.failed", payload: { code } });
  });
});
