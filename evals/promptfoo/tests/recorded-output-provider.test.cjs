/** Regression tests for the Promptfoo recorded-run provider. */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const RecordedOutputProvider = require('../recorded-output-provider.cjs');

test('returns the captured response and retrieval context for the requested case ID', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recorded-output-provider-'));
  const resultsPath = path.join(directory, 'results.jsonl');
  fs.writeFileSync(
    resultsPath,
    `${JSON.stringify({
      id: 'rag_v1_panthenol',
      answer: 'Panthenol is used for conditioning.',
      retrieved_contexts: ['Panthenol is used for conditioning.'],
      tool_calls: ['qdrant_search'],
      latency_ms: 420,
      model: 'gemini-test',
    })}\n`,
    'utf8',
  );
  const provider = new RecordedOutputProvider({
    id: 'recorded-rag-run',
    config: { resultsPath },
  });

  const response = await provider.callApi('ignored', { vars: { case_id: 'rag_v1_panthenol' } });

  assert.equal(provider.id(), 'recorded-rag-run');
  assert.deepEqual(response.output, {
    answer: 'Panthenol is used for conditioning.',
    retrieved_contexts: ['Panthenol is used for conditioning.'],
    tool_calls: ['qdrant_search'],
  });
  assert.equal(response.metadata.latency_ms, 420);
});

test('returns a useful error when the captured run does not contain the requested case', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recorded-output-provider-'));
  const resultsPath = path.join(directory, 'results.jsonl');
  fs.writeFileSync(`${resultsPath}`, '{"id":"rag_v1_known","answer":"Known"}\n', 'utf8');
  const provider = new RecordedOutputProvider({ config: { resultsPath } });

  const response = await provider.callApi('ignored', { vars: { case_id: 'rag_v1_missing' } });

  assert.match(response.error, /rag_v1_missing/);
});
