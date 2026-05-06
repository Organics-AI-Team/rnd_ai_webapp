/**
 * Search Reference Formulas Tool Handler
 * Handles the `search_reference_formulas` ReAct tool by querying the
 * formulas collection in MongoDB for existing formulas matching a search
 * query, with optional filters for status, client, and benefits.
 *
 * @author AI Management System
 * @date 2026-03-30
 */

import client_promise from '@rnd-ai/shared-database';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Input parameters for the search_reference_formulas tool.
 *
 * @param query    - Search text to match against formula name, benefits, ingredients
 * @param status   - Optional filter: draft, testing, approved, rejected
 * @param client   - Optional filter: client name
 * @param benefits - Optional filter: target benefit keywords
 * @param limit    - Max results (default: 10, capped at 20)
 */
interface SearchReferenceFormulasParams {
  query: string;
  status?: string;
  client?: string;
  benefits?: string[];
  limit?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum formulas returned per search */
const MAX_RESULTS = 20;

/** Default result limit */
const DEFAULT_LIMIT = 10;

// ---------------------------------------------------------------------------
// Main Handler
// ---------------------------------------------------------------------------

/**
 * Handle the `search_reference_formulas` ReAct tool call.
 *
 * Workflow:
 * 1. Build a MongoDB query with regex text matching + optional filters
 * 2. Search the formulas collection
 * 3. Return matching formulas with ingredient breakdowns
 *
 * @param params - SearchReferenceFormulasParams with query, optional filters
 * @returns JSON string with matching formulas
 */
export async function handle_search_reference_formulas(
  params: SearchReferenceFormulasParams,
): Promise<string> {
  const start_ts = Date.now();
  console.log('[search-ref-formulas] handle_search_reference_formulas — start', {
    query: params.query,
    status: params.status,
    client: params.client,
    benefits: params.benefits,
    limit: params.limit,
  });

  if (!params.query) {
    return JSON.stringify({ error: 'query parameter is required (e.g. "anti-aging serum")' });
  }

  try {
    const client = await client_promise;
    const db = client.db();
    const safe_limit = Math.min(params.limit || DEFAULT_LIMIT, MAX_RESULTS);

    // Build filter with regex for flexible text matching
    const regex_pattern = params.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const text_filter: Record<string, any> = {
      $or: [
        { formulaName: { $regex: regex_pattern, $options: 'i' } },
        { 'ingredients.productName': { $regex: regex_pattern, $options: 'i' } },
        { 'ingredients.inci_name': { $regex: regex_pattern, $options: 'i' } },
        { targetBenefits: { $regex: regex_pattern, $options: 'i' } },
        { remarks: { $regex: regex_pattern, $options: 'i' } },
        { client: { $regex: regex_pattern, $options: 'i' } },
      ],
    };

    // Apply optional filters
    const conditions: Record<string, any>[] = [text_filter];

    if (params.status) {
      conditions.push({ status: params.status });
    }
    if (params.client) {
      conditions.push({ client: { $regex: params.client, $options: 'i' } });
    }
    if (params.benefits && params.benefits.length > 0) {
      conditions.push({
        targetBenefits: {
          $in: params.benefits.map(b => new RegExp(b, 'i')),
        },
      });
    }

    const final_filter = conditions.length > 1
      ? { $and: conditions }
      : conditions[0];

    const formulas = await db
      .collection('formulas')
      .find(final_filter)
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(safe_limit)
      .toArray();

    console.log('[search-ref-formulas] query returned', { count: formulas.length });

    // Format results for AI consumption
    const results = formulas.map((f) => ({
      _id: f._id.toString(),
      formula_code: f.formulaCode || null,
      formula_name: f.formulaName,
      version: f.version || 1,
      status: f.status || 'draft',
      client: f.client || null,
      target_benefits: f.targetBenefits || [],
      ingredient_count: (f.ingredients || []).length,
      ingredients: (f.ingredients || []).map((ing: any) => ({
        rm_code: ing.rm_code,
        product_name: ing.productName,
        inci_name: ing.inci_name || null,
        percentage: ing.percentage || null,
        amount: ing.amount,
      })),
      total_amount: f.totalAmount || null,
      remarks: f.remarks || null,
      ai_generated: f.aiGenerated || false,
      parent_formula_id: f.parentFormulaId || null,
      created_at: f.createdAt,
      updated_at: f.updatedAt,
    }));

    const elapsed = Date.now() - start_ts;
    console.log('[search-ref-formulas] handle_search_reference_formulas — done', {
      result_count: results.length,
      elapsed_ms: elapsed,
    });

    return JSON.stringify({
      query: params.query,
      filters_applied: {
        status: params.status || null,
        client: params.client || null,
        benefits: params.benefits || null,
      },
      result_count: results.length,
      formulas: results,
    }, null, 2);
  } catch (error) {
    const elapsed = Date.now() - start_ts;
    const err_msg = error instanceof Error ? error.message : String(error);
    console.error('[search-ref-formulas] handle_search_reference_formulas — error', {
      error: err_msg,
      elapsed_ms: elapsed,
    });
    return JSON.stringify({ error: `Reference formula search failed: ${err_msg}` });
  }
}
