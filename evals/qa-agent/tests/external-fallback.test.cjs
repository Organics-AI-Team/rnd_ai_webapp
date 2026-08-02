const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const original_load = Module._load;
Module._load = function load_agent_with_isolated_tool_handlers(request, parent, is_main) {
  if (request === '@google/generative-ai') {
    return { GoogleGenerativeAI: class GoogleGenerativeAI {} };
  }
  if (request === './tool-definitions') {
    return { get_react_tool_declarations: () => [] };
  }
  if (request === './react-system-prompt') {
    return { get_react_system_prompt: () => 'Test system prompt' };
  }
  if (request.includes('/tool-handlers/')) {
    return new Proxy({}, { get: () => async () => 'unused handler result' });
  }
  return original_load.call(this, request, parent, is_main);
};
const { ReactAgentService } = require(path.join(
  __dirname,
  '..',
  '..',
  '..',
  'apps',
  'ai',
  'dist',
  'agents',
  'react',
  'react-agent-service.js',
));
Module._load = original_load;

function candidate(parts) {
  return { response: { candidates: [{ content: { parts } }] } };
}

function create_agent(prompt, tool_result_by_name, first_function_call) {
  const agent = new ReactAgentService('test-key', { max_iterations: 3 });
  let request_count = 0;
  agent.gen_ai = {
    getGenerativeModel() {
      return {
        async generateContent() {
          request_count += 1;
          if (request_count === 1) {
            return candidate([{
              functionCall: first_function_call || {
                name: 'qdrant_search',
                args: { query: prompt, collection: 'raw_materials_myskin' },
              },
            }]);
          }
          return candidate([{ text: 'External evidence supports the answer.' }]);
        },
      };
    },
  };
  agent._execute_tool = async (name) => tool_result_by_name[name];
  return agent;
}

test('general ingredient queries automatically get grounded external fallback after internal failure', async () => {
  const agent = create_agent('What does niacinamide support?', {
    qdrant_search: 'Qdrant search failed for collection "raw_materials_myskin": connection refused',
    web_search: 'Web search results for: "What does niacinamide support?"\nSources:\n  [1] example.org — https://example.org/niacinamide',
  });

  const result = await agent.execute({
    prompt: 'What does niacinamide support?',
    user_id: 'qa-user',
  });

  assert.match(result.response, /cited external sources/i);
  assert.match(result.response, /example\.org/);
  assert.deepEqual(result.tool_calls.map((call) => call.name), ['qdrant_search', 'web_search']);
  assert.deepEqual(result.artifacts.citations, [{ source: 'example.org', url: 'https://example.org/niacinamide' }]);
  assert.equal(result.artifacts.partial, undefined);
});

test('a Thai question that merely mentions a formula still receives external ingredient evidence', async () => {
  const agent = create_agent('กลีเซอรีนมีบทบาทอะไรในสูตรสกินแคร์', {
    qdrant_search: 'Qdrant search failed for collection "raw_materials_myskin": connection refused',
    web_search: 'Web search results: กลีเซอรีนเป็น humectant ที่ช่วยให้ความชุ่มชื้น.',
  });

  const result = await agent.execute({
    prompt: 'กลีเซอรีนมีบทบาทอะไรในสูตรสกินแคร์',
    user_id: 'qa-user',
  });

  assert.deepEqual(result.tool_calls.map((call) => call.name), ['qdrant_search', 'web_search']);
  assert.equal(result.artifacts.partial, undefined);
});

test('external search does not replace unavailable live-stock verification', async () => {
  const agent = create_agent('Is RM-100 available in stock?', {
    qdrant_search: 'Qdrant search failed for collection "raw_materials_myskin": connection refused',
    web_search: 'This must never be used for live stock.',
  });

  const result = await agent.execute({
    prompt: 'Is RM-100 available in stock?',
    user_id: 'qa-user',
  });

  assert.match(result.response, /could not reach the data sources/i);
  assert.deepEqual(result.tool_calls.map((call) => call.name), ['qdrant_search']);
  assert.equal(result.artifacts.partial, true);
});

test('confirmed stock responses explicitly distinguish current stock from catalog data', async () => {
  const agent = create_agent('Is RM-100 available in stock?', {
    stock_lookup: JSON.stringify({
      availability: 'confirmed_in_stock',
      stock_matches: [{ material_code: 'RM-100', trade_name: 'QA Niacinamide Stock' }],
      catalog_matches: [],
    }),
  }, {
    name: 'stock_lookup',
    args: { query: 'RM-100' },
  });

  const result = await agent.execute({
    prompt: 'Is RM-100 available in stock?',
    user_id: 'qa-user',
  });

  assert.match(result.response, /current stock: confirmed/i);
  assert.deepEqual(result.tool_calls.map((call) => call.name), ['stock_lookup']);
});
