'use client';

import React from 'react';
import { FileText } from 'lucide-react';
import type { RunObservationView } from '../../lib/agent_run_view';
import type { CitationV1 } from '@rnd-ai/shared-types/src/ai/contracts';
import { Surface } from '@/components/ui/surface';

/**
 * Props for {@link AiEvidenceList}.
 */
interface AiEvidenceListProps {
  /** The run's observations (from typed events). */
  observations: readonly RunObservationView[];
  /** Final public citations, when terminal output is available. */
  citations?: readonly CitationV1[];
}

/**
 * Lists the tool- and knowledge-sourced observations of a run as evidence.
 * Purely presentational: it renders only the reducer's typed observation state
 * and shows the source's trust label so untrusted content is visibly marked.
 *
 * @param props - The run observations.
 * @returns The evidence list element, or null when there is no evidence.
 */
export function AiEvidenceList({ observations, citations = [] }: AiEvidenceListProps): React.ReactElement | null {
  const evidence = observations.filter(
    (observation) => observation.source_kind === 'tool' || observation.source_kind === 'knowledge',
  );
  if (evidence.length === 0 && citations.length === 0) return null;
  return (
    <Surface variant="default" className="p-4" data-testid="ai-evidence-list">
      <div className="flex items-center gap-2 text-ink">
        <FileText className="h-4 w-4 text-brand" />
        <span className="font-semibold">Evidence</span>
      </div>
      <ul className="mt-3 space-y-1 text-sm text-ink">
        {evidence.map((observation) => (
          <li key={observation.observation_id} className="flex items-center justify-between">
            <span>{observation.tool_name ?? observation.source_kind}</span>
            <span className="text-xs font-medium text-muted">
              {observation.observation_type} · {observation.trust}
            </span>
          </li>
        ))}
        {citations.map((citation) => (
          <li key={`${citation.source_type}-${citation.source_id}`} className="flex items-center justify-between gap-3">
            <span>{citation.source_type}: {citation.source_id}</span>
            {citation.reference.startsWith('http://') || citation.reference.startsWith('https://') || citation.reference.startsWith('/') ? (
              <a className="truncate text-xs font-medium text-brand hover:underline" href={citation.reference}>
                {citation.reference}
              </a>
            ) : (
              <span className="truncate text-xs text-muted">{citation.reference}</span>
            )}
          </li>
        ))}
      </ul>
    </Surface>
  );
}
