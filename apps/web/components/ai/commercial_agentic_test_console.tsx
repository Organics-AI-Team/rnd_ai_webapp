'use client';

import { useCallback, useState } from 'react';

import type { AgentKeyV1 } from '@rnd-ai/shared-types/src/ai/contracts';

import { useAgentRun } from '@/hooks/use_agent_run';
import { AiRunView } from './ai_run_view';

/** Props supplied by the guarded server-only commercial test page. */
export interface CommercialAgenticTestConsoleProps {
  readonly initial_is_manager: boolean;
}

/**
 * Minimal browser console for all three governed agents and interrupt states.
 *
 * This component is rendered only by the non-production credential-free page;
 * it deliberately reuses the production hook, client, reducer, and run cards.
 */
export function CommercialAgenticTestConsole({
  initial_is_manager,
}: CommercialAgenticTestConsoleProps) {
  const agent_run = useAgentRun();
  const [agent_key, set_agent_key] = useState<AgentKeyV1>('raw_material_research');
  const [message, set_message] = useState('scenario:normal');
  const [is_manager, set_is_manager] = useState(initial_is_manager);
  const [mounted, set_mounted] = useState(false);

  const mark_mounted = useCallback((node: HTMLElement | null) => {
    if (node) set_mounted(true);
  }, []);

  /** Start the selected synthetic scenario through the production browser client. */
  async function start_run(): Promise<void> {
    await agent_run.start_run({
      thread_id: `commercial_test_thread_${agent_key}`,
      agent_key,
      message,
      attachment_source_ids: [],
      response_preferences: { language: 'en', detail: 'standard' },
    });
  }

  return (
    <main ref={mark_mounted} className="mx-auto max-w-3xl space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Agentic test console</h1>
        <p className="mt-1 text-sm text-gray-500">
          Credential-free contract runner for local and CI verification only.
        </p>
        {mounted && <span className="sr-only" data-testid="commercial-test-ready">Ready</span>}
      </div>

      <section className="grid gap-4 rounded-lg border border-gray-200 p-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium">
          <span>Agent</span>
          <select
            aria-label="Agent"
            value={agent_key}
            onChange={(event) => set_agent_key(event.target.value as AgentKeyV1)}
            className="block w-full rounded-md border border-gray-300 bg-white p-2"
          >
            <option value="raw_material_research">Raw material research</option>
            <option value="formulation">Formulation</option>
            <option value="sales_rnd">Sales R&amp;D</option>
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span>Scenario message</span>
          <input
            aria-label="Scenario message"
            value={message}
            onChange={(event) => set_message(event.target.value)}
            className="block w-full rounded-md border border-gray-300 p-2"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-label="Render as manager"
            checked={is_manager}
            onChange={(event) => set_is_manager(event.target.checked)}
          />
          Render as manager
        </label>
        <button
          type="button"
          onClick={() => void start_run()}
          disabled={!mounted || agent_run.is_starting || message.trim().length === 0}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Start governed run
        </button>
      </section>

      {agent_run.run_id && (
        <p className="font-mono text-xs text-gray-500" data-testid="commercial-test-run-id">
          {agent_run.run_id}
        </p>
      )}
      <AiRunView
        state={agent_run.state}
        client_error={agent_run.client_error}
        is_streaming={agent_run.is_streaming}
        is_resuming={agent_run.is_resuming}
        is_manager={is_manager}
        on_clarification={agent_run.submit_clarification}
        on_approval={agent_run.submit_approval}
        on_cancel_stream={agent_run.cancel_stream}
      />
    </main>
  );
}
