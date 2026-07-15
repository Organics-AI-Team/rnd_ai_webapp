/**
 * Get Formula With Comments Tool Handler
 * Handles the `get_formula_with_comments` ReAct tool by loading a formula
 * from MongoDB along with its full comment thread, providing the AI with
 * complete context for analysis, revision suggestions, or discussion.
 *
 * @author AI Management System
 * @date 2026-03-30
 */

import client_promise from '@rnd-ai/shared-database';
import { ObjectId } from 'mongodb';
import type { ToolHandlerContext } from '../types';
import { tenant_scoped_id_filter } from '../tenant-tool-scope';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Input parameters for the get_formula_with_comments tool.
 *
 * @param formula_id - The MongoDB ObjectId string of the formula to load
 */
interface GetFormulaWithCommentsParams {
  formula_id: string;
}

// ---------------------------------------------------------------------------
// Main Handler
// ---------------------------------------------------------------------------

/**
 * Handle the `get_formula_with_comments` ReAct tool call.
 *
 * Workflow:
 * 1. Validate formula_id
 * 2. Load the formula document from MongoDB
 * 3. Load all comments for this formula, sorted oldest-first for reading order
 * 4. Return combined JSON with formula detail + comment thread
 *
 * @param params  - GetFormulaWithCommentsParams with formula_id
 * @param context - Tool handler context; its verified tenant_id (never the
 *                  model-supplied ID) scopes the formula lookup (G2.6).
 * @returns JSON string with formula detail and comment thread
 */
export async function handle_get_formula_with_comments(
  params: GetFormulaWithCommentsParams,
  context?: ToolHandlerContext,
): Promise<string> {
  const start_ts = Date.now();
  console.log('[get-formula-comments] handle_get_formula_with_comments — start', {
    formula_id: params.formula_id,
    tenant_id: context?.tenant_id,
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

    // --- Tenant scope (G2.6): pin the lookup to the trusted tenant. A
    // cross-tenant or missing ID is indistinguishable from not-found. When
    // tenant_id is absent (unconverted legacy call site) the lookup stays
    // unscoped for backward compatibility until that call site is converted.
    const scoped_filter = tenant_scoped_id_filter(params.formula_id, context?.tenant_id);
    if (context?.tenant_id && !scoped_filter) {
      return JSON.stringify({
        error: `Formula not found: ${params.formula_id}`,
        suggestion: 'Use search_reference_formulas to find formula IDs first.',
      });
    }
    const load_filter = scoped_filter ?? { _id: object_id };

    // --- Load formula ---
    const formula = await db.collection('formulas').findOne(load_filter);

    if (!formula) {
      return JSON.stringify({
        error: `Formula not found: ${params.formula_id}`,
        suggestion: 'Use search_reference_formulas to find formula IDs first.',
      });
    }

    // --- Load comments ---
    const comments = await db
      .collection('formula_comments')
      .find({ formulaId: params.formula_id })
      .sort({ createdAt: 1 })
      .toArray();

    console.log('[get-formula-comments] loaded', {
      formula_name: formula.formulaName,
      comment_count: comments.length,
    });

    // --- Load parent formula if it exists (tenant-scoped like the primary) ---
    let parent_formula = null;
    if (formula.parentFormulaId) {
      try {
        const parent_filter =
          tenant_scoped_id_filter(String(formula.parentFormulaId), context?.tenant_id) ??
          (context?.tenant_id ? null : { _id: new ObjectId(formula.parentFormulaId) });
        parent_formula = parent_filter
          ? await db.collection('formulas').findOne(parent_filter)
          : null;
      } catch {
        console.log('[get-formula-comments] parent formula lookup failed — skipping');
      }
    }

    // --- Format response ---
    const result = {
      formula: {
        _id: formula._id.toString(),
        formula_code: formula.formulaCode || null,
        formula_name: formula.formulaName,
        version: formula.version || 1,
        status: formula.status || 'draft',
        client: formula.client || null,
        target_benefits: formula.targetBenefits || [],
        ingredients: (formula.ingredients || []).map((ing: any) => ({
          rm_code: ing.rm_code,
          product_name: ing.productName,
          inci_name: ing.inci_name || null,
          percentage: ing.percentage || null,
          amount: ing.amount,
          notes: ing.notes || null,
        })),
        total_amount: formula.totalAmount || null,
        remarks: formula.remarks || null,
        ai_generated: formula.aiGenerated || false,
        generation_prompt: formula.generationPrompt || null,
        parent_formula_id: formula.parentFormulaId || null,
        parent_formula_name: parent_formula?.formulaName || null,
        reference_formula_ids: formula.referenceFormulaIds || [],
        created_by: formula.createdBy,
        created_at: formula.createdAt,
        updated_at: formula.updatedAt,
      },
      comments: comments.map((c) => ({
        _id: c._id.toString(),
        user_name: c.userName,
        content: c.content,
        comment_type: c.commentType || 'feedback',
        parent_comment_id: c.parentCommentId || null,
        metadata: c.metadata || null,
        created_at: c.createdAt,
      })),
      summary: {
        total_comments: comments.length,
        by_type: comments.reduce((acc: Record<string, number>, c) => {
          const type = c.commentType || 'feedback';
          acc[type] = (acc[type] || 0) + 1;
          return acc;
        }, {}),
        has_approval: comments.some((c) => c.commentType === 'approval'),
        has_rejection: comments.some((c) => c.commentType === 'rejection'),
        latest_comment: comments.length > 0
          ? {
              user: comments[comments.length - 1].userName,
              type: comments[comments.length - 1].commentType,
              content: comments[comments.length - 1].content?.slice(0, 200),
              date: comments[comments.length - 1].createdAt,
            }
          : null,
      },
    };

    const elapsed = Date.now() - start_ts;
    console.log('[get-formula-comments] handle_get_formula_with_comments — done', {
      formula_name: formula.formulaName,
      comment_count: comments.length,
      elapsed_ms: elapsed,
    });

    return JSON.stringify(result, null, 2);
  } catch (error) {
    const elapsed = Date.now() - start_ts;
    const err_msg = error instanceof Error ? error.message : String(error);
    console.error('[get-formula-comments] handle_get_formula_with_comments — error', {
      error: err_msg,
      elapsed_ms: elapsed,
    });
    return JSON.stringify({ error: `Failed to load formula with comments: ${err_msg}` });
  }
}
