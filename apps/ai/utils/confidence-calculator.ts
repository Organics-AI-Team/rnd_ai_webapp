/**
 * Confidence Calculator Utility
 *
 * Computes real confidence scores from available signals instead of
 * returning hardcoded 0.8 defaults. Used across all AI agents, search
 * services, and response pipelines to produce meaningful confidence
 * values that reflect actual data quality.
 *
 * Signal categories:
 *   1. Search score   — Qdrant similarity or fuzzy match score (0-1)
 *   2. Match type     — exact > hybrid > metadata > fuzzy > semantic
 *   3. Source count   — more corroborating sources = higher confidence
 *   4. Content quality — scientific indicators, structure, specificity
 *   5. Field coverage — how many document fields matched the query
 *
 * @author AI Management System
 * @date 2026-03-30
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Input signals for computing search-result confidence.
 *
 * @param score          - Raw similarity/match score from search (0-1)
 * @param match_type     - How the result was found (exact, fuzzy, semantic, metadata, hybrid)
 * @param matched_fields - Which document fields matched (e.g. ['rm_code', 'inci_name'])
 * @param source_count   - Total number of corroborating sources in the result set
 * @param credibility    - Source credibility weight if known (0-1)
 */
export interface SearchConfidenceInput {
  score: number;
  match_type: 'exact' | 'fuzzy' | 'semantic' | 'metadata' | 'hybrid';
  matched_fields?: string[];
  source_count?: number;
  credibility?: number;
}

/**
 * Input signals for computing response-level confidence.
 *
 * @param source_scores     - Array of individual source confidence scores
 * @param response_content  - The generated response text (for content quality analysis)
 * @param source_count      - Number of sources used to generate the response
 * @param query_coverage    - How well sources covered the original query (0-1, optional)
 */
export interface ResponseConfidenceInput {
  source_scores: number[];
  response_content?: string;
  source_count?: number;
  query_coverage?: number;
}

/**
 * Input signals for computing market/cost analysis confidence.
 *
 * @param data_completeness - Fraction of expected fields that have real data (0-1)
 * @param data_recency_days - Age of the data in days (fresher = higher confidence)
 * @param has_real_data     - Whether this is computed from real data vs mock/estimate
 */
export interface AnalysisConfidenceInput {
  data_completeness: number;
  data_recency_days?: number;
  has_real_data: boolean;
}

// ---------------------------------------------------------------------------
// Constants — match type reliability weights
// ---------------------------------------------------------------------------

/** Reliability multiplier per match type — exact matches are most trustworthy */
const MATCH_TYPE_WEIGHTS: Record<string, number> = {
  exact: 1.0,
  hybrid: 0.95,
  metadata: 0.85,
  fuzzy: 0.75,
  semantic: 0.70,
};

/** Base confidence floor — never return below this for valid results */
const CONFIDENCE_FLOOR = 0.3;

/** Confidence ceiling */
const CONFIDENCE_CEILING = 0.98;

// ---------------------------------------------------------------------------
// Search Result Confidence
// ---------------------------------------------------------------------------

/**
 * Compute confidence for a single search result based on available signals.
 *
 * Formula:
 *   base = score * match_type_weight
 *   + field_bonus (0-0.1 based on matched field count)
 *   + source_bonus (0-0.1 based on corroborating sources)
 *   + credibility_adjustment (-0.1 to +0.1)
 *
 * @param input - SearchConfidenceInput with available signals
 * @returns Confidence score between CONFIDENCE_FLOOR and CONFIDENCE_CEILING
 */
