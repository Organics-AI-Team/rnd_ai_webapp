'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import {
  AgentRunClientError,
  create_agent_run_client,
  type AgentRunClient,
  type AgentRunStartInput,
} from '../lib/agent_run_client';
import {
  initial_agent_run_view_state,
  reduce_run_event,
  type AgentRunViewState,
} from '../lib/agent_run_view';

/** Internal reset/event actions for the reducer-backed hook. */
type HookAction =
  | { readonly type: 'reset' }
  | { readonly type: 'event'; readonly event: unknown };

/** Reset or fold one validated run event into hook state. */
function run_state_reducer(state: AgentRunViewState, action: HookAction): AgentRunViewState {
  return action.type === 'reset'
    ? initial_agent_run_view_state
    : reduce_run_event(state, action.event);
}

/** Generate a browser-owned idempotency key with no identity content. */
function create_idempotency_key(): string {
  return globalThis.crypto.randomUUID();
}

/** Create the production client over browser fetch and EventSource. */
function create_browser_client(): AgentRunClient {
  return create_agent_run_client({
    fetch: globalThis.fetch.bind(globalThis),
    create_event_source: (url, init) => new EventSource(url, init),
    create_idempotency_key,
  });
}

/** The governed run state and typed actions consumed by AI pages. */
export interface UseAgentRunResult {
  readonly state: AgentRunViewState;
  readonly run_id: string | null;
  readonly is_starting: boolean;
  readonly is_resuming: boolean;
  readonly is_streaming: boolean;
  readonly client_error: AgentRunClientError | null;
  readonly start_run: (input: AgentRunStartInput) => Promise<void>;
  readonly submit_clarification: (answer: string) => Promise<void>;
  readonly submit_approval: (approval_id: string, decision: 'approve' | 'deny') => Promise<void>;
  readonly cancel_stream: () => void;
  readonly reset_run: () => void;
}

/**
 * Create and observe one governed agent run at a time.
 *
 * The underlying client validates every named SSE event, closes a replaced or
 * cancelled stream, and submits only strict actor-free resume payloads.
 *
 * @returns Reducer-backed typed run state and create/resume/stream actions.
 */
export function useAgentRun(): UseAgentRunResult {
  const [state, dispatch] = useReducer(run_state_reducer, initial_agent_run_view_state);
  const [run_id, set_run_id] = useState<string | null>(null);
  const [is_starting, set_is_starting] = useState(false);
  const [is_resuming, set_is_resuming] = useState(false);
  const [is_streaming, set_is_streaming] = useState(false);
  const [client_error, set_client_error] = useState<AgentRunClientError | null>(null);
  const client_ref = useRef<AgentRunClient | null>(null);
  if (client_ref.current === null) client_ref.current = create_browser_client();

  /** Convert unknown failures to the typed UI error surface. */
  const record_error = useCallback((error: unknown, operation: 'create' | 'resume'): void => {
    const typed = error instanceof AgentRunClientError
      ? error
      : new AgentRunClientError(
          operation === 'create' ? 'RUN_CREATE_FAILED' : 'RUN_RESUME_FAILED',
          operation === 'create' ? 'The AI run could not be started.' : 'The AI run could not be resumed.',
          operation,
          null,
          true,
        );
    set_client_error(typed);
    console.error('[use_agent_run] request failed', typed);
  }, []);

  /** Start a new run, resetting all state before its create request. */
  const start_run = useCallback(async (input: AgentRunStartInput): Promise<void> => {
    set_is_starting(true);
    set_client_error(null);
    try {
      const accepted = await client_ref.current!.start_run(input, {
        on_reset: () => {
          dispatch({ type: 'reset' });
          set_run_id(null);
          set_is_streaming(false);
        },
        on_event: (event) => {
          dispatch({ type: 'event', event });
          set_client_error((previous) => previous?.operation === 'stream' ? null : previous);
          if (event.type === 'run.completed' || event.type === 'run.failed') set_is_streaming(false);
        },
        on_error: (error) => set_client_error(error),
      });
      set_run_id(accepted.run_id);
      set_is_streaming(true);
      console.info('[use_agent_run] run started', { run_id: accepted.run_id });
    } catch (error) {
      record_error(error, 'create');
    } finally {
      set_is_starting(false);
    }
  }, [record_error]);

  /** Submit the current run's clarification answer. */
  const submit_clarification = useCallback(async (answer: string): Promise<void> => {
    set_is_resuming(true);
    set_client_error(null);
    try {
      await client_ref.current!.submit_clarification(answer);
    } catch (error) {
      record_error(error, 'resume');
    } finally {
      set_is_resuming(false);
    }
  }, [record_error]);

  /** Submit a manager approval/denial without any client identity field. */
  const submit_approval = useCallback(async (
    approval_id: string,
    decision: 'approve' | 'deny',
  ): Promise<void> => {
    set_is_resuming(true);
    set_client_error(null);
    try {
      await client_ref.current!.submit_approval(approval_id, decision);
    } catch (error) {
      record_error(error, 'resume');
    } finally {
      set_is_resuming(false);
    }
  }, [record_error]);

  /** Close only the browser stream; the server run continues. */
  const cancel_stream = useCallback((): void => {
    client_ref.current!.cancel_stream();
    set_is_streaming(false);
  }, []);

  /** Clear the current run when navigating conversations. */
  const reset_run = useCallback((): void => {
    cancel_stream();
    dispatch({ type: 'reset' });
    set_run_id(null);
    set_client_error(null);
  }, [cancel_stream]);

  useEffect(() => () => client_ref.current?.cancel_stream(), []);

  return {
    state,
    run_id,
    is_starting,
    is_resuming,
    is_streaming,
    client_error,
    start_run,
    submit_clarification,
    submit_approval,
    cancel_stream,
    reset_run,
  };
}
