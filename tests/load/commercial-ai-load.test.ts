/** Deterministic in-process commercial AI load harness contract (G5.8). */

import { describe, expect, it } from "vitest";

import {
  resilience_expectations,
  run_commercial_load_campaign,
  run_commercial_synthetic_load,
} from "./commercial-ai-load";
import {
  parse_load_args,
  run_quietly,
} from "../../scripts/run-commercial-load";

describe("commercial synthetic load", () => {
  it("pins the Task 8 correctness and latency expectations", () => {
    expect(resilience_expectations).toEqual({
      concurrent_event_streams: 50,
      accepted_event_p95_ms: 2_000,
      simple_completion_p95_ms: 30_000,
      formula_completion_p95_ms: 90_000,
      duplicate_commits: 0,
      cross_tenant_events: 0,
      unreconciled_usage_entries: 0,
    });
  });

  it("runs 50 tenant-scoped reconnect streams with zero correctness violations", async () => {
    const result = await run_commercial_synthetic_load({ run_number: 1 });

    expect(result.mode).toBe("synthetic_in_process");
    expect(result.concurrent_event_streams).toBe(50);
    expect(result.accepted_latency_ms.sample_count).toBe(50);
    expect(result.simple_completion_latency_ms.sample_count).toBe(40);
    expect(result.formula_completion_latency_ms.sample_count).toBe(10);
    expect(result.reconnected_event_frames).toBe(100);
    expect(result.errors).toBe(0);
    expect(result.duplicate_commits).toBe(0);
    expect(result.cross_tenant_events).toBe(0);
    expect(result.unreconciled_usage_entries).toBe(0);
    expect(result.accepted_latency_ms.p95).toBeLessThanOrEqual(2_000);
    expect(result.simple_completion_latency_ms.p95).toBeLessThanOrEqual(30_000);
    expect(result.formula_completion_latency_ms.p95).toBeLessThanOrEqual(90_000);
    expect(result.result_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.passed).toBe(true);
  });

  it("reports the worst of repeated synthetic runs", async () => {
    const campaign = await run_commercial_load_campaign({ repetitions: 2 });

    expect(campaign.repetitions).toBe(2);
    expect(campaign.runs).toHaveLength(2);
    expect(campaign.worst.accepted_event_p95_ms).toBe(
      Math.max(...campaign.runs.map((run) => run.accepted_latency_ms.p95)),
    );
    expect(campaign.worst.simple_completion_p95_ms).toBe(
      Math.max(...campaign.runs.map((run) => run.simple_completion_latency_ms.p95)),
    );
    expect(campaign.worst.formula_completion_p95_ms).toBe(
      Math.max(...campaign.runs.map((run) => run.formula_completion_latency_ms.p95)),
    );
    expect(campaign.result_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(campaign.passed).toBe(true);
  });
});

describe("commercial load CLI arguments", () => {
  it("accepts a bounded repetition count and defaults to three", () => {
    expect(parse_load_args([])).toEqual({ repetitions: 3 });
    expect(parse_load_args(["--repetitions=1"])).toEqual({ repetitions: 1 });
    expect(parse_load_args(["--repetitions=10"])).toEqual({ repetitions: 10 });
  });

  it.each([
    ["--repetitions=0"],
    ["--repetitions=11"],
    ["--repetitions=1.5"],
    ["--unknown=3"],
  ])("rejects unsupported load arguments: %s", (argument) => {
    expect(() => parse_load_args([argument])).toThrow("commercial load arguments are invalid");
  });

  it("suppresses coordinator info logs during a campaign and restores the logger", async () => {
    const original = console.info;
    let calls = 0;
    const recording_logger = () => {
      calls += 1;
    };
    console.info = recording_logger;
    try {
      const result = await run_quietly(async () => {
        console.info("synthetic coordinator log");
        return 42;
      });
      expect(result).toBe(42);
      expect(calls).toBe(0);
      expect(console.info).toBe(recording_logger);
    } finally {
      console.info = original;
    }
  });
});