export function compute_search_confidence(input: SearchConfidenceInput): number {
  console.log('[confidence-calculator] compute_search_confidence — start', {
    score: input.score,
    match_type: input.match_type,
  });

  const { score, match_type, matched_fields = [], source_count = 1, credibility } = input;

  // Base: raw score scaled by match type reliability
  const type_weight = MATCH_TYPE_WEIGHTS[match_type] ?? 0.7;
  let confidence = score * type_weight;

  // Field coverage bonus: more matched fields = more reliable
  const field_bonus = Math.min(matched_fields.length * 0.04, 0.12);
  confidence += field_bonus;

  // Source corroboration bonus: diminishing returns after 3 sources
  const source_bonus = Math.min(Math.log2(source_count + 1) * 0.05, 0.1);
  confidence += source_bonus;

  // Credibility adjustment: shift up/down based on source trustworthiness
  if (credibility !== undefined) {
    const credibility_shift = (credibility - 0.7) * 0.15;
    confidence += credibility_shift;
  }

  const result = clamp_confidence(confidence);

  console.log('[confidence-calculator] compute_search_confidence — done', {
    raw: confidence,
    clamped: result,
  });

  return result;
}

// ---------------------------------------------------------------------------
// Response-Level Confidence
// ---------------------------------------------------------------------------

/**
 * Compute aggregate confidence for a full AI response.
 *
 * Combines source-level confidence scores with content quality signals.
 *
 * Formula:
 *   weighted_avg of source scores (70%)
 *   + content quality bonus (20%)
 *   + coverage bonus (10%)
 *
 * @param input - ResponseConfidenceInput with available signals
 * @returns Aggregate confidence score between CONFIDENCE_FLOOR and CONFIDENCE_CEILING
 */
export function compute_response_confidence(input: ResponseConfidenceInput): number {
  console.log('[confidence-calculator] compute_response_confidence — start', {
    source_count: input.source_scores.length,
  });

  const { source_scores, response_content = '', source_count, query_coverage } = input;

  // No sources = low confidence
  if (source_scores.length === 0) {
    console.log('[confidence-calculator] compute_response_confidence — no sources, returning floor');
    return 0.4;
  }

  // Weighted average of source scores (top sources matter more)
  const sorted_scores = [...source_scores].sort((a, b) => b - a);
  let weighted_sum = 0;
  let weight_total = 0;
  sorted_scores.forEach((s, i) => {
    const weight = 1 / (i + 1); // 1, 0.5, 0.33, 0.25, ...
    weighted_sum += s * weight;
    weight_total += weight;
  });
  const avg_source_confidence = weighted_sum / weight_total;

  // Content quality bonus
  const content_quality = assess_content_quality(response_content);

  // Coverage factor
  const effective_count = source_count ?? source_scores.length;
  const coverage = query_coverage ?? Math.min(effective_count / 5, 1.0);

  // Combine: 70% sources, 20% content quality, 10% coverage
  const combined = (avg_source_confidence * 0.7) + (content_quality * 0.2) + (coverage * 0.1);

  const result = clamp_confidence(combined);

  console.log('[confidence-calculator] compute_response_confidence — done', {
    avg_source: avg_source_confidence,
    content_quality,
    coverage,
    result,
  });

  return result;
}

// ---------------------------------------------------------------------------
// Analysis Confidence (Market Intelligence, Cost Analysis)
// ---------------------------------------------------------------------------

/**
 * Compute confidence for analytical data (market size, cost estimates, etc.).
 *
 * Mock/estimated data gets lower confidence than real computed data.
 *
 * @param input - AnalysisConfidenceInput with data quality signals
 * @returns Confidence score reflecting data reliability
 */
export function compute_analysis_confidence(input: AnalysisConfidenceInput): number {
  console.log('[confidence-calculator] compute_analysis_confidence — start', {
    has_real_data: input.has_real_data,
    completeness: input.data_completeness,
  });

  const { data_completeness, data_recency_days = 30, has_real_data } = input;

  // Real data starts higher than estimates
  let confidence = has_real_data ? 0.75 : 0.45;

  // Data completeness factor (0-1) contributes up to 0.15
  confidence += data_completeness * 0.15;

  // Recency penalty: data older than 90 days starts losing confidence
  if (data_recency_days > 90) {
    const age_penalty = Math.min((data_recency_days - 90) / 365, 0.2);
    confidence -= age_penalty;
  }

  const result = clamp_confidence(confidence);

  console.log('[confidence-calculator] compute_analysis_confidence — done', { result });

  return result;
}

// ---------------------------------------------------------------------------
// Content Quality Assessment
// ---------------------------------------------------------------------------

