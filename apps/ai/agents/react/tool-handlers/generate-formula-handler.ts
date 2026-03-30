/**
 * Generate Formula Tool Handler — Structured Formulation Engine
 *
 * Handles the `generate_formula` ReAct tool using a 3-layer pipeline:
 *   Layer 1 — Phase-aware ingredient selection (water/oil/active/emulsifier/preservative/pH)
 *   Layer 2 — Regulatory & safety validation (usage limits, incompatibilities, mandatory checks)
 *   Layer 3 — Structured output formatting (phase-grouped table with warnings)
 *
 * Replaces the original score-weighted flat distribution with formulation-science-aware
 * percentage allocation per phase budget.
 *
 * @author AI Management System
 * @date 2026-03-30
 */

import { get_qdrant_service } from '../../../services/vector/qdrant-service';
import { createEmbeddingService } from '../../../services/embeddings/universal-embedding-service';
import {
  type FormulaPhase,
  FORMULA_PHASES,
  PHASE_LABELS,
  PHASE_CLASSIFICATION_KEYWORDS,
  REGULATORY_LIMITS,
  INCOMPATIBLE_PAIRS,
  get_phase_budgets,
  get_mandatory_ingredients,
} from '../config/formulation-rules';

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
 * A single ingredient in the generated formula with phase assignment.
 */
interface GeneratedIngredient {
  inci_name: string;
  trade_name: string;
  rm_code: string;
  phase: FormulaPhase;
  phase_label: string;
  function_desc: string;
  percentage: number;
  amount_grams: number;
  rationale: string;
  score: number;
  usage_min_pct?: number;
  usage_max_pct?: number;
}

/**
 * Validation warning from Layer 2.
 */
interface ValidationWarning {
  type: 'regulatory_limit' | 'incompatibility' | 'missing_mandatory' | 'percentage_adjusted';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  ingredient?: string;
}

/**
 * Internal representation of a Qdrant search result with phase info.
 */
