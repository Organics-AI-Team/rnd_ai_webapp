/**
 * G4.9g — SSE serialization + Last-Event-ID parsing for the events route.
 */

import { describe, expect, it } from "vitest";

import {
  format_sse_frame,
  parse_last_event_id,
} from "../../apps/ai/server/services/ai-gateway/sse";
import type { AgentRunEventV1 } from "@rnd-ai/shared-types/src/ai/contracts";

const EVENT = {
  schema_version: "1",
  event_id: "e1",
  run_id: "run_1",
  sequence: 4,
  occurred_at: "2026-07-15T00:00:00.000Z",
  type: "stage.changed",
  payload: { stage: "acting" },
} as AgentRunEventV1;

describe("format_sse_frame", () => {
  it("uses the sequence as the SSE id and JSON-encodes the event", () => {
    const frame = format_sse_frame(EVENT);
    expect(frame.startsWith("id: 4\nevent: stage.changed\ndata: ")).toBe(true);
    expect(frame.endsWith("\n\n")).toBe(true);
    const data = frame.split("data: ")[1].trimEnd();
    expect(JSON.parse(data)).toEqual(EVENT);
  });
});

describe("parse_last_event_id", () => {
  it("returns the sequence for a valid id", () => {
    expect(parse_last_event_id("7")).toBe(7);
    expect(parse_last_event_id("0")).toBe(0);
  });

  it("returns -1 (replay from start) for absent or malformed ids", () => {
    expect(parse_last_event_id(null)).toBe(-1);
    expect(parse_last_event_id("")).toBe(-1);
    expect(parse_last_event_id("nope")).toBe(-1);
    expect(parse_last_event_id("-2")).toBe(-1);
  });
});
