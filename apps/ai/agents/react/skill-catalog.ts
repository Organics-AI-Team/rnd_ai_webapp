/**
 * Runtime catalog for the unified R&D agent's versioned Markdown skill cards.
 *
 * Keeping operational guidance in Markdown lets product and R&D teams review
 * each capability independently while the running ReAct agent receives the
 * same authoritative instructions.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ReactAgentSkillDefinition {
  id: string;
  label: string;
  file_name: string;
}

/** Every skill exposed by the unified R&D agent UI and prompt. */
export const REACT_AGENT_SKILL_CATALOG: readonly ReactAgentSkillDefinition[] = [
  { id: 'materials', label: 'Materials & Stock', file_name: 'materials-and-stock.md' },
  { id: 'formulation', label: 'Formula Design', file_name: 'formula-design.md' },
  { id: 'costing', label: 'Cost & Scale', file_name: 'cost-and-scale.md' },
  { id: 'market', label: 'Market Research', file_name: 'market-research.md' },
  { id: 'sales', label: 'Sales Planning', file_name: 'sales-planning.md' },
];

let cached_skill_context: string | undefined;

/** Resolve the source location from either the monorepo root or apps/web. */
function get_default_skill_directory(): string {
  console.log('[ReactSkillCatalog] get_default_skill_directory — start');

  const candidate_directories = [
    resolve(process.cwd(), 'apps', 'ai', 'agents', 'react', 'skills'),
    resolve(process.cwd(), '..', 'ai', 'agents', 'react', 'skills'),
  ];
  const skill_directory = candidate_directories.find((candidate) => existsSync(candidate))
    || candidate_directories[0];

  console.log('[ReactSkillCatalog] get_default_skill_directory — complete', {
    skill_directory,
    exists: existsSync(skill_directory),
  });
  return skill_directory;
}

/** Resolve the local skill-card directory, allowing a deployment override. */
function get_skill_directory(): string {
  console.log('[ReactSkillCatalog] get_skill_directory — start');

  const configured_directory = process.env.REACT_AGENT_SKILLS_DIRECTORY;
  const skill_directory = configured_directory
    ? resolve(configured_directory)
    : get_default_skill_directory();

  console.log('[ReactSkillCatalog] get_skill_directory — complete', { skill_directory });
  return skill_directory;
}

/** Load one Markdown card without allowing a missing card to stop the agent. */
function read_skill_document(skill_directory: string, skill: ReactAgentSkillDefinition): string | undefined {
  const file_path = resolve(skill_directory, skill.file_name);
  console.log('[ReactSkillCatalog] read_skill_document — start', { skill_id: skill.id });

  try {
    const document = readFileSync(file_path, 'utf8').trim();
    if (!document) {
      throw new Error('Skill card is empty');
    }

    console.log('[ReactSkillCatalog] read_skill_document — loaded', {
      skill_id: skill.id,
      character_count: document.length,
    });
    return document;
  } catch (error) {
    const error_message = error instanceof Error ? error.message : String(error);
    console.warn('[ReactSkillCatalog] read_skill_document — unavailable', {
      skill_id: skill.id,
      error: error_message,
    });
    return undefined;
  }
}

/** Provide a safe, compact fallback if a deployment omits the Markdown cards. */
function build_skill_fallback(): string {
  console.log('[ReactSkillCatalog] build_skill_fallback — start');

  const fallback = `# RUNTIME SKILL CATALOG

Use the smallest applicable skill: Materials & Stock, Formula Design, Cost & Scale,
Market Research, or Sales Planning. Verify availability with stock_lookup, use tools
for factual claims, and label commercial recommendations as inferences.`;

  console.log('[ReactSkillCatalog] build_skill_fallback — complete', {
    character_count: fallback.length,
  });
  return fallback;
}

/**
 * Return the Markdown skill cards injected into the live ReAct system prompt.
 * The result is cached per server process because card files are versioned with
 * the deployment and should not vary during an active process.
 */
export function get_react_skill_context(): string {
  console.log('[ReactSkillCatalog] get_react_skill_context — start');

  if (cached_skill_context) {
    console.log('[ReactSkillCatalog] get_react_skill_context — cache hit', {
      character_count: cached_skill_context.length,
    });
    return cached_skill_context;
  }

  const skill_directory = get_skill_directory();
  const documents = REACT_AGENT_SKILL_CATALOG
    .map((skill) => read_skill_document(skill_directory, skill))
    .filter((document): document is string => Boolean(document));

  cached_skill_context = documents.length === REACT_AGENT_SKILL_CATALOG.length
    ? [
        '# RUNTIME SKILL CATALOG',
        'The following versioned local skill cards are authoritative for when to use each capability, which tools to call, and how to verify results.',
        ...documents,
      ].join('\n\n---\n\n')
    : build_skill_fallback();

  console.log('[ReactSkillCatalog] get_react_skill_context — complete', {
    loaded_skill_count: documents.length,
    expected_skill_count: REACT_AGENT_SKILL_CATALOG.length,
    character_count: cached_skill_context.length,
  });
  return cached_skill_context;
}
