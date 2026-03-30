/**
 * Generate Formula Tool Handler
 * Handles the `generate_formula` ReAct tool by searching Qdrant for suitable
 * ingredients based on a concept brief, selecting the best matches, calculating
 * percentages, and returning a structured formula ready for saving.
 *
 * @author AI Management System
 * @date 2026-03-30
 */

import { get_qdrant_service } from '../../../services/vector/qdrant-service';
import { createEmbeddingService } from '../../../services/embeddings/universal-embedding-service';
import client_promise from '@rnd-ai/shared-database';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Input parameters for the generate_formula tool.
 *
 * @param product_type     - Type of cosmetic product (e.g. "serum", "cream", "toner")
 * @param target_benefits  - Desired benefits (e.g. ["anti-aging", "moisturizing"])
 * @param constraints      - Optional constraints: budget_per_kg, excluded_ingredients, max_ingredients
 * @param batch_size_grams - Target batch size in grams (default: 100)
 * @param reference_notes  - Optional additional context or styling notes
 */
interface GenerateFormulaParams {
  product_type: string;
  target_benefits: string[];
  constraints?: {
    budget_per_kg?: number;
    excluded_ingredients?: string[];
    max_ingredients?: number;
  };
  batch_size_grams?: number;
  reference_notes?: string;
}

/**
 * A single ingredient in the generated formula.
 */
