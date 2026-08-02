/**
 * Promptfoo provider that replays a captured RAG run without calling production.
 *
 * The provider deliberately returns both the answer and the retrieved contexts so
 * Promptfoo's context-based assertions grade the evidence used in that specific run.
 */
const fs = require('node:fs');
const path = require('node:path');

class RecordedOutputProvider {
  /**
   * Initialise a provider that reads a JSONL result artifact.
   *
   * @param {object} options - Promptfoo provider options.
   * @param {string} [options.id] - Optional display identifier for Promptfoo reports.
   * @param {object} [options.config] - Provider configuration from the YAML file.
   * @param {string} [options.config.resultsPath] - Root-relative recorded-run JSONL path.
   */
  constructor(options = {}) {
    console.info('[recorded-output-provider] constructor.start');
    this.providerId = options.id || 'recorded-rag-run';
    this.resultsPath = process.env.AI_EVAL_RESULTS_PATH || options.config?.resultsPath || '';
    this.recordsById = undefined;
    console.info('[recorded-output-provider] constructor.complete', {
      providerId: this.providerId,
      hasResultsPath: Boolean(this.resultsPath),
    });
  }

  /**
   * Return the stable provider ID shown in Promptfoo reports.
   *
   * @returns {string} Configured provider ID.
   */
  id() {
    console.info('[recorded-output-provider] id.start');
    console.info('[recorded-output-provider] id.complete', { providerId: this.providerId });
    return this.providerId;
  }

  /**
   * Return the recorded output selected by ``context.vars.case_id``.
   *
   * @param {string} _prompt - Rendered Promptfoo prompt; unused because the run is already captured.
   * @param {object} [context] - Promptfoo execution context containing test variables.
   * @returns {Promise<object>} Promptfoo provider response with structured answer and evidence.
   */
  async callApi(_prompt, context = {}) {
    const caseId = context?.vars?.case_id;
    console.info('[recorded-output-provider] callApi.start', { caseId: caseId || null });
    if (typeof caseId !== 'string' || !caseId.trim()) {
      const error = 'Promptfoo test must provide a non-empty vars.case_id.';
      console.info('[recorded-output-provider] callApi.error', { reason: 'missing_case_id' });
      return { error };
    }

    try {
      const recordsById = this._loadRecords();
      const record = recordsById.get(caseId);
      if (!record) {
        const error = `No captured run found for case ID: ${caseId}`;
        console.info('[recorded-output-provider] callApi.error', { caseId, reason: 'case_not_found' });
        return { error };
      }
      if (typeof record.answer !== 'string' || !record.answer.trim()) {
        const error = `Captured run ${caseId} has no non-empty answer.`;
        console.info('[recorded-output-provider] callApi.error', { caseId, reason: 'missing_answer' });
        return { error };
      }

      const response = {
        output: {
          answer: record.answer,
          retrieved_contexts: Array.isArray(record.retrieved_contexts)
            ? record.retrieved_contexts
            : [],
          tool_calls: Array.isArray(record.tool_calls) ? record.tool_calls : [],
        },
        metadata: {
          latency_ms: Number.isInteger(record.latency_ms) ? record.latency_ms : null,
          model: typeof record.model === 'string' ? record.model : null,
        },
      };
      console.info('[recorded-output-provider] callApi.complete', { caseId });
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.info('[recorded-output-provider] callApi.error', { caseId, reason: 'artifact_error' });
      return { error: message };
    }
  }

  /**
   * Load and cache a JSONL output artifact indexed by its case ID.
   *
   * @returns {Map<string, object>} Captured runs indexed by stable case ID.
   * @throws {Error} If the artifact path is missing, unreadable, malformed, or has duplicate IDs.
   */
  _loadRecords() {
    console.info('[recorded-output-provider] _loadRecords.start');
    if (this.recordsById) {
      console.info('[recorded-output-provider] _loadRecords.complete', {
        source: 'cache',
        recordCount: this.recordsById.size,
      });
      return this.recordsById;
    }
    if (!this.resultsPath) {
      throw new Error('Set AI_EVAL_RESULTS_PATH or provider config.resultsPath to a JSONL result file.');
    }

    const resolvedPath = path.resolve(process.cwd(), this.resultsPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Recorded-run file does not exist: ${resolvedPath}`);
    }

    const recordsById = new Map();
    const lines = fs.readFileSync(resolvedPath, 'utf8').split(/\r?\n/);
    for (const [index, rawLine] of lines.entries()) {
      const line = rawLine.trim();
      if (!line) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSON in ${resolvedPath} at line ${index + 1}.`);
      }
      if (!record || typeof record.id !== 'string' || !record.id.trim()) {
        throw new Error(`Recorded run in ${resolvedPath} at line ${index + 1} has no non-empty id.`);
      }
      if (recordsById.has(record.id)) {
        throw new Error(`Recorded-run file contains duplicate case ID: ${record.id}`);
      }
      recordsById.set(record.id, record);
    }
    this.recordsById = recordsById;
    console.info('[recorded-output-provider] _loadRecords.complete', {
      source: 'disk',
      recordCount: recordsById.size,
    });
    return recordsById;
  }
}

module.exports = RecordedOutputProvider;
