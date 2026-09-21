/**
 * Server-sent-events serialization for the run events route (G4.9g).
 *
 * Pure helpers the `GET /api/ai/runs/[runId]/events` route uses to turn versioned
 * run events into an ordered SSE stream and to resume from a client's
 * Last-Event-ID. The event's `sequence` is the SSE `id:`, so a native
 * EventSource reconnect replays from exactly the last delivered event; the
 * event-store and the client reducer both dedupe by sequence, so replay is
 * idempotent. No credentials, no framework, no I/O.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import type { AgentRunEventV1 } from "@rnd-ai/shared-types/src/ai/contracts";

/** The SSE comment line sent as a keep-alive heartbeat. */
export const SSE_HEARTBEAT = ": heartbeat\n\n";

/**
 * Serialize one run event as an SSE frame, using its sequence as the event id.
 *
 * @param event - The versioned run event.
 * @returns An `id:`/`event:`/`data:` SSE frame terminated by a blank line.
 */
export function format_sse_frame(event: AgentRunEventV1): string {
  return `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Parse a client's Last-Event-ID into the exclusive replay lower bound.
 *
 * @param last_event_id - The `Last-Event-ID` header (or query param), or null.
 * @returns The sequence to replay strictly after; -1 when absent or malformed,
 *          so the full stream replays from the beginning.
 */
export function parse_last_event_id(last_event_id: string | null | undefined): number {
  if (last_event_id === null || last_event_id === undefined || last_event_id === "") {
    return -1;
  }
  const parsed = Number(last_event_id);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : -1;
}
