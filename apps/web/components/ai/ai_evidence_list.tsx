'use client';

import React from 'react';
import { FileText } from 'lucide-react';
import type { RunObservationView } from '../../lib/agent_run_view';

/**
 * Props for {@link AiEvidenceList}.
 */
interface AiEvidenceListProps {
  /** The run's observations (from typed events). */
  observations: readonly RunObservationView[];
}

/**
 * Lists the tool- and knowledge-sourced observations of a run as evidence.
 * Purely presentational: it renders only the reducer's typed observation state
 * and shows the source's trust label so untrusted content is visibly marked.
 *
 * @param props - The run observations.
 * @returns The evidence list element, or null when there is no evidence.
 */
export function AiEvidenceList({ observations }: AiEvidenceListProps): React.ReactElement | null {
  const evidence = observations.filter(
    (observation) => observation.source_kind === 'tool' || observation.source_kind === 'knowledge',
  );
  if (evidence.length === 0) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4" data-testid="ai-evidence-list">
      <div className="flex items-center gap-2 text-gray-700">
        <FileText className="h-4 w-4" />
        <span className="font-medium">Evidence</span>
      </div>
      <ul className="mt-2 space-y-1 text-sm text-gray-600">
        {evidence.map((observation) => (
          <li key={observation.observation_id} className="flex items-center justify-between">
            <span>{observation.tool_name ?? observation.source_kind}</span>
            <span className="text-xs text-gray-400">
              {observation.observation_type} · {observation.trust}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
