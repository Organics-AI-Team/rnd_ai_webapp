const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { evaluate_case, evaluate_records, run_evaluation } = require('../qa-evaluator.cjs');

test('local AI QA evaluator accepts the reviewed synthetic baseline', () => {
  const report = run_evaluation({
    fixture_path: path.join(__dirname, '..', 'fixtures', 'qa-v1.jsonl'),
    results_path: path.join(__dirname, '..', 'fixtures', 'results.synthetic.jsonl'),
    config_path: path.join(__dirname, '..', 'qa-config.json'),
  });

  assert.equal(report.gate.passed, true);
  assert.equal(report.case_count, 6);
  assert.equal(report.pass_rate, 1);
  assert.equal(report.performance.p95_latency_ms, 680);
});

test('local AI QA evaluator detects missing tool, raw HTML, secret, and latency regressions', () => {
  const result = evaluate_case(
    {
      id: 'regression',
      question: 'Continue the prior conversation.',
      expected_language: 'en',
      required_tools: ['context_memory'],
      must_include: ['niacinamide'],
      max_latency_ms: 100,
    },
    {
      id: 'regression',
      answer: 'The API_KEY=secret was shown with <br> text.',
      tool_calls: [],
      latency_ms: 101,
      model: 'test',
    },
  );

  assert.equal(result.passed, false);
  assert.deepEqual(result.failures, [
    'missing required tool: context_memory',
    'answer is missing required term: niacinamide',
    'answer appears to contain a secret',
    'answer exposes raw HTML instead of Markdown',
    'case latency 101ms exceeds 100ms',
  ]);
});

test('local AI QA evaluator makes an aggregate latency gate fail', () => {
  const report = evaluate_records(
    [{ id: 'slow', question: 'What is glycerin?', required_tools: [], max_latency_ms: 50000 }],
    [{ id: 'slow', answer: 'A humectant.', tool_calls: [], latency_ms: 30001, model: 'test' }],
    { thresholds: { min_pass_rate: 1, p95_latency_ms: 30000 } },
  );

  assert.equal(report.gate.passed, false);
  assert.deepEqual(report.gate.failures, ['p95_latency_ms']);
});

test('local AI QA evaluator rejects confident claims when every required source failed', () => {
  const result = evaluate_case(
    {
      id: 'ungrounded',
      question: 'What is glycerin used for?',
      required_tools: ['qdrant_search'],
      requires_grounded_evidence: true,
    },
    {
      id: 'ungrounded',
      answer: 'Glycerin is definitely the best choice.',
      tool_calls: ['qdrant_search'],
      tool_errors: ['qdrant_search'],
      latency_ms: 500,
      model: 'test',
    },
  );

  assert.equal(result.passed, false);
  assert.ok(result.failures.includes('answer made a claim after all required grounding tools failed'));
});

test('local AI QA evaluator accepts an explicitly allowed grounded web fallback', () => {
  const result = evaluate_case(
    {
      id: 'external-fallback',
      question: 'What does niacinamide support?',
      required_tools: ['qdrant_search'],
      allowed_fallback_tools: ['web_search'],
      requires_grounded_evidence: true,
    },
    {
      id: 'external-fallback',
      answer: 'External evidence supports skin-barrier care.',
      tool_calls: ['qdrant_search', 'web_search'],
      tool_errors: ['qdrant_search'],
      latency_ms: 500,
      model: 'test',
    },
  );

  assert.equal(result.passed, true);
});

test('local AI QA evaluator accepts either internal retrieval path before an external fallback', () => {
  const result = evaluate_case(
    {
      id: 'internal-route-choice',
      question: 'What does niacinamide support?',
      required_tools: [],
      required_any_tools: ['qdrant_search', 'mongo_query'],
      allowed_fallback_tools: ['web_search'],
      requires_grounded_evidence: true,
    },
    {
      id: 'internal-route-choice',
      answer: 'External evidence supports skin-barrier care.',
      tool_calls: ['mongo_query', 'web_search'],
      tool_errors: ['mongo_query'],
      latency_ms: 500,
      model: 'test',
    },
  );

  assert.equal(result.passed, true);
});

test('local AI QA evaluator accepts the Thai no-evidence fallback after a source failure', () => {
  const result = evaluate_case(
    {
      id: 'thai-no-evidence',
      question: 'กลีเซอรีนมีบทบาทอะไร?',
      expected_language: 'th',
      required_tools: ['qdrant_search'],
      requires_grounded_evidence: true,
    },
    {
      id: 'thai-no-evidence',
      answer: 'ขออภัย ขณะนี้ไม่สามารถเชื่อมต่อแหล่งข้อมูลที่ใช้ตรวจสอบได้ เพื่อป้องกันข้อมูลที่ไม่ยืนยัน ระบบจะไม่สรุปคำตอบจากความรู้ทั่วไป',
      tool_calls: ['qdrant_search'],
      tool_errors: ['qdrant_search'],
      latency_ms: 500,
      model: 'test',
    },
  );

  assert.equal(result.passed, true);
});
