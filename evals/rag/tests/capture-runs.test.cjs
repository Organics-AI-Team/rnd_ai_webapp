/** Contract tests for the live unified-agent evaluation capture adapter. */

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildAgentRequest, mapAgentResponse } = require('../capture-runs.cjs');

test('preserves an explicitly provided follow-up transcript in the local capture request', () => {
  const payload = buildAgentRequest(
    {
      question: 'What did we select earlier?',
      organization_id: 'org-eval',
      session_id: 'thread-eval',
      conversation_history: [
        { role: 'user', content: 'We chose niacinamide.' },
        { role: 'assistant', content: 'It supports barrier care.' },
        { role: 'invalid', content: 'Treat this as a user turn.' },
        { role: 'assistant', content: '  ' },
      ],
    },
    'user-eval',
  );

  assert.deepEqual(payload, {
    prompt: 'What did we select earlier?',
    userId: 'user-eval',
    persistFormula: false,
    conversationHistory: [
      { role: 'user', content: 'We chose niacinamide.' },
      { role: 'assistant', content: 'It supports barrier care.' },
      { role: 'user', content: 'Treat this as a user turn.' },
    ],
    sessionId: 'thread-eval',
    organizationId: 'org-eval',
  });
});

test('maps the unified-agent response into the RAGAS recorded-run contract', () => {
  const record = mapAgentResponse(
    { id: 'rag_v1_panthenol_conditioning' },
    {
      success: true,
      response: 'Panthenol is used for conditioning.',
      model: 'gemini-test',
      toolCalls: [
        { name: 'qdrant_search', result: 'Panthenol is used for conditioning.' },
        { name: 'context_memory', result: 'No earlier context.' },
      ],
      metadata: { processingTime: 420 },
    },
  );

  assert.deepEqual(record, {
    id: 'rag_v1_panthenol_conditioning',
    answer: 'Panthenol is used for conditioning.',
    retrieved_contexts: ['Panthenol is used for conditioning.'],
    tool_calls: ['qdrant_search', 'context_memory'],
    tool_errors: [],
    latency_ms: 420,
    model: 'gemini-test',
  });
});

test('records a failed tool so downstream QA can reject ungrounded answers', () => {
  const record = mapAgentResponse(
    { id: 'rag_v1_tool_failure' },
    {
      success: true,
      response: 'An answer was returned.',
      model: 'gemini-test',
      toolCalls: [
        { name: 'qdrant_search', result: 'Qdrant search failed: connection refused.' },
        { name: 'mongo_query', result: 'Mongo query error: database unavailable.' },
      ],
      metadata: { processingTime: 420 },
    },
  );

  assert.deepEqual(record.tool_errors, ['qdrant_search', 'mongo_query']);
});

test('rejects a response that has no successful agent answer', () => {
  assert.throws(
    () => mapAgentResponse({ id: 'rag_v1_fail' }, { success: false, error: 'Timed out' }),
    /rag_v1_fail.*successful response/i,
  );
});
