'use client';

import { useEffect, useReducer } from 'react';

import {
  initial_agent_run_view_state,
  reduce_run_event,
  type AgentRunViewState,
} from '../lib/agent_run_view';

/**
 * The result of subscribing to a governed run's event stream.
 */
export interface UseAgentRunResult {
  /** The view state folded from every event received so far. */
  state: AgentRunViewState;
}

/**
 * Subscribe to a run's versioned server-event stream and fold it into view
 * state with {@link reduce_run_event}.
 *
 * A native `EventSource` handles reconnection and Last-Event-ID replay; the
 * reducer drops any already-seen sequence, so a reconnect that replays earlier
 * events is idempotent ("render each event once"). No control state is derived
 * from prose — only from typed events. Passing `null` unsubscribes.
 *
 * @param events_url - The run's SSE events URL, or null to not subscribe.
 * @returns The current folded view state.
 */
export function use_agent_run(events_url: string | null): UseAgentRunResult {
  const [state, dispatch] = useReducer(reduce_run_event, initial_agent_run_view_state);

  useEffect(() => {
    if (!events_url) return undefined;
    const source = new EventSource(events_url, { withCredentials: true });
    const handle = (event: MessageEvent): void => {
      try {
        dispatch(JSON.parse(event.data));
      } catch {
        // A malformed frame is ignored; reduce_run_event also fails closed.
      }
    };
    source.addEventListener('message', handle);
    return () => {
      source.removeEventListener('message', handle);
      source.close();
    };
  }, [events_url]);

  return { state };
}