interface ClassifiedIngredient {
  payload: Record<string, any>;
  score: number;
  source_query: string;
  phase: FormulaPhase;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default batch size when not specified */
const DEFAULT_BATCH_SIZE_GRAMS = 100;

/** Max ingredients per Qdrant search call */
const SEARCH_TOP_K = 15;

/** Min similarity score threshold */
const SCORE_THRESHOLD = 0.40;

/** Default max ingredients in formula */
const DEFAULT_MAX_INGREDIENTS = 14;

/** Qdrant projected payload fields for bandwidth optimization */
const PROJECTED_FIELDS = [
  'rm_code', 'trade_name', 'inci_name', 'supplier', 'category',
  'benefits', 'details', 'rm_cost', 'usage_min_pct', 'usage_max_pct',
];

// ---------------------------------------------------------------------------
// Layer 0: Qdrant Search Helpers
// ---------------------------------------------------------------------------

/**
 * Search Qdrant for ingredients matching a query string.
 *
 * @param query           - Natural language search query
 * @param top_k           - Max results to return
 * @param score_threshold - Minimum similarity score
 * @returns Array of scored ingredient results with payload
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
    withPayload: PROJECTED_FIELDS,
  });

  console.log('[generate-formula] search_ingredients — done', { result_count: results.length });
  return results.map((r: any) => ({ payload: r.payload || {}, score: r.score || 0 }));
}

/**
 * Extract a field from a Qdrant payload, handling multiple naming conventions.
 *
 * @param payload     - Qdrant document payload
 * @param field_names - Array of possible field names to check
 * @param fallback    - Default value if none found
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

/**
 * Extract a numeric field from payload.
 *
 * @param payload     - Qdrant document payload
 * @param field_names - Array of possible field names
 * @param fallback    - Default numeric value
 * @returns Parsed number or fallback
 */
function extract_number(payload: Record<string, any>, field_names: string[], fallback: number | undefined = undefined): number | undefined {
  for (const name of field_names) {
    if (payload[name] !== undefined && payload[name] !== null) {
      const val = parseFloat(String(payload[name]));
      if (!isNaN(val)) return val;
    }
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Layer 1: Phase-Aware Ingredient Classification
// ---------------------------------------------------------------------------

/**
 * Classify an ingredient into a formulation phase based on its payload fields.
 * Matches against category, benefits, details, and inci_name using
 * PHASE_CLASSIFICATION_KEYWORDS config.
 *
 * @param payload - Qdrant ingredient payload
 * @returns The best matching FormulaPhase
 */
function classify_phase(payload: Record<string, any>): FormulaPhase {
  const searchable = [
    extract_field(payload, ['category']),
    extract_field(payload, ['benefits', 'Benefits']),
    extract_field(payload, ['details']),
    extract_field(payload, ['inci_name', 'INCI_name', 'INCI Name']),
    extract_field(payload, ['trade_name', 'Trade_name', 'product_name']),
  ].join(' ').toLowerCase();

  // Check each phase in priority order (preservative > pH > emulsifier > oil > active > water > fragrance)
  for (const phase of FORMULA_PHASES) {
    const keywords = PHASE_CLASSIFICATION_KEYWORDS[phase];
    for (const keyword of keywords) {
      if (searchable.includes(keyword.toLowerCase())) {
        return phase;
      }
    }
  }

  // Default: if no match, classify as active (most Qdrant results from benefit searches are actives)
  return 'active_phase';
}

/**
 * Build targeted Qdrant search queries for each phase relevant to the product brief.
 *
 * @param product_type    - Cosmetic product type
 * @param target_benefits - Array of desired benefits
 * @returns Array of { query, target_phase } for multi-phase searching
 */
function build_phase_queries(
  product_type: string,
  target_benefits: string[],
): Array<{ query: string; target_phase: FormulaPhase }> {
  console.log('[generate-formula] build_phase_queries — start', { product_type, target_benefits });

  const queries: Array<{ query: string; target_phase: FormulaPhase }> = [];

  // Active phase: one query per benefit
  for (const benefit of target_benefits) {
    queries.push({
      query: `${benefit} active ingredient for ${product_type}`,
      target_phase: 'active_phase',
    });
  }

  // Oil phase
  queries.push({
    query: `emollient oil ingredient for ${product_type} formulation`,
    target_phase: 'oil_phase',
  });

  // Emulsifier phase
  queries.push({
    query: `emulsifier surfactant for ${product_type}`,
    target_phase: 'emulsifier_phase',
  });

  // Water phase / humectant
  queries.push({
    query: `humectant hydrating base ingredient for ${product_type}`,
    target_phase: 'water_phase',
  });

  console.log('[generate-formula] build_phase_queries — done', { query_count: queries.length });
  return queries;
}

// ---------------------------------------------------------------------------
// Layer 2: Regulatory & Safety Validation
// ---------------------------------------------------------------------------

/**
 * Look up the regulatory max percentage for an ingredient.
 * Priority: Qdrant payload usage_max_pct > REGULATORY_LIMITS config > null.
 *
 * @param inci_name    - INCI name of the ingredient
 * @param payload      - Qdrant payload (may contain usage_max_pct)
 * @returns Max allowed percentage, or undefined if no limit found
 */
function get_max_usage_pct(inci_name: string, payload: Record<string, any>): number | undefined {
  // 1. Check Qdrant payload first (most specific to the actual material)
  const db_max = extract_number(payload, ['usage_max_pct']);
  if (db_max !== undefined && db_max > 0) return db_max;

  // 2. Fallback to hardcoded regulatory limits
  const inci_lower = inci_name.toLowerCase();
  for (const [key, limit] of Object.entries(REGULATORY_LIMITS)) {
    if (inci_lower.includes(key)) {
      return limit.max_pct;
    }
  }

  return undefined;
}

/**
 * Look up the regulatory min percentage for an ingredient.
 *
 * @param inci_name - INCI name of the ingredient
 * @param payload   - Qdrant payload (may contain usage_min_pct)
 * @returns Min effective percentage, or undefined
 */
function get_min_usage_pct(inci_name: string, payload: Record<string, any>): number | undefined {
  const db_min = extract_number(payload, ['usage_min_pct']);
  if (db_min !== undefined && db_min > 0) return db_min;
  return undefined;
}

/**
 * Run the full validation layer on a generated formula.
 * Checks regulatory limits, incompatibilities, and mandatory ingredients.
 * Adjusts percentages and collects warnings.
 *
 * @param ingredients  - Array of generated ingredients (will be mutated for adjustments)
 * @param product_type - Product type for mandatory ingredient rules
 * @param raw_payloads - Map of rm_code → original Qdrant payload
 * @returns Array of validation warnings
 */
function validate_formula(
  ingredients: GeneratedIngredient[],
  product_type: string,
  raw_payloads: Map<string, Record<string, any>>,
): ValidationWarning[] {
  console.log('[generate-formula] validate_formula — start', { ingredient_count: ingredients.length });
  const warnings: ValidationWarning[] = [];

  // --- Check 1: Regulatory max usage limits ---
  for (const ing of ingredients) {
    const payload = raw_payloads.get(ing.rm_code) || {};
    const max_pct = get_max_usage_pct(ing.inci_name, payload);
    if (max_pct !== undefined && ing.percentage > max_pct) {
      const old_pct = ing.percentage;
      ing.percentage = max_pct;
      warnings.push({
        type: 'regulatory_limit',
        severity: 'critical',
        message: `${ing.inci_name}: reduced from ${old_pct}% to ${max_pct}% (regulatory max limit)`,
        ingredient: ing.inci_name,
      });
    }

    // Also check min effective concentration
    const min_pct = get_min_usage_pct(ing.inci_name, payload);
    if (min_pct !== undefined && ing.percentage < min_pct && ing.phase === 'active_phase') {
      const old_pct = ing.percentage;
      ing.percentage = min_pct;
      warnings.push({
        type: 'percentage_adjusted',
        severity: 'info',
        message: `${ing.inci_name}: raised from ${old_pct}% to ${min_pct}% (minimum effective concentration)`,
        ingredient: ing.inci_name,
      });
    }
  }

  // --- Check 2: Incompatible pairs ---
  const inci_names_lower = ingredients.map(i => i.inci_name.toLowerCase());
  for (const pair of INCOMPATIBLE_PAIRS) {
    const [a, b] = pair.ingredients;
    const has_a = inci_names_lower.some(name => name.includes(a));
    const has_b = inci_names_lower.some(name => name.includes(b));
    if (has_a && has_b) {
      warnings.push({
        type: 'incompatibility',
        severity: pair.severity === 'avoid' ? 'critical' : 'warning',
        message: `${pair.ingredients[0]} + ${pair.ingredients[1]}: ${pair.reason}${pair.condition ? ` (${pair.condition})` : ''}`,
      });
    }
  }

  // --- Check 3: Mandatory ingredients ---
  const mandatory = get_mandatory_ingredients(product_type);
  const present_phases = new Set(ingredients.map(i => i.phase));

  for (const req of mandatory) {
    if (!present_phases.has(req.phase)) {
      warnings.push({
        type: 'missing_mandatory',
        severity: 'warning',
        message: `${PHASE_LABELS[req.phase]} is empty — auto-adding ${req.default_inci} at ${req.default_pct}%`,
        ingredient: req.default_inci,
      });

      // Auto-add the mandatory ingredient
      ingredients.push({
        inci_name: req.default_inci,
        trade_name: req.default_inci,
        rm_code: 'AUTO',
        phase: req.phase,
        phase_label: PHASE_LABELS[req.phase],
        function_desc: PHASE_LABELS[req.phase].replace(' Phase', ''),
        percentage: req.default_pct,
        amount_grams: 0, // will be recalculated
        rationale: `Auto-added — ${PHASE_LABELS[req.phase]} is mandatory for ${product_type} formulations`,
        score: 1.0,
      });
    }
  }

  console.log('[generate-formula] validate_formula — done', { warning_count: warnings.length });
  return warnings;
}

// ---------------------------------------------------------------------------
// Layer 3: Percentage Allocation & Output Formatting
// ---------------------------------------------------------------------------

/**
 * Allocate percentages to ingredients within their phase budgets.
 * Uses score-weighted distribution WITHIN each phase, respecting
 * the phase's typical percentage budget from the product type template.
 *
 * Water phase is the "balance" phase and absorbs whatever is left
 * to ensure the formula sums to 100%.
 *
 * @param classified   - Ingredients grouped by phase
 * @param product_type - Product type for phase budget lookup
 * @returns Flattened array of ingredients with assigned percentages
 */
function allocate_percentages(
  classified: Map<FormulaPhase, ClassifiedIngredient[]>,
  product_type: string,
): GeneratedIngredient[] {
  console.log('[generate-formula] allocate_percentages — start', { product_type });

  const budgets = get_phase_budgets(product_type);
  const result: GeneratedIngredient[] = [];
  let total_non_water_pct = 0;

  // Process non-water phases first
  for (const phase of FORMULA_PHASES) {
    if (phase === 'water_phase') continue; // handle last

    const items = classified.get(phase) || [];
    if (items.length === 0) continue;

    const budget = budgets[phase];
    const phase_total = budget.typical_pct;

    // Score-weighted distribution within phase budget
    const total_score = items.reduce((sum, item) => sum + item.score, 0);

    for (const item of items) {
      const payload = item.payload;
      const inci = extract_field(payload, ['inci_name', 'INCI_name', 'INCI Name']);
      const trade = extract_field(payload, ['trade_name', 'Trade_name', 'product_name']);
      const rm_code = extract_field(payload, ['rm_code', 'code', 'RM_code']);
      const category = extract_field(payload, ['category']);
      const benefits = extract_field(payload, ['benefits', 'Benefits']);
      const usage_min = extract_number(payload, ['usage_min_pct']);
      const usage_max = extract_number(payload, ['usage_max_pct']);

      // Weighted percentage within phase
      const weight = total_score > 0 ? item.score / total_score : 1 / items.length;
      let pct = Math.round(weight * phase_total * 100) / 100;

      // Clamp to min 0.1% and max of phase budget
      pct = Math.max(0.1, Math.min(pct, budget.max_pct));

      // Respect Qdrant usage limits if present
      if (usage_max !== undefined && usage_max > 0 && pct > usage_max) {
        pct = usage_max;
      }
      if (usage_min !== undefined && usage_min > 0 && pct < usage_min) {
        pct = usage_min;
      }

      total_non_water_pct += pct;

      result.push({
        inci_name: inci || trade || 'Unknown Ingredient',
        trade_name: trade || inci,
        rm_code,
        phase,
        phase_label: PHASE_LABELS[phase],
        function_desc: category || benefits || PHASE_LABELS[phase].replace(' Phase', ''),
        percentage: pct,
        amount_grams: 0, // calculated later
        rationale: `Matched for "${item.source_query}" — ${benefits || category || 'general ingredient'}`,
        score: Math.round(item.score * 1000) / 1000,
        usage_min_pct: usage_min,
        usage_max_pct: usage_max,
      });
    }
  }

  // Water phase gets the remainder to sum to 100%
  const water_items = classified.get('water_phase') || [];
  const water_budget = 100 - total_non_water_pct;

  if (water_items.length > 0) {
    const total_water_score = water_items.reduce((sum, item) => sum + item.score, 0);

    for (const item of water_items) {
      const payload = item.payload;
      const inci = extract_field(payload, ['inci_name', 'INCI_name', 'INCI Name']);
      const trade = extract_field(payload, ['trade_name', 'Trade_name', 'product_name']);
      const rm_code = extract_field(payload, ['rm_code', 'code', 'RM_code']);
      const category = extract_field(payload, ['category']);
      const benefits = extract_field(payload, ['benefits', 'Benefits']);
      const usage_min = extract_number(payload, ['usage_min_pct']);
      const usage_max = extract_number(payload, ['usage_max_pct']);

      const weight = total_water_score > 0 ? item.score / total_water_score : 1 / water_items.length;
      // Water-phase humectants get a share; the rest is implicit "Aqua"
      const pct = Math.round(weight * Math.min(water_budget * 0.3, 15) * 100) / 100;

      result.push({
        inci_name: inci || trade || 'Unknown Ingredient',
        trade_name: trade || inci,
        rm_code,
        phase: 'water_phase',
        phase_label: PHASE_LABELS['water_phase'],
        function_desc: category || benefits || 'Humectant',
        percentage: Math.max(0.5, pct),
        amount_grams: 0,
        rationale: `Matched for "${item.source_query}" — ${benefits || category || 'hydration base'}`,
        score: Math.round(item.score * 1000) / 1000,
        usage_min_pct: usage_min,
        usage_max_pct: usage_max,
      });
    }
  }

  // Add "Aqua" as the water base (balance to 100%)
  const current_total = result.reduce((sum, i) => sum + i.percentage, 0);
  const aqua_pct = Math.round((100 - current_total) * 100) / 100;
  if (aqua_pct > 0) {
    result.unshift({
      inci_name: 'Aqua',
      trade_name: 'Purified Water',
      rm_code: 'WATER',
      phase: 'water_phase',
      phase_label: PHASE_LABELS['water_phase'],
      function_desc: 'Base solvent',
      percentage: aqua_pct,
      amount_grams: 0,
      rationale: 'Water base — balance phase to achieve 100% formula total',
      score: 1.0,
    });
  }

  console.log('[generate-formula] allocate_percentages — done', {
    ingredient_count: result.length,
    total_pct: result.reduce((s, i) => s + i.percentage, 0),
  });
  return result;
}

// ---------------------------------------------------------------------------
// Main Handler
// ---------------------------------------------------------------------------

/**
 * Handle the `generate_formula` ReAct tool call.
 *
 * Pipeline:
 *   1. Validate inputs
 *   2. Build phase-targeted Qdrant search queries
 *   3. Search and classify ingredients into phases
 *   4. De-duplicate within each phase, keep highest score
 *   5. Allocate percentages per phase budget
 *   6. Run regulatory & safety validation (Layer 2)
 *   7. Calculate amounts and format structured output (Layer 3)
 *
 * @param params - GenerateFormulaParams with product_type, target_benefits, etc.
 * @returns JSON string with the structured formula
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

    // --- Step 1: Build phase-targeted search queries ---
    const queries = build_phase_queries(params.product_type, params.target_benefits);

    // --- Step 2: Search Qdrant for each query ---
    const all_results: Array<{ payload: Record<string, any>; score: number; source_query: string }> = [];

    for (const q of queries) {
      const results = await search_ingredients(q.query, SEARCH_TOP_K, SCORE_THRESHOLD);
      for (const r of results) {
        all_results.push({ ...r, source_query: q.query.split(' ingredient')[0] || q.query });
      }
    }

    console.log('[generate-formula] total raw results', { count: all_results.length });

    // --- Step 3: Classify into phases and de-duplicate ---
    const phase_map = new Map<FormulaPhase, ClassifiedIngredient[]>();
    const seen_codes = new Map<string, ClassifiedIngredient>();

    for (const result of all_results) {
      const inci = extract_field(result.payload, ['inci_name', 'INCI_name', 'INCI Name']);
      const rm_code = extract_field(result.payload, ['rm_code', 'code', 'RM_code']);
      const key = rm_code || inci || JSON.stringify(result.payload).slice(0, 100);

      // Skip excluded ingredients
      if (excluded.has(inci.toLowerCase()) || excluded.has(rm_code.toLowerCase())) {
        continue;
      }

      // Skip "Aqua" / "Water" from search results — we add it explicitly
      if (inci.toLowerCase() === 'aqua' || inci.toLowerCase() === 'water') {
        continue;
      }

      const phase = classify_phase(result.payload);
      const classified: ClassifiedIngredient = { ...result, phase };

      // De-duplicate: keep highest score per ingredient
      const existing = seen_codes.get(key);
      if (!existing || result.score > existing.score) {
        seen_codes.set(key, classified);
      }
    }

    // Group by phase
    for (const item of seen_codes.values()) {
      const list = phase_map.get(item.phase) || [];
      list.push(item);
      phase_map.set(item.phase, list);
    }

    // --- Step 4: Limit ingredients per phase ---
    const budgets = get_phase_budgets(params.product_type);
    for (const [phase, items] of phase_map.entries()) {
      // Sort by score descending
      items.sort((a, b) => b.score - a.score);

      // Limit per phase: actives get more slots, others fewer
      const phase_limit = phase === 'active_phase'
        ? Math.min(items.length, Math.ceil(max_ingredients * 0.4))
        : phase === 'oil_phase'
          ? Math.min(items.length, Math.ceil(max_ingredients * 0.2))
          : Math.min(items.length, 3);

      phase_map.set(phase, items.slice(0, phase_limit));
    }

    const total_classified = Array.from(phase_map.values()).reduce((s, arr) => s + arr.length, 0);
    console.log('[generate-formula] classified ingredients', { total: total_classified });

    if (total_classified === 0) {
      return JSON.stringify({
        error: 'No matching ingredients found in the database. Try broader search terms.',
        searched_benefits: params.target_benefits,
        product_type: params.product_type,
      });
    }

    // --- Step 5: Allocate percentages (Layer 1) ---
    let ingredients = allocate_percentages(phase_map, params.product_type);

    // --- Step 6: Validate (Layer 2) ---
    const raw_payloads = new Map<string, Record<string, any>>();
    for (const item of seen_codes.values()) {
      const rm_code = extract_field(item.payload, ['rm_code', 'code', 'RM_code']);
      if (rm_code) raw_payloads.set(rm_code, item.payload);
    }

    const warnings = validate_formula(ingredients, params.product_type, raw_payloads);

    // Re-normalize after validation adjustments to sum to 100%
    const post_validation_total = ingredients.reduce((s, i) => s + i.percentage, 0);
    if (Math.abs(post_validation_total - 100) > 0.5) {
      // Find aqua and adjust
      const aqua = ingredients.find(i => i.inci_name === 'Aqua');
      if (aqua) {
        aqua.percentage = Math.round((aqua.percentage + (100 - post_validation_total)) * 100) / 100;
      }
    }

    // --- Step 7: Calculate amounts (Layer 3) ---
    for (const ing of ingredients) {
      ing.amount_grams = Math.round((ing.percentage / 100) * batch_size * 100) / 100;
    }

    // Sort: group by phase in standard order
    const phase_order = new Map(FORMULA_PHASES.map((p, i) => [p, i]));
    ingredients.sort((a, b) => {
      const phase_diff = (phase_order.get(a.phase) || 99) - (phase_order.get(b.phase) || 99);
      if (phase_diff !== 0) return phase_diff;
      return b.percentage - a.percentage; // within phase, highest % first
    });

    // Estimated cost
    const estimated_cost = ingredients.reduce((sum, ing) => {
      const payload = raw_payloads.get(ing.rm_code) || {};
      const cost_per_kg = extract_number(payload, ['rm_cost', 'cost', 'price'], 0) || 0;
      return sum + cost_per_kg * (ing.amount_grams / 1000);
    }, 0);

    // --- Build output ---
    const formula = {
      formula_name: `AI-${params.product_type}-${params.target_benefits.join('-').slice(0, 30)}`,
      product_type: params.product_type,
      target_benefits: params.target_benefits,
      batch_size_grams: batch_size,

      // Phase-grouped ingredients
      phases: FORMULA_PHASES.reduce((acc, phase) => {
        const phase_items = ingredients.filter(i => i.phase === phase);
        if (phase_items.length > 0) {
          acc[PHASE_LABELS[phase]] = phase_items.map(i => ({
            inci_name: i.inci_name,
            trade_name: i.trade_name,
            rm_code: i.rm_code,
            function: i.function_desc,
            percentage: i.percentage,
            amount_grams: i.amount_grams,
            rationale: i.rationale,
            usage_limit: i.usage_max_pct ? `max ${i.usage_max_pct}%` : undefined,
          }));
        }
        return acc;
      }, {} as Record<string, any[]>),

      // Flat list for backward compatibility
      ingredients: ingredients.map(i => ({
        inci_name: i.inci_name,
        trade_name: i.trade_name,
        rm_code: i.rm_code,
        phase: i.phase_label,
        function: i.function_desc,
        percentage: i.percentage,
        amount_grams: i.amount_grams,
        rationale: i.rationale,
        score: i.score,
      })),

      // Summary
      total_percentage: Math.round(ingredients.reduce((s, i) => s + i.percentage, 0) * 100) / 100,
      total_ingredients: ingredients.length,
      estimated_cost_thb: Math.round(estimated_cost * 100) / 100,
      ai_generated: true,
      generation_prompt: `${params.product_type} with ${params.target_benefits.join(', ')}${params.reference_notes ? ` — ${params.reference_notes}` : ''}`,

      // Validation results (Layer 2)
      warnings: warnings.map(w => ({
        type: w.type,
        severity: w.severity,
        message: w.message,
      })),

      notes: [
        `Structured formula with ${Object.keys(FORMULA_PHASES).length}-phase architecture`,
        `Generated from ${total_classified} ingredients selected from Qdrant (raw_materials_myskin)`,
        `Product template: ${params.product_type}`,
        warnings.length > 0 ? `${warnings.length} validation warning(s) — review before production` : 'No validation warnings',
        params.constraints?.budget_per_kg ? `Budget constraint: ≤${params.constraints.budget_per_kg} THB/kg` : null,
        'AI-suggested — R&D should validate before production',
      ].filter(Boolean),
    };

    const elapsed = Date.now() - start_ts;
    console.log('[generate-formula] handle_generate_formula — done', {
      ingredient_count: ingredients.length,
      warning_count: warnings.length,
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
