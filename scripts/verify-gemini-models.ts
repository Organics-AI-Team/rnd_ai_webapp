#!/usr/bin/env npx tsx
/**
 * Verify every Gemini model id this deployment will actually call.
 *
 * Google retires model ids on a rolling basis; a retired id returns HTTP 404
 * from `generateContent` and every agent turn fails at runtime. This check
 * catches the whole class before users do — run it after changing a model id,
 * after a deploy, and on any "the AI stopped answering" report.
 *
 * Usage:
 *   npx tsx scripts/verify-gemini-models.ts          # uses current env
 *
 * Exit code 0 when every configured id answers, 1 when any is dead.
 *
 * Env vars required:
 *   GEMINI_API_KEY
 */

import {
  get_gemini_model,
  get_gemini_search_model,
  get_gemini_embedding_model,
} from '../apps/ai/config/gemini-models';

const API_KEY = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || '';
const API_ROOT = process.env.GEMINI_API_ROOT || 'https://generativelanguage.googleapis.com/v1beta';

/** One model id and the endpoint that proves it is callable. */
interface ModelCheck {
  label: string;
  model: string;
  /** Embedding models 404 on generateContent, so probe their own endpoint. */
  kind: 'generate' | 'embed';
}

/**
 * Call the model's own endpoint with a minimal payload.
 *
 * @param check - Model id plus the endpoint family it belongs to.
 * @returns HTTP status and the API error message when the call failed.
 */
async function probe_model(check: ModelCheck): Promise<{ ok: boolean; status: number; message: string }> {
  const [path, body] = check.kind === 'embed'
    ? [`${check.model}:embedContent`, { content: { parts: [{ text: 'ping' }] } }]
    : [`${check.model}:generateContent`, { contents: [{ role: 'user', parts: [{ text: 'ping' }] }] }];

  const response = await fetch(`${API_ROOT}/models/${path}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (response.ok) return { ok: true, status: response.status, message: '' };
  const payload = await response.json().catch(() => null);
  return { ok: false, status: response.status, message: payload?.error?.message || 'unknown error' };
}

/** Probe every configured model id and report the dead ones. */
async function main(): Promise<void> {
  console.log('[verify-gemini-models] start');

  if (!API_KEY) {
    console.error('[verify-gemini-models] GEMINI_API_KEY is not set');
    process.exit(1);
  }

  const checks: ModelCheck[] = [
    { label: 'GEMINI_MODEL', model: get_gemini_model(), kind: 'generate' },
    { label: 'GEMINI_SEARCH_MODEL', model: get_gemini_search_model(), kind: 'generate' },
    { label: 'GEMINI_EMBEDDING_MODEL', model: get_gemini_embedding_model(), kind: 'embed' },
  ];

  const results = await Promise.all(checks.map(async (check) => ({
    check,
    result: await probe_model(check),
  })));

  for (const { check, result } of results) {
    const status = result.ok ? 'OK' : `DEAD (${result.status}) ${result.message}`;
    console.log(`  ${check.label.padEnd(24)} ${check.model.padEnd(28)} ${status}`);
  }

  const dead = results.filter(({ result }) => !result.ok);
  console.log(`[verify-gemini-models] finish — ${results.length - dead.length}/${results.length} live`);
  process.exit(dead.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('[verify-gemini-models] error', error);
  process.exit(1);
});
