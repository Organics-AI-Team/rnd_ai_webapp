/**
 * Capture live unified-agent RAG runs into the JSONL contract consumed by RAGAS.
 *
 * This command is intentionally opt-in: it sends requests to the selected live
 * endpoint only when --allow-live is present, and it never overwrites an output
 * artifact unless --overwrite is also present.
 */
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TIMEOUT_MS = Number(process.env.AI_EVAL_REQUEST_TIMEOUT_MS || '60000');
const DEFAULT_DATASET_PATH = path.join(__dirname, 'fixtures', 'rag-v1.jsonl');

/**
 * Parse the live-capture CLI without sending any request.
 *
 * @param {string[]} arguments - User-provided command line arguments.
 * @returns {object} Validated capture options.
 * @throws {Error} If a required option is missing or malformed.
 */
function parseArguments(arguments) {
  console.info('[capture-runs] parseArguments.start');
  const options = {
    allowLive: false,
    overwrite: false,
    datasetPath: DEFAULT_DATASET_PATH,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (let index = 0; index < arguments.length; index += 1) {
    const argument = arguments[index];
    if (argument === '--allow-live') {
      options.allowLive = true;
      continue;
    }
    if (argument === '--overwrite') {
      options.overwrite = true;
      continue;
    }
    if (['--endpoint', '--user-id', '--output', '--dataset', '--timeout-ms'].includes(argument)) {
      const value = arguments[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a value.`);
      }
      index += 1;
      if (argument === '--endpoint') options.endpoint = value;
      if (argument === '--user-id') options.userId = value;
      if (argument === '--output') options.outputPath = value;
      if (argument === '--dataset') options.datasetPath = value;
      if (argument === '--timeout-ms') options.timeoutMs = Number(value);
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.allowLive) {
    throw new Error('Live capture is disabled. Re-run with --allow-live after confirming the endpoint and corpus.');
  }
  for (const field of ['endpoint', 'userId', 'outputPath']) {
    if (typeof options[field] !== 'string' || !options[field].trim()) {
      throw new Error(`Missing required option: --${field === 'userId' ? 'user-id' : field.replace('Path', '')}`);
    }
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive integer.');
  }
  console.info('[capture-runs] parseArguments.complete', {
    datasetPath: options.datasetPath,
    timeoutMs: options.timeoutMs,
  });
  return options;
}

/**
 * Read canonical cases from a JSONL file.
 *
 * @param {string} datasetPath - Fixture path that owns the request IDs and prompts.
 * @returns {Array<object>} Parsed non-empty fixture objects.
 * @throws {Error} If the fixture does not exist or contains malformed JSON.
 */
function readDataset(datasetPath) {
  console.info('[capture-runs] readDataset.start', { datasetPath });
  const resolvedPath = path.resolve(process.cwd(), datasetPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Dataset file does not exist: ${resolvedPath}`);
  }
  const cases = fs.readFileSync(resolvedPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSON in ${resolvedPath} at line ${index + 1}.`);
      }
    });
  if (!cases.length) {
    throw new Error(`Dataset file contains no cases: ${resolvedPath}`);
  }
  for (const testCase of cases) {
    if (!testCase || typeof testCase.id !== 'string' || !testCase.id.trim()) {
      throw new Error(`Each dataset case must provide a non-empty id: ${resolvedPath}`);
    }
    if (typeof testCase.question !== 'string' || !testCase.question.trim()) {
      throw new Error(`Dataset case ${testCase.id} must provide a non-empty question.`);
    }
  }
  console.info('[capture-runs] readDataset.complete', { caseCount: cases.length });
  return cases;
}

/**
 * Convert one unified-agent API response to the recorded-run schema.
 *
 * @param {object} testCase - Canonical fixture used to make the request.
 * @param {object} response - Parsed JSON response from /api/ai/rnd-agent.
 * @returns {object} JSONL-safe RAGAS input row.
 * @throws {Error} If the agent did not complete successfully or omitted required fields.
 */
function mapAgentResponse(testCase, response) {
  const caseId = testCase?.id;
  console.info('[capture-runs] mapAgentResponse.start', { caseId: caseId || null });
  if (!caseId || !response?.success || typeof response.response !== 'string' || !response.response.trim()) {
    throw new Error(`Case ${caseId || 'unknown'} has no successful response from the unified agent.`);
  }
  const toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : [];
  const record = {
    id: caseId,
    answer: response.response.trim(),
    retrieved_contexts: toolCalls
      .filter((toolCall) => toolCall?.name === 'qdrant_search' && typeof toolCall.result === 'string')
      .map((toolCall) => toolCall.result.trim())
      .filter(Boolean),
    tool_calls: toolCalls
      .map((toolCall) => toolCall?.name)
      .filter((toolName) => typeof toolName === 'string' && toolName.trim()),
    tool_errors: toolCalls
      .filter((toolCall) => (
        typeof toolCall?.name === 'string' &&
        typeof toolCall?.result === 'string' &&
        /(?:\berror\b|\bfailed\b|\btimeout\b|\bunavailable\b|\bmissing environment variable\b)/i.test(toolCall.result)
      ))
      .map((toolCall) => toolCall.name),
    latency_ms: Number.isInteger(response?.metadata?.processingTime)
      ? response.metadata.processingTime
      : 0,
    model: typeof response.model === 'string' && response.model.trim()
      ? response.model
      : 'unknown',
  };
  console.info('[capture-runs] mapAgentResponse.complete', {
    caseId,
      retrievedContextCount: record.retrieved_contexts.length,
      toolErrorCount: record.tool_errors.length,
  });
  return record;
}

/**
 * Build the request body for one replayable test case. A fixture may include
 * a prior transcript, allowing the local capture to test normal chat
 * follow-ups without writing to a user's real conversation thread.
 *
 * @param {object} testCase - Canonical evaluation fixture.
 * @param {string} userId - Authorized evaluation user identifier.
 * @returns {object} Request payload accepted by the unified-agent endpoint.
 */
function buildAgentRequest(testCase, userId) {
  const payload = {
    prompt: testCase.question,
    userId,
    persistFormula: false,
  };

  if (Array.isArray(testCase.conversation_history)) {
    payload.conversationHistory = testCase.conversation_history
      .filter((message) => message && typeof message.content === 'string' && message.content.trim())
      .map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content.trim(),
      }));
  }
  if (typeof testCase.session_id === 'string' && testCase.session_id.trim()) {
    payload.sessionId = testCase.session_id.trim();
  }
  if (typeof testCase.organization_id === 'string' && testCase.organization_id.trim()) {
    payload.organizationId = testCase.organization_id.trim();
  }

  return payload;
}

/**
 * Run the canonical corpus sequentially through the selected unified-agent endpoint.
 *
 * @param {object} options - Validated capture options.
 * @returns {Promise<Array<object>>} Recorded RAG runs ready to write as JSONL.
 * @throws {Error} If a network/API failure prevents capturing a complete corpus.
 */
async function captureRuns(options) {
  console.info('[capture-runs] captureRuns.start', { endpoint: options.endpoint });
  const testCases = readDataset(options.datasetPath);
  const records = [];
  for (const testCase of testCases) {
    console.info('[capture-runs] captureRuns.case_start', { caseId: testCase.id });
    const response = await fetch(options.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs),
      body: JSON.stringify(buildAgentRequest(testCase, options.userId)),
    });
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error(`Case ${testCase.id}: endpoint returned a non-JSON response (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      const detail = typeof payload?.error === 'string' ? payload.error : 'Unknown endpoint error';
      throw new Error(`Case ${testCase.id}: endpoint failed with HTTP ${response.status}: ${detail}`);
    }
    records.push(mapAgentResponse(testCase, payload));
    console.info('[capture-runs] captureRuns.case_complete', { caseId: testCase.id });
  }
  console.info('[capture-runs] captureRuns.complete', { recordCount: records.length });
  return records;
}

/**
 * Write JSONL records while protecting an existing artifact unless explicitly allowed.
 *
 * @param {string} outputPath - User-selected local result path.
 * @param {Array<object>} records - Captured evaluation records.
 * @param {boolean} overwrite - Whether the user explicitly approved replacement.
 * @returns {void}
 * @throws {Error} If the output exists without overwrite permission or cannot be written.
 */
function writeCapturedRuns(outputPath, records, overwrite) {
  console.info('[capture-runs] writeCapturedRuns.start', { outputPath, recordCount: records.length });
  const resolvedPath = path.resolve(process.cwd(), outputPath);
  if (fs.existsSync(resolvedPath) && !overwrite) {
    throw new Error(`Refusing to overwrite ${resolvedPath}. Re-run with --overwrite if this is intentional.`);
  }
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(
    resolvedPath,
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    { encoding: 'utf8', flag: overwrite ? 'w' : 'wx' },
  );
  console.info('[capture-runs] writeCapturedRuns.complete', { outputPath: resolvedPath });
}

/**
 * Execute the guarded capture CLI.
 *
 * @param {string[]} arguments - Command line arguments after the executable name.
 * @returns {Promise<number>} Process-compatible success or failure code.
 */
async function main(arguments) {
  console.info('[capture-runs] main.start');
  try {
    const options = parseArguments(arguments);
    const records = await captureRuns(options);
    writeCapturedRuns(options.outputPath, records, options.overwrite);
    console.info('[capture-runs] main.complete', { recordCount: records.length });
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Live RAG capture failed: ${message}`);
    console.info('[capture-runs] main.error', { errorType: error?.constructor?.name || 'unknown' });
    return 1;
  }
}

module.exports = {
  captureRuns,
  buildAgentRequest,
  mapAgentResponse,
  parseArguments,
  readDataset,
  writeCapturedRuns,
};

if (require.main === module) {
  main(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
