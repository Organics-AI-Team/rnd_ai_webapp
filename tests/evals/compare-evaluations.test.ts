import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  compare_evaluation_artifacts,
  main,
  parse_compare_args,
} from "../../evals/runner/compare-evaluations";

const temporary_directories: string[] = [];

/** Create an isolated report directory removed after each test. */
async function reports_directory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "commercial-eval-"));
  temporary_directories.push(directory);
  return directory;
}

/** Build the minimum frozen-baseline artifact consumed by the comparator. */
function baseline(
  task_success_rate = 0.6,
  evidence_class: "reviewed_release" | "credential_free_test" = "reviewed_release",
): Record<string, unknown> {
  return {
    schema_version: "1",
    artifact_name: "legacy-frozen",
    executor: "legacy",
    evidence_class,
    task_success_rate,
  };
}

/** Build a complete candidate artifact at every approved release boundary. */
function candidate(
  overrides: Record<string, unknown> = {},
  evidence_class: "reviewed_release" | "credential_free_test" = "reviewed_release",
): Record<string, unknown> {
  return {
    schema_version: "1",
    artifact_name: "ooda-current",
    executor: "agentic",
    evidence_class,
    metrics: {
      cross_tenant_disclosures: 0,
      unauthorized_side_effects: 0,
      approval_bypasses: 0,
      hard_budget_bypasses: 0,
      formula_validity_rate: 1,
      evidence_coverage_rate: 0.95,
      task_success_rate: 0.7,
      schema_valid_terminal_rate: 0.99,
      event_sequence_integrity_rate: 1,
      usage_reconciliation_rate: 1,
      accepted_event_p95_ms: 2_000,
      simple_answer_completion_p95_ms: 30_000,
      formula_workflow_p95_ms: 90_000,
      cost_per_success_microusd: 25_000,
      approved_cost_per_success_microusd: 25_000,
      signed_cost_exception: false,
      ...overrides,
    },
  };
}

/** Persist one JSON artifact under its stable commercial name. */
async function write_artifact(
  directory: string,
  name: string,
  value: Record<string, unknown>,
): Promise<void> {
  await writeFile(join(directory, `${name}.json`), JSON.stringify(value), "utf8");
}

afterEach(async () => {
  await Promise.all(
    temporary_directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("commercial evaluation comparison CLI", () => {
  it("parses exactly one safe baseline and candidate artifact name", () => {
    expect(
      parse_compare_args([
        "--baseline=legacy-frozen",
        "--candidate=ooda-current",
      ]),
    ).toEqual({ baseline: "legacy-frozen", candidate: "ooda-current" });
    expect(() => parse_compare_args(["--baseline=../secret", "--candidate=x"]))
      .toThrow("commercial evaluation arguments are invalid");
    expect(() => parse_compare_args(["--baseline=legacy-frozen"]))
      .toThrow("commercial evaluation arguments are invalid");
  });

  it("passes only when every existing release threshold passes", async () => {
    const directory = await reports_directory();
    await write_artifact(directory, "legacy-frozen", baseline());
    await write_artifact(directory, "ooda-current", candidate());

    const result = await compare_evaluation_artifacts(
      { baseline: "legacy-frozen", candidate: "ooda-current" },
      directory,
    );

    expect(result.passed).toBe(true);
    expect(result.summary).toMatchObject({
      baseline: "legacy-frozen",
      candidate: "ooda-current",
      passed: true,
      failed_checks: [],
    });
    expect(result.summary).not.toHaveProperty("case_results");
  });

  it("fails closed for a failed gate or a missing named artifact", async () => {
    const directory = await reports_directory();
    await write_artifact(directory, "legacy-frozen", baseline());
    await write_artifact(
      directory,
      "ooda-current",
      candidate({ cross_tenant_disclosures: 1 }),
    );

    const failed = await compare_evaluation_artifacts(
      { baseline: "legacy-frozen", candidate: "ooda-current" },
      directory,
    );
    expect(failed.passed).toBe(false);
    expect(failed.summary.failed_checks).toContain("cross_tenant_disclosures");

    await expect(
      compare_evaluation_artifacts(
        { baseline: "legacy-frozen", candidate: "missing-candidate" },
        directory,
      ),
    ).rejects.toThrow("commercial evaluation artifact is unavailable");
  });

  it("keeps credential-free campaign evidence out of the reviewed release gate", async () => {
    const directory = await reports_directory();
    await write_artifact(
      directory,
      "legacy-frozen",
      baseline(0.6, "credential_free_test"),
    );
    await write_artifact(
      directory,
      "ooda-current",
      candidate({}, "credential_free_test"),
    );

    await expect(
      compare_evaluation_artifacts(
        { baseline: "legacy-frozen", candidate: "ooda-current" },
        directory,
      ),
    ).rejects.toThrow("commercial evaluation evidence class is invalid");
    await expect(
      compare_evaluation_artifacts(
        { baseline: "legacy-frozen", candidate: "ooda-current" },
        directory,
        "credential_free_test",
      ),
    ).resolves.toMatchObject({ passed: true });
  });

  it("sets a non-zero process status when any release gate fails", async () => {
    const directory = await reports_directory();
    await write_artifact(directory, "legacy-frozen", baseline());
    await write_artifact(
      directory,
      "ooda-current",
      candidate({ approval_bypasses: 1 }),
    );
    const original_exit_code = process.exitCode;
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.stubEnv("COMMERCIAL_TEST_ADAPTER_MODE", "");
    process.exitCode = undefined;
    try {
      await main(
        ["--baseline=legacy-frozen", "--candidate=ooda-current"],
        directory,
      );
      expect(process.exitCode).toBe(1);
      expect(String(write.mock.calls[0]?.[0])).toContain('"passed":false');
    } finally {
      process.exitCode = original_exit_code;
      write.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
