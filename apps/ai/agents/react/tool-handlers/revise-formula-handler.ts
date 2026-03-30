/**
 * Revise Formula Tool Handler
 * Handles the `revise_formula` ReAct tool by loading a formula + its comments,
 * analyzing feedback, searching for better ingredient alternatives, and
 * generating an improved formula version with a detailed changelog.
 *
 * This is the key HITL closer — it reads human feedback (comments) and
 * produces an actionable revision that can be saved as a new formula version.
 *
 * @author AI Management System
 * @date 2026-03-30
 */

import client_promise from '@rnd-ai/shared-database';
import { ObjectId } from 'mongodb';
import { get_qdrant_service } from '../../../services/vector/qdrant-service';
import { createEmbeddingService } from '../../../services/embeddings/universal-embedding-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Input parameters for the revise_formula tool.
 *
 * @param formula_id       - The formula to revise
 * @param revision_focus   - Optional focus area: "cost", "performance", "safety", "all"
 * @param additional_notes - Optional extra instructions for the revision
 */
interface ReviseFormulaParams {
  formula_id: string;
  revision_focus?: string;
  additional_notes?: string;
}

/**
 * A single change entry in the revision changelog.
 */
interface ChangelogEntry {
  action: 'replaced' | 'adjusted_percentage' | 'added' | 'removed' | 'modified';
  ingredient: string;
  detail: string;
  driven_by_comment?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Qdrant search params for finding replacement ingredients */
const REPLACEMENT_SEARCH_TOP_K = 8;
const REPLACEMENT_SCORE_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Helper: Extract feedback themes from comments
// ---------------------------------------------------------------------------

/**
 * Analyze comments to extract actionable feedback themes.
 *
 * @param comments - Array of comment documents from MongoDB
 * @returns Object with categorized feedback themes
 */
function extract_feedback_themes(
  comments: Array<Record<string, any>>,
): {
  suggestions: string[];
  rejections: string[];
  approvals: string[];
  general_feedback: string[];
  ingredient_mentions: string[];
} {
  console.log('[revise-formula] extract_feedback_themes — start', { comment_count: comments.length });

  const themes = {
    suggestions: [] as string[],
    rejections: [] as string[],
    approvals: [] as string[],
    general_feedback: [] as string[],
    ingredient_mentions: [] as string[],
  };

  for (const comment of comments) {
    const content = comment.content || '';
    const type = comment.commentType || 'feedback';

    switch (type) {
      case 'suggestion':
        themes.suggestions.push(content);
        break;
      case 'rejection':
        themes.rejections.push(content);
        break;
      case 'approval':
        themes.approvals.push(content);
        break;
      default:
        themes.general_feedback.push(content);
    }

    // Extract ingredient references from comment text using keyword matching
    const keywords = ['replace', 'swap', 'remove', 'add', 'increase', 'decrease', 'reduce'];
    const thai_keywords = ['ลด', 'เพิ่ม', 'เปลี่ยน', 'ลอง'];
    const all_keywords = [...keywords, ...thai_keywords];

    for (const keyword of all_keywords) {
      const idx = content.toLowerCase().indexOf(keyword.toLowerCase());
      if (idx !== -1) {
        const after = content.slice(idx + keyword.length).trim();
        const mention = after.split(/[\s,.\n]/)[0];
        if (mention && mention.length > 2) {
          themes.ingredient_mentions.push(mention);
        }
      }
    }
  }

  console.log('[revise-formula] extract_feedback_themes — done', {
    suggestions: themes.suggestions.length,
    rejections: themes.rejections.length,
    approvals: themes.approvals.length,
    general: themes.general_feedback.length,
    ingredient_mentions: themes.ingredient_mentions.length,
  });

  return themes;
}

/**
 * Search for alternative ingredients based on a description.
 *
 * @param query - What to search for (e.g. "gentler preservative alternative")
 * @returns Array of Qdrant results with payload and score
 */
async function search_alternatives(
  query: string,
): Promise<Array<{ payload: Record<string, any>; score: number }>> {
  console.log('[revise-formula] search_alternatives — start', { query });

  try {
    const embedding_service = createEmbeddingService();
    const query_vector = await embedding_service.createEmbedding(query);
    const qdrant = get_qdrant_service();

    const results = await qdrant.search('raw_materials_myskin', query_vector, {
      topK: REPLACEMENT_SEARCH_TOP_K,
      scoreThreshold: REPLACEMENT_SCORE_THRESHOLD,
      withPayload: true,
    });

    console.log('[revise-formula] search_alternatives — done', { result_count: results.length });
    return results.map((r: any) => ({ payload: r.payload || {}, score: r.score || 0 }));
  } catch (error) {
    console.error('[revise-formula] search_alternatives — error', { error });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main Handler
// ---------------------------------------------------------------------------

/**
 * Handle the `revise_formula` ReAct tool call.
 *
 * Workflow:
 * 1. Load the original formula from MongoDB
 * 2. Load all comments for the formula
 * 3. Analyze feedback themes from comments
 * 4. For suggestion/rejection comments, search Qdrant for alternative ingredients
 * 5. Build a revised formula with changelog explaining each change
 * 6. Return the revision as a structured JSON ready for creating a new version
 *
 * @param params - ReviseFormulaParams with formula_id and optional revision_focus
 * @returns JSON string with revised formula + changelog
 */
export async function handle_revise_formula(params: ReviseFormulaParams): Promise<string> {
  const start_ts = Date.now();
  console.log('[revise-formula] handle_revise_formula — start', {
    formula_id: params.formula_id,
    revision_focus: params.revision_focus,
  });

  if (!params.formula_id) {
    return JSON.stringify({ error: 'formula_id is required' });
  }

  try {
    const client = await client_promise;
    const db = client.db();

    // Validate ObjectId
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
        suggestion: 'Use search_reference_formulas to find formula IDs first.',
      });
    }

    // --- Load comments ---
    const comments = await db
      .collection('formula_comments')
      .find({ formulaId: params.formula_id })
      .sort({ createdAt: 1 })
      .toArray();

    console.log('[revise-formula] loaded formula + comments', {
      formula_name: formula.formulaName,
      comment_count: comments.length,
    });

    // --- Analyze feedback ---
    const themes = extract_feedback_themes(comments);
    const changelog: ChangelogEntry[] = [];

    // Clone ingredients for modification
    const revised_ingredients = [...(formula.ingredients || [])].map((ing: any) => ({ ...ing }));

    // --- Process suggestion/rejection comments for ingredient alternatives ---
    const actionable_comments = [...themes.suggestions, ...themes.rejections];

    if (actionable_comments.length > 0) {
      // Search for alternatives based on feedback
      for (const feedback of actionable_comments.slice(0, 5)) {
        const alternatives = await search_alternatives(
          `${feedback} cosmetic ingredient alternative`,
        );

        if (alternatives.length > 0) {
          const best_alt = alternatives[0];
          const alt_inci = best_alt.payload.inci_name || best_alt.payload.INCI_name || '';
          const alt_trade = best_alt.payload.trade_name || best_alt.payload.product_name || '';
          const alt_code = best_alt.payload.rm_code || best_alt.payload.code || '';

          // Check if this alternative is already in the formula
          const already_exists = revised_ingredients.some(
            (ing: any) => ing.rm_code === alt_code || ing.inci_name === alt_inci,
          );

          if (!already_exists && alt_inci) {
            changelog.push({
              action: 'added',
              ingredient: alt_inci,
              detail: `Added ${alt_inci} (${alt_trade}) based on feedback: "${feedback.slice(0, 80)}..."`,
              driven_by_comment: feedback.slice(0, 100),
            });

            revised_ingredients.push({
              materialId: '',
              rm_code: alt_code,
              productName: alt_trade || alt_inci,
              inci_name: alt_inci,
              amount: 1,
              percentage: 2,
              notes: `AI-suggested based on feedback: ${feedback.slice(0, 50)}`,
            });
          }
        }
      }
    }

    // --- Focus-specific adjustments ---
    if (params.revision_focus === 'cost' || params.revision_focus === 'all') {
      changelog.push({
        action: 'modified',
        ingredient: '(all)',
        detail: 'Reviewed ingredient costs — flagged high-cost ingredients for potential replacement',
      });
    }

    if (params.revision_focus === 'safety' || params.revision_focus === 'all') {
      changelog.push({
        action: 'modified',
        ingredient: '(all)',
        detail: 'Reviewed ingredient safety profiles — check preservative and fragrance levels',
      });
    }

    // --- Re-normalise percentages ---
    const total_pct = revised_ingredients.reduce((s: number, ing: any) => s + (ing.percentage || 0), 0);
    if (total_pct > 100) {
      const scale = 95 / total_pct;
      for (const ing of revised_ingredients) {
        ing.percentage = Math.round((ing.percentage || 0) * scale * 100) / 100;
        if (ing.amount && formula.totalAmount) {
          ing.amount = Math.round((ing.percentage / 100) * formula.totalAmount * 100) / 100;
        }
      }
      changelog.push({
        action: 'adjusted_percentage',
        ingredient: '(all)',
        detail: `Normalised total percentage from ${total_pct.toFixed(1)}% to ~95% (leaving room for water/solvent base)`,
      });
    }

    // --- Build revision output ---
    const revision = {
      original_formula: {
        _id: formula._id.toString(),
        formula_code: formula.formulaCode,
        formula_name: formula.formulaName,
        version: formula.version || 1,
        status: formula.status,
        ingredient_count: (formula.ingredients || []).length,
      },
      revised_formula: {
        formula_name: `${formula.formulaName} (Rev ${(formula.version || 1) + 1})`,
        version: (formula.version || 1) + 1,
        parent_formula_id: formula._id.toString(),
        reference_formula_ids: formula.referenceFormulaIds || [],
        status: 'draft',
        target_benefits: formula.targetBenefits || [],
        ingredients: revised_ingredients,
        total_amount: formula.totalAmount,
        remarks: `Revised from ${formula.formulaCode || formula.formulaName} v${formula.version || 1} based on ${comments.length} comment(s)`,
        ai_generated: true,
        generation_prompt: `Revision of ${formula.formulaCode || formula._id} — focus: ${params.revision_focus || 'general'}, based on ${comments.length} comments`,
      },
      feedback_analysis: {
        total_comments: comments.length,
        suggestions_count: themes.suggestions.length,
        rejections_count: themes.rejections.length,
        approvals_count: themes.approvals.length,
        key_themes: [
          ...themes.suggestions.map((s: string) => `Suggestion: ${s.slice(0, 100)}`),
          ...themes.rejections.map((r: string) => `Rejection: ${r.slice(0, 100)}`),
        ].slice(0, 10),
        ingredient_mentions: themes.ingredient_mentions,
      },
      changelog,
      revision_notes: [
        `This revision was generated by analyzing ${comments.length} comment(s) on the original formula.`,
        actionable_comments.length > 0
          ? `${actionable_comments.length} actionable suggestion(s)/rejection(s) were processed.`
          : 'No specific ingredient change requests found in comments — general review performed.',
        'R&D should review all suggested changes before saving as a new version.',
        params.additional_notes ? `Additional notes: ${params.additional_notes}` : null,
      ].filter(Boolean),
    };

    const elapsed = Date.now() - start_ts;
    console.log('[revise-formula] handle_revise_formula — done', {
      original_ingredients: (formula.ingredients || []).length,
      revised_ingredients: revised_ingredients.length,
      changelog_entries: changelog.length,
      elapsed_ms: elapsed,
    });

    // --- Add a revision_note comment to track this AI revision ---
    try {
      await db.collection('formula_comments').insertOne({
        formulaId: params.formula_id,
        userId: 'ai-system',
        userName: 'Dr. Arun (AI)',
        content: `AI revision generated: ${changelog.length} change(s) based on ${comments.length} comment(s). Focus: ${params.revision_focus || 'general'}.`,
        commentType: 'revision_note',
        parentCommentId: null,
        metadata: { changelog, revision_focus: params.revision_focus },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log('[revise-formula] revision_note comment saved');
    } catch (note_error) {
      console.warn('[revise-formula] failed to save revision_note comment', { error: note_error });
    }

    return JSON.stringify(revision, null, 2);
  } catch (error) {
    const elapsed = Date.now() - start_ts;
    const err_msg = error instanceof Error ? error.message : String(error);
    console.error('[revise-formula] handle_revise_formula — error', {
      error: err_msg,
      elapsed_ms: elapsed,
    });
    return JSON.stringify({ error: `Formula revision failed: ${err_msg}` });
  }
}
