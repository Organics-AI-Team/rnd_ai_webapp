/**
 * Confirm Formula Tool Handler
 * Transitions a formula from draft to confirmed, bumps version number,
 * and creates an immutable version log entry with ingredient snapshot.
 *
 * Version numbers (v01, v02, v03...) only increment on confirmation,
 * making them represent human-approved milestones.
 *
 * @author AI Management System
 * @date 2026-03-30
 */

import client_promise from '@rnd-ai/shared-database';
import { ObjectId } from 'mongodb';
import type { ToolHandlerContext } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Input parameters for the confirm_formula tool.
 *
 * @param formula_id - The formula to confirm (MongoDB ObjectId string)
 * @param remarks    - Optional confirmation remarks (e.g. "approved after adding vitamin E")
 */
interface ConfirmFormulaParams {
  formula_id: string;
  remarks?: string;
}

// ---------------------------------------------------------------------------
// Main Handler
// ---------------------------------------------------------------------------

/**
 * Handle the `confirm_formula` ReAct tool call.
 *
 * Workflow:
 * 1. Load the formula from MongoDB
 * 2. Validate it is currently in 'draft' status
 * 3. Bump version number (previous + 1)
 * 4. Update formula status to 'confirmed'
 * 5. Create immutable version log entry with ingredient snapshot
 * 6. Add version_update comment for visibility in formula thread
 *
 * @param params  - ConfirmFormulaParams with formula_id and optional remarks
 * @param context - User/org context for audit trail
 * @returns JSON string with confirmation result
 */
export async function handle_confirm_formula(
  params: ConfirmFormulaParams,
  context?: ToolHandlerContext,
): Promise<string> {
  const start_ts = Date.now();
  console.log('[confirm-formula] handle_confirm_formula — start', {
    formula_id: params.formula_id,
    user_id: context?.user_id,
  });

  if (!params.formula_id) {
    return JSON.stringify({ error: 'formula_id is required' });
  }

  try {
    const client = await client_promise;
    const db = client.db();

    // Validate ObjectId format
    let object_id: ObjectId;
    try {
      object_id = new ObjectId(params.formula_id);
    } catch {
      return JSON.stringify({ error: `Invalid formula_id format: "${params.formula_id}"` });
    }

    // --- Load formula ---
    const formula = await db.collection('formulas').findOne({ _id: object_id });
    if (!formula) {
      return JSON.stringify({
        error: `Formula not found: ${params.formula_id}`,
        suggestion: 'Use search_reference_formulas to find the correct formula ID.',
      });
    }

    // --- Validate draft status ---
    if (formula.status !== 'draft') {
      return JSON.stringify({
        error: `Cannot confirm — formula "${formula.formulaCode || formula.formulaName}" is currently "${formula.status}", must be "draft"`,
        current_status: formula.status,
        formula_code: formula.formulaCode,
      });
    }

    // --- Calculate next version ---
    const previous_version = formula.version || 0;
    const next_version = previous_version + 1;
    const version_label = `v${String(next_version).padStart(2, '0')}`;

    const user_id = context?.user_id || 'ai-system';
    const user_name = user_id === 'ai-system' ? 'AI System' : user_id;

    // --- Update formula: bump version + set confirmed ---
    await db.collection('formulas').updateOne(
      { _id: object_id },
      {
        $set: {
          status: 'confirmed',
          version: next_version,
          updatedAt: new Date(),
        },
      },
    );

    console.log('[confirm-formula] formula updated', {
      formula_id: params.formula_id,
      previous_version,
      next_version,
      version_label,
    });

    // --- Create immutable version log entry ---
    const version_log_result = await db.collection('formula_version_logs').insertOne({
      formulaId: params.formula_id,
      version: next_version,
      previousVersion: previous_version,
      changeType: 'confirmed',
      updatedBySource: 'user',
      updatedByUserId: user_id,
      updatedByName: user_name,
      status: 'confirmed',
      ingredientSnapshot: formula.ingredients || [],
      changelog: null,
      remarks: params.remarks || `Confirmed as ${version_label}`,
      createdAt: new Date(),
    });

    console.log('[confirm-formula] version log created', {
      log_id: version_log_result.insertedId.toString(),
    });

    // --- Add version_update comment (attached to the new confirmed version) ---
    await db.collection('formula_comments').insertOne({
      formulaId: params.formula_id,
      version: next_version,
      userId: user_id,
      userName: user_name,
      content: `Confirmed as ${version_label}${params.remarks ? ` — ${params.remarks}` : ''}`,
      commentType: 'version_update',
      parentCommentId: null,
      metadata: { version: next_version, changeType: 'confirmed' },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const elapsed = Date.now() - start_ts;
    console.log('[confirm-formula] handle_confirm_formula — done', {
      formula_id: params.formula_id,
      version_label,
      elapsed_ms: elapsed,
    });

    return JSON.stringify({
      success: true,
      formula_id: params.formula_id,
      formula_code: formula.formulaCode,
      formula_name: formula.formulaName,
      previous_version,
      new_version: next_version,
      version_label,
      status: 'confirmed',
      remarks: params.remarks || `Confirmed as ${version_label}`,
      message: `Formula "${formula.formulaCode || formula.formulaName}" confirmed as ${version_label}. Version bumped from ${previous_version} to ${next_version}.`,
    });
  } catch (error) {
    const elapsed = Date.now() - start_ts;
    const err_msg = error instanceof Error ? error.message : String(error);
    console.error('[confirm-formula] handle_confirm_formula — error', {
      error: err_msg,
      elapsed_ms: elapsed,
    });
    return JSON.stringify({ error: `Formula confirmation failed: ${err_msg}` });
  }
}