/**
 * Assess the quality of response content based on structural and
 * domain indicators. Used as a component in response confidence.
 *
 * Checks for: scientific language, structured formatting, specificity,
 * and cosmetic domain terminology.
 *
 * @param content - Response text to assess
 * @returns Quality score between 0 and 1
 */
export function assess_content_quality(content: string): number {
  if (!content || content.length === 0) return 0.3;

  const lower = content.toLowerCase();
  let quality = 0.5; // Base quality

  // Scientific/evidence indicators (+0.04 each, max +0.20)
  const scientific_terms = [
    'study', 'research', 'clinical', 'evidence', 'data',
    'according to', 'based on', 'shown to', 'demonstrated',
    'concentration', 'efficacy', 'formulation',
  ];
  const scientific_hits = scientific_terms.filter(t => lower.includes(t)).length;
  quality += Math.min(scientific_hits * 0.04, 0.20);

  // Structured content bonus (lists, numbered items, headers)
  if (content.includes('\n') && content.match(/\d+\./)) quality += 0.08;
  if (content.match(/^[-•*]\s/m)) quality += 0.05;

  // Specificity: contains numbers, percentages, or units
  const specificity_patterns = /\d+(\.\d+)?(%|mg|g|ml|kg|ppm|μg)/g;
  const specificity_hits = (content.match(specificity_patterns) || []).length;
  quality += Math.min(specificity_hits * 0.03, 0.12);

  // Cosmetic domain terms (relevant domain = higher quality)
  const domain_terms = [
    'ingredient', 'inci', 'emulsifier', 'preservative', 'surfactant',
    'antioxidant', 'moisturizer', 'serum', 'cream', 'ph',
  ];
  const domain_hits = domain_terms.filter(t => lower.includes(t)).length;
  quality += Math.min(domain_hits * 0.03, 0.10);

  return Math.min(quality, 1.0);
}

// ---------------------------------------------------------------------------
// Trend Alignment (replaces stub assessTrendAlignment)
// ---------------------------------------------------------------------------

/**
 * Assess how well a product concept aligns with market trends.
 *
 * Uses keyword overlap between concept attributes and trend descriptions
 * rather than returning a hardcoded 0.8.
 *
 * @param concept_keywords - Keywords from the product concept (category, benefits, claims)
 * @param market_trends    - Array of trend descriptions or keywords
 * @returns Alignment score between 0.3 and 0.95
 */
export function compute_trend_alignment(
  concept_keywords: string[],
  market_trends?: string[],
): number {
  console.log('[confidence-calculator] compute_trend_alignment — start', {
    concept_count: concept_keywords.length,
    trend_count: market_trends?.length ?? 0,
  });

  if (!market_trends || market_trends.length === 0) {
    // No trend data available — return moderate alignment with low confidence
    return 0.5;
  }

  if (concept_keywords.length === 0) {
    return 0.4;
  }

  const concept_lower = concept_keywords.map(k => k.toLowerCase());
  const trends_text = market_trends.join(' ').toLowerCase();

  let matches = 0;
  concept_lower.forEach(keyword => {
    if (trends_text.includes(keyword)) matches++;
  });

  const overlap_ratio = matches / concept_lower.length;

  // Scale: 0 overlap = 0.3, full overlap = 0.95
  const alignment = 0.3 + (overlap_ratio * 0.65);

  console.log('[confidence-calculator] compute_trend_alignment — done', {
    matches,
    total: concept_lower.length,
    alignment,
  });

  return Math.min(alignment, 0.95);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Clamp confidence to valid range [CONFIDENCE_FLOOR, CONFIDENCE_CEILING].
 *
 * @param value - Raw confidence value
 * @returns Clamped value
 */
function clamp_confidence(value: number): number {
  return Math.max(CONFIDENCE_FLOOR, Math.min(CONFIDENCE_CEILING, value));
}

/**
 * Round confidence to 2 decimal places for consistent display.
 *
 * @param value - Confidence value
 * @returns Rounded to 2 decimals
 */
export function round_confidence(value: number): number {
  return Math.round(value * 100) / 100;
}