interface GeneratedIngredient {
  inci_name: string;
  trade_name: string;
  rm_code: string;
  function: string;
  percentage: number;
  amount_grams: number;
  rationale: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default batch size when not specified */
const DEFAULT_BATCH_SIZE_GRAMS = 100;

/** Max ingredients per Qdrant search call */
const SEARCH_TOP_K = 15;

/** Min similarity score threshold */
const SCORE_THRESHOLD = 0.45;

/** Default max ingredients in formula */
const DEFAULT_MAX_INGREDIENTS = 12;

/**
 * Base formula structures by product type.
 * Provides typical percentage ranges for common ingredient categories.
 */
const PRODUCT_TYPE_TEMPLATES: Record<string, { base_water_pct: number; active_range: [number, number]; emulsifier_range: [number, number] }> = {
  serum: { base_water_pct: 70, active_range: [5, 20], emulsifier_range: [0, 2] },
  cream: { base_water_pct: 60, active_range: [5, 15], emulsifier_range: [3, 6] },
  lotion: { base_water_pct: 65, active_range: [3, 10], emulsifier_range: [2, 5] },
  toner: { base_water_pct: 85, active_range: [2, 10], emulsifier_range: [0, 1] },
  cleanser: { base_water_pct: 55, active_range: [2, 8], emulsifier_range: [5, 12] },
  mask: { base_water_pct: 60, active_range: [5, 15], emulsifier_range: [2, 5] },
  sunscreen: { base_water_pct: 50, active_range: [10, 25], emulsifier_range: [3, 6] },
  shampoo: { base_water_pct: 60, active_range: [2, 8], emulsifier_range: [8, 18] },
};

// ---------------------------------------------------------------------------
// Helper: Search ingredients from Qdrant
// ---------------------------------------------------------------------------

/**
 * Search Qdrant for ingredients matching a query string.
 *
 * @param query           - Natural language search query
 * @param top_k           - Max results to return
 * @param score_threshold - Minimum similarity score
 * @returns Array of scored ingredient results
 */
async function search_ingredients(
  query: string,
  top_k: number = SEARCH_TOP_K,
  score_threshold: number = SCORE_THRESHOLD,
): Promise<Array<{ payload: Record<string, any>; score: number }>> {
  console.log('[generate-formula] search_ingredients — start', { query, top_k });

  const embedding_service = createEmbeddingService();
  const query_vector = await embedding_service.createEmbedding(query);

  const qdrant = get_qdrant_service();
  const results = await qdrant.search('raw_materials_myskin', query_vector, {
    topK: top_k,
    scoreThreshold: score_threshold,
    withPayload: true,
  });

  console.log('[generate-formula] search_ingredients — done', { result_count: results.length });
  return results.map((r: any) => ({ payload: r.payload || {}, score: r.score || 0 }));
}

/**
 * Extract a field from a Qdrant payload, handling multiple naming conventions.
 *
 * @param payload    - Qdrant document payload
 * @param field_names - Array of possible field names to check
 * @param fallback   - Default value if none found
 * @returns The field value or fallback
 */
function extract_field(payload: Record<string, any>, field_names: string[], fallback: string = ''): string {
  for (const name of field_names) {
    if (payload[name] !== undefined && payload[name] !== null && payload[name] !== '') {
      return String(payload[name]);
    }
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Main Handler
// ---------------------------------------------------------------------------

/**
 * Handle the `generate_formula` ReAct tool call.
 *
 * Workflow:
 * 1. Parse and validate params
 * 2. Build search queries from product_type + target_benefits
 * 3. Search Qdrant for matching ingredients
 * 4. De-duplicate and rank by relevance score
 * 5. Assign percentages based on product type template
 * 6. Return structured formula JSON
 *
 * @param params - GenerateFormulaParams with product_type, target_benefits, etc.
 * @returns JSON string with the generated formula
 */
export async function handle_generate_formula(params: GenerateFormulaParams): Promise<string> {
  const start_ts = Date.now();
  console.log('[generate-formula] handle_generate_formula — start', {
    product_type: params.product_type,
    target_benefits: params.target_benefits,
    batch_size_grams: params.batch_size_grams,
  });

  if (!params.product_type) {
    return JSON.stringify({ error: 'product_type is required (e.g. "serum", "cream", "toner")' });
  }
  if (!params.target_benefits || params.target_benefits.length === 0) {
    return JSON.stringify({ error: 'target_benefits array is required (e.g. ["anti-aging", "moisturizing"])' });
  }

  try {
    const batch_size = params.batch_size_grams || DEFAULT_BATCH_SIZE_GRAMS;
    const max_ingredients = params.constraints?.max_ingredients || DEFAULT_MAX_INGREDIENTS;
    const excluded = new Set((params.constraints?.excluded_ingredients || []).map(s => s.toLowerCase()));

    // --- Step 1: Search for ingredients matching each benefit ---
    const all_results: Array<{ payload: Record<string, any>; score: number; source_query: string }> = [];

    for (const benefit of params.target_benefits) {
      const query = `${benefit} ingredient for ${params.product_type}`;
      const results = await search_ingredients(query, SEARCH_TOP_K, SCORE_THRESHOLD);
      for (const r of results) {
        all_results.push({ ...r, source_query: benefit });
      }
    }

    // Also search for product-type base ingredients
    const base_query = `base ingredients for ${params.product_type} formulation`;
    const base_results = await search_ingredients(base_query, 8, SCORE_THRESHOLD);
    for (const r of base_results) {
      all_results.push({ ...r, source_query: 'base' });
    }

    console.log('[generate-formula] total raw results', { count: all_results.length });

    // --- Step 2: De-duplicate by rm_code, keep highest score ---
    const seen_codes = new Map<string, typeof all_results[0]>();
    for (const result of all_results) {
      const rm_code = extract_field(result.payload, ['rm_code', 'code', 'RM_code'], '');
      const inci = extract_field(result.payload, ['inci_name', 'INCI_name', 'INCI Name'], '');
      const key = rm_code || inci || JSON.stringify(result.payload).slice(0, 100);

      if (excluded.has(inci.toLowerCase()) || excluded.has(rm_code.toLowerCase())) {
        continue;
      }

      const existing = seen_codes.get(key);
      if (!existing || result.score > existing.score) {
        seen_codes.set(key, result);
      }
    }

    // --- Step 3: Sort by score and take top N ---
    const ranked = Array.from(seen_codes.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, max_ingredients);

    console.log('[generate-formula] ranked ingredients', { count: ranked.length });

    if (ranked.length === 0) {
      return JSON.stringify({
        error: 'No matching ingredients found in the database. Try broader search terms.',
        searched_benefits: params.target_benefits,
        product_type: params.product_type,
      });
    }

    // --- Step 4: Assign percentages ---
    const template = PRODUCT_TYPE_TEMPLATES[params.product_type.toLowerCase()] ||
      PRODUCT_TYPE_TEMPLATES['serum'];

    const total_active_pct = 100 - template.base_water_pct;
    const per_ingredient_pct = total_active_pct / ranked.length;

    const ingredients: GeneratedIngredient[] = ranked.map((item, index) => {
      const payload = item.payload;
      const inci = extract_field(payload, ['inci_name', 'INCI_name', 'INCI Name']);
      const trade = extract_field(payload, ['trade_name', 'Trade_name', 'product_name']);
      const rm_code = extract_field(payload, ['rm_code', 'code', 'RM_code']);
      const func = extract_field(payload, ['Function', 'function', 'category']);
      const benefits = extract_field(payload, ['benefits', 'Benefits']);

      // Higher-scored ingredients get larger percentage share
      const score_weight = item.score / ranked.reduce((sum, r) => sum + r.score, 0);
      const pct = Math.round(score_weight * total_active_pct * 100) / 100;

      return {
        inci_name: inci || trade || `Ingredient ${index + 1}`,
        trade_name: trade || inci,
        rm_code,
        function: func,
        percentage: Math.max(0.5, Math.min(pct, 30)),
        amount_grams: Math.round((pct / 100) * batch_size * 100) / 100,
        rationale: `Matched for "${item.source_query}" — ${benefits || func || 'general active'}`,
        score: Math.round(item.score * 1000) / 1000,
      };
    });

    // Normalise percentages to sum to total_active_pct
    const current_sum = ingredients.reduce((s, i) => s + i.percentage, 0);
    if (current_sum > 0) {
      const scale = total_active_pct / current_sum;
      for (const ing of ingredients) {
        ing.percentage = Math.round(ing.percentage * scale * 100) / 100;
        ing.amount_grams = Math.round((ing.percentage / 100) * batch_size * 100) / 100;
      }
    }

    // --- Step 5: Build formula output ---
    const estimated_cost = ingredients.reduce((sum, ing) => {
      const cost = extract_field(
        ranked.find(r => extract_field(r.payload, ['rm_code', 'code']) === ing.rm_code)?.payload || {},
        ['cost', 'rm_cost', 'price'],
        '0',
      );
      return sum + (parseFloat(cost) || 0) * (ing.amount_grams / 1000);
    }, 0);

    const formula = {
      formula_name: `AI-${params.product_type}-${params.target_benefits.join('-').slice(0, 30)}`,
      product_type: params.product_type,
      target_benefits: params.target_benefits,
      batch_size_grams: batch_size,
      base_water_percentage: template.base_water_pct,
      ingredients,
      total_active_percentage: Math.round(ingredients.reduce((s, i) => s + i.percentage, 0) * 100) / 100,
      estimated_cost_thb: Math.round(estimated_cost * 100) / 100,
      ai_generated: true,
      generation_prompt: `${params.product_type} with ${params.target_benefits.join(', ')}${params.reference_notes ? ` — ${params.reference_notes}` : ''}`,
      notes: [
        `Generated from ${ranked.length} ingredients selected from Qdrant (raw_materials_myskin)`,
        `Product template: ${params.product_type} (water base ${template.base_water_pct}%)`,
        params.constraints?.budget_per_kg ? `Budget constraint: ≤${params.constraints.budget_per_kg} THB/kg` : null,
        'Percentages are AI-suggested — R&D should validate before production',
      ].filter(Boolean),
    };

    const elapsed = Date.now() - start_ts;
    console.log('[generate-formula] handle_generate_formula — done', {
      ingredient_count: ingredients.length,
      elapsed_ms: elapsed,
    });

    return JSON.stringify(formula, null, 2);
  } catch (error) {
    const elapsed = Date.now() - start_ts;
    const err_msg = error instanceof Error ? error.message : String(error);
    console.error('[generate-formula] handle_generate_formula — error', { error: err_msg, elapsed_ms: elapsed });
    return JSON.stringify({ error: `Formula generation failed: ${err_msg}` });
  }
}
