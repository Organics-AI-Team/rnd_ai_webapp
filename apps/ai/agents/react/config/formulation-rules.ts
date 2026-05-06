/**
 * Formulation Rules Configuration
 *
 * Central config for the structured formulation engine. Contains:
 * - Product type templates with per-phase percentage budgets
 * - Phase classification keywords for ingredient categorization
 * - Regulatory max usage limits for common ingredients
 * - Known incompatible ingredient pairs
 * - Mandatory phase requirements
 *
 * All rules are data-driven (not hardcoded in handler logic) so
 * R&D teams can update limits without touching code.
 *
 * @author AI Management System
 * @date 2026-03-30
 */

// ---------------------------------------------------------------------------
// Phase Definitions
// ---------------------------------------------------------------------------

/**
 * Formulation phases that every cosmetic formula should be organized into.
 * Order matters — it determines the display order in output.
 */
export const FORMULA_PHASES = [
  'water_phase',
  'oil_phase',
  'active_phase',
  'emulsifier_phase',
  'preservative_phase',
  'ph_adjuster_phase',
  'fragrance_phase',
] as const;

export type FormulaPhase = typeof FORMULA_PHASES[number];

/**
 * Human-readable labels for each phase.
 */
export const PHASE_LABELS: Record<FormulaPhase, string> = {
  water_phase: 'Water Phase',
  oil_phase: 'Oil Phase',
  active_phase: 'Active Phase',
  emulsifier_phase: 'Emulsifier Phase',
  preservative_phase: 'Preservative Phase',
  ph_adjuster_phase: 'pH Adjuster Phase',
  fragrance_phase: 'Fragrance Phase',
};

// ---------------------------------------------------------------------------
// Phase Classification Keywords
// ---------------------------------------------------------------------------

/**
 * Keywords used to classify ingredients into phases.
 * Matched against: category, benefits, details, inci_name (case-insensitive).
 *
 * Priority: If an ingredient matches multiple phases, the FIRST match wins
 * (ordered by specificity: preservative > emulsifier > oil > active > water).
 */
export const PHASE_CLASSIFICATION_KEYWORDS: Record<FormulaPhase, string[]> = {
  preservative_phase: [
    'preservative', 'antimicrobial', 'phenoxyethanol', 'potassium sorbate',
    'sodium benzoate', 'paraben', 'methylparaben', 'propylparaben',
    'ethylhexylglycerin', 'caprylyl glycol', 'benzisothiazolinone',
    'chlorphenesin', 'sorbic acid', 'dehydroacetic acid',
    'สารกันเสีย', 'กันเชื้อ',
  ],
  ph_adjuster_phase: [
    'ph adjuster', 'ph adjustment', 'buffer', 'citric acid', 'sodium hydroxide',
    'triethanolamine', 'tromethamine', 'lactic acid', 'tartaric acid',
    'potassium hydroxide', 'aminomethyl propanol', 'amp',
    'ปรับ ph', 'บัฟเฟอร์',
  ],
  emulsifier_phase: [
    'emulsifier', 'emulsifying', 'surfactant', 'solubilizer', 'co-emulsifier',
    'polysorbate', 'ceteareth', 'steareth', 'peg-', 'glyceryl stearate',
    'cetearyl olivate', 'sorbitan olivate', 'sodium lauryl sulfate',
    'cocamidopropyl betaine', 'decyl glucoside', 'coco glucoside',
    'lauryl glucoside', 'sodium cocoyl isethionate',
    'สารลดแรงตึงผิว', 'อิมัลซิไฟเออร์',
  ],
  oil_phase: [
    'emollient', 'oil', 'butter', 'wax', 'silicone', 'ester', 'lipid',
    'occlusive', 'cetyl alcohol', 'cetearyl alcohol', 'stearic acid',
    'isopropyl myristate', 'caprylic', 'capric triglyceride',
    'dimethicone', 'cyclomethicone', 'squalane', 'squalene',
    'jojoba', 'argan', 'coconut oil', 'shea butter', 'cocoa butter',
    'beeswax', 'candelilla wax', 'carnauba wax',
    'น้ำมัน', 'เนย', 'แว็กซ์', 'ซิลิโคน',
  ],
  active_phase: [
    'active', 'antioxidant', 'anti-aging', 'brightening', 'whitening',
    'anti-acne', 'anti-wrinkle', 'exfoliant', 'retinol', 'retinal',
    'niacinamide', 'vitamin c', 'ascorbic acid', 'salicylic acid',
    'glycolic acid', 'azelaic acid', 'tranexamic acid', 'arbutin',
    'alpha arbutin', 'kojic acid', 'peptide', 'ceramide',
    'hyaluronic acid', 'collagen', 'coenzyme q10', 'resveratrol',
    'bakuchiol', 'centella', 'madecassoside', 'allantoin',
    'ลดริ้วรอย', 'ต้านอนุมูลอิสระ', 'ลดสิว', 'ผิวกระจ่างใส',
    'ลดเลือนรอยดำ', 'ลดฝ้า', 'ความชุ่มชื้น', 'เพิ่มความชุ่มชื้น',
  ],
  water_phase: [
    'water', 'aqua', 'humectant', 'glycerin', 'propanediol', 'butylene glycol',
    'pentylene glycol', 'sorbitol', 'panthenol', 'aloe vera', 'thermal water',
    'hydrosol', 'floral water', 'witch hazel',
    'น้ำ', 'สารให้ความชุ่มชื้น',
  ],
  fragrance_phase: [
    'fragrance', 'parfum', 'essential oil', 'aroma', 'flavor',
    'linalool', 'limonene', 'citronellol', 'geraniol',
    'น้ำหอม', 'กลิ่น',
  ],
};

// ---------------------------------------------------------------------------
// Product Type Phase Budgets
// ---------------------------------------------------------------------------

/**
 * Percentage budget for each phase by product type.
 * Each value is [min_pct, max_pct, typical_pct].
 *
 * The water phase is the "balance" phase — it absorbs whatever
 * percentage is left after all other phases are allocated.
 *
 * @param product_type - Cosmetic product type key
 */
export interface PhaseBudget {
  min_pct: number;
  max_pct: number;
  typical_pct: number;
}

export const PRODUCT_TYPE_PHASE_BUDGETS: Record<string, Record<FormulaPhase, PhaseBudget>> = {
  serum: {
    water_phase:        { min_pct: 60, max_pct: 85, typical_pct: 72 },
    oil_phase:          { min_pct: 0,  max_pct: 10, typical_pct: 3 },
    active_phase:       { min_pct: 5,  max_pct: 25, typical_pct: 15 },
    emulsifier_phase:   { min_pct: 0,  max_pct: 3,  typical_pct: 1 },
    preservative_phase: { min_pct: 0.5, max_pct: 2, typical_pct: 1 },
    ph_adjuster_phase:  { min_pct: 0,  max_pct: 0.5, typical_pct: 0.2 },
    fragrance_phase:    { min_pct: 0,  max_pct: 1,  typical_pct: 0.3 },
  },
  cream: {
    water_phase:        { min_pct: 50, max_pct: 70, typical_pct: 60 },
    oil_phase:          { min_pct: 10, max_pct: 30, typical_pct: 18 },
    active_phase:       { min_pct: 3,  max_pct: 15, typical_pct: 8 },
    emulsifier_phase:   { min_pct: 3,  max_pct: 8,  typical_pct: 5 },
    preservative_phase: { min_pct: 0.5, max_pct: 2, typical_pct: 1 },
    ph_adjuster_phase:  { min_pct: 0,  max_pct: 0.5, typical_pct: 0.2 },
    fragrance_phase:    { min_pct: 0,  max_pct: 1,  typical_pct: 0.5 },
  },
  lotion: {
    water_phase:        { min_pct: 55, max_pct: 75, typical_pct: 65 },
    oil_phase:          { min_pct: 8,  max_pct: 20, typical_pct: 14 },
    active_phase:       { min_pct: 3,  max_pct: 12, typical_pct: 7 },
    emulsifier_phase:   { min_pct: 2,  max_pct: 6,  typical_pct: 4 },
    preservative_phase: { min_pct: 0.5, max_pct: 2, typical_pct: 1 },
    ph_adjuster_phase:  { min_pct: 0,  max_pct: 0.5, typical_pct: 0.2 },
    fragrance_phase:    { min_pct: 0,  max_pct: 1,  typical_pct: 0.5 },
  },
  toner: {
    water_phase:        { min_pct: 80, max_pct: 95, typical_pct: 87 },
    oil_phase:          { min_pct: 0,  max_pct: 3,  typical_pct: 1 },
    active_phase:       { min_pct: 2,  max_pct: 10, typical_pct: 5 },
    emulsifier_phase:   { min_pct: 0,  max_pct: 2,  typical_pct: 0.5 },
    preservative_phase: { min_pct: 0.5, max_pct: 2, typical_pct: 1 },
    ph_adjuster_phase:  { min_pct: 0,  max_pct: 0.5, typical_pct: 0.2 },
    fragrance_phase:    { min_pct: 0,  max_pct: 0.5, typical_pct: 0.2 },
  },
  cleanser: {
    water_phase:        { min_pct: 45, max_pct: 65, typical_pct: 55 },
    oil_phase:          { min_pct: 2,  max_pct: 10, typical_pct: 5 },
    active_phase:       { min_pct: 1,  max_pct: 8,  typical_pct: 3 },
    emulsifier_phase:   { min_pct: 8,  max_pct: 20, typical_pct: 14 },
    preservative_phase: { min_pct: 0.5, max_pct: 2, typical_pct: 1 },
    ph_adjuster_phase:  { min_pct: 0.1, max_pct: 1, typical_pct: 0.3 },
    fragrance_phase:    { min_pct: 0,  max_pct: 1,  typical_pct: 0.5 },
  },
  mask: {
    water_phase:        { min_pct: 50, max_pct: 70, typical_pct: 60 },
    oil_phase:          { min_pct: 3,  max_pct: 15, typical_pct: 8 },
    active_phase:       { min_pct: 5,  max_pct: 18, typical_pct: 12 },
    emulsifier_phase:   { min_pct: 2,  max_pct: 6,  typical_pct: 4 },
    preservative_phase: { min_pct: 0.5, max_pct: 2, typical_pct: 1 },
    ph_adjuster_phase:  { min_pct: 0,  max_pct: 0.5, typical_pct: 0.2 },
    fragrance_phase:    { min_pct: 0,  max_pct: 1,  typical_pct: 0.5 },
  },
  sunscreen: {
    water_phase:        { min_pct: 40, max_pct: 60, typical_pct: 48 },
    oil_phase:          { min_pct: 5,  max_pct: 15, typical_pct: 10 },
    active_phase:       { min_pct: 12, max_pct: 30, typical_pct: 20 },
    emulsifier_phase:   { min_pct: 3,  max_pct: 8,  typical_pct: 5 },
    preservative_phase: { min_pct: 0.5, max_pct: 2, typical_pct: 1 },
    ph_adjuster_phase:  { min_pct: 0,  max_pct: 0.5, typical_pct: 0.2 },
    fragrance_phase:    { min_pct: 0,  max_pct: 0.5, typical_pct: 0.3 },
  },
  shampoo: {
    water_phase:        { min_pct: 50, max_pct: 65, typical_pct: 55 },
    oil_phase:          { min_pct: 1,  max_pct: 8,  typical_pct: 3 },
    active_phase:       { min_pct: 1,  max_pct: 8,  typical_pct: 4 },
    emulsifier_phase:   { min_pct: 12, max_pct: 25, typical_pct: 18 },
    preservative_phase: { min_pct: 0.5, max_pct: 2, typical_pct: 1 },
    ph_adjuster_phase:  { min_pct: 0.1, max_pct: 1, typical_pct: 0.5 },
    fragrance_phase:    { min_pct: 0,  max_pct: 1.5, typical_pct: 0.8 },
  },
};

// ---------------------------------------------------------------------------
// Regulatory Max Usage Limits
// ---------------------------------------------------------------------------

/**
 * Hardcoded max usage percentages for well-known ingredients.
 * These serve as a FALLBACK when Qdrant payload lacks usage_max_pct.
 *
 * Source: EU Cosmetics Regulation Annex III/IV, CIR reports, industry standards.
 *
 * @param inci_name_lower - Lowercase INCI name (or partial match)
 * @param max_pct         - Maximum allowed percentage in leave-on products
 * @param max_pct_rinse   - Maximum allowed percentage in rinse-off products (optional)
 * @param notes           - Additional context for the limit
 */
export interface RegulatoryLimit {
  max_pct: number;
  max_pct_rinse?: number;
  notes: string;
}

export const REGULATORY_LIMITS: Record<string, RegulatoryLimit> = {
  // Retinoids
  'retinol': { max_pct: 1, notes: 'EU limit for leave-on; higher concentrations require medical supervision' },
  'retinal': { max_pct: 0.2, notes: 'Retinaldehyde — more potent than retinol' },
  'retinyl palmitate': { max_pct: 1, notes: 'Ester form of retinol' },

  // Acids
  'salicylic acid': { max_pct: 2, max_pct_rinse: 3, notes: 'BHA — EU limit for cosmetics' },
  'glycolic acid': { max_pct: 10, notes: 'AHA — professional peels can go higher under supervision' },
  'lactic acid': { max_pct: 10, notes: 'AHA — gentle exfoliant' },
  'mandelic acid': { max_pct: 10, notes: 'AHA — larger molecular weight' },
  'azelaic acid': { max_pct: 20, notes: 'Generally well-tolerated; prescription-strength often 15-20%' },
  'citric acid': { max_pct: 3, notes: 'As pH adjuster; higher as active exfoliant' },
  'ascorbic acid': { max_pct: 20, notes: 'L-Ascorbic Acid (Vitamin C); stability is the concern above 15%' },

  // Vitamins & Actives
  'niacinamide': { max_pct: 10, notes: 'Generally effective at 2-5%, safe up to 10%' },
  'alpha arbutin': { max_pct: 2, notes: 'Brightening agent; industry standard max' },
  'arbutin': { max_pct: 7, notes: 'Beta-arbutin has higher limit than alpha form' },
  'kojic acid': { max_pct: 2, notes: 'Can cause sensitization above 2%' },
  'tranexamic acid': { max_pct: 5, notes: 'Topical brightening; higher in clinical settings' },
  'hydroquinone': { max_pct: 2, notes: 'Restricted in many markets; banned in EU cosmetics' },
  'benzoyl peroxide': { max_pct: 10, notes: 'OTC acne treatment' },

  // Preservatives
  'phenoxyethanol': { max_pct: 1, notes: 'EU max limit' },
  'potassium sorbate': { max_pct: 0.6, notes: 'EU cosmetics limit' },
  'sodium benzoate': { max_pct: 2.5, notes: 'EU cosmetics limit' },
  'methylparaben': { max_pct: 0.4, notes: 'EU limit as single paraben' },
  'propylparaben': { max_pct: 0.14, notes: 'EU limit — stricter than methylparaben' },
  'ethylhexylglycerin': { max_pct: 1, notes: 'Preservative booster' },
  'chlorphenesin': { max_pct: 0.3, notes: 'EU limit for preservative use' },

  // Emollients & Oils (high limits, mainly for reference)
  'dimethicone': { max_pct: 30, notes: 'Generally unlimited; 30% is practical max for feel' },

  // UV Filters
  'titanium dioxide': { max_pct: 25, notes: 'EU limit for UV filter' },
  'zinc oxide': { max_pct: 25, notes: 'EU limit for UV filter' },
  'octinoxate': { max_pct: 10, notes: 'Ethylhexyl methoxycinnamate — EU limit' },
  'avobenzone': { max_pct: 5, notes: 'Butyl methoxydibenzoylmethane — EU limit' },
  'octocrylene': { max_pct: 10, notes: 'EU limit for UV filter' },
  'homosalate': { max_pct: 10, notes: 'EU revised limit (was 15%)' },

  // Fragrance & Sensitizers
  'parfum': { max_pct: 1, notes: 'General recommendation for leave-on; varies by product' },
};

// ---------------------------------------------------------------------------
// Incompatible Ingredient Pairs
// ---------------------------------------------------------------------------

/**
 * Known ingredient combinations that should trigger warnings.
 *
 * @param ingredients - Pair of INCI name substrings (lowercase)
 * @param severity    - "warning" (can work with care) or "avoid" (strongly discouraged)
 * @param reason      - Technical explanation for the incompatibility
 * @param condition   - When the incompatibility applies (optional context)
 */
export interface IncompatiblePair {
  ingredients: [string, string];
  severity: 'warning' | 'avoid';
  reason: string;
  condition?: string;
}

export const INCOMPATIBLE_PAIRS: IncompatiblePair[] = [
  {
    ingredients: ['retinol', 'ascorbic acid'],
    severity: 'warning',
    reason: 'Both are pH-sensitive actives; combined use may increase irritation',
    condition: 'Same formula — usually recommended in separate routines',
  },
  {
    ingredients: ['retinol', 'salicylic acid'],
    severity: 'warning',
    reason: 'Combined exfoliation + retinoid can cause excessive irritation',
    condition: 'High concentrations of both in same formula',
  },
  {
    ingredients: ['retinol', 'glycolic acid'],
    severity: 'warning',
    reason: 'AHA + retinoid increases risk of irritation and photosensitivity',
  },
  {
    ingredients: ['retinol', 'benzoyl peroxide'],
    severity: 'avoid',
    reason: 'Benzoyl peroxide oxidizes and deactivates retinol',
  },
  {
    ingredients: ['ascorbic acid', 'niacinamide'],
    severity: 'warning',
    reason: 'Can form niacin at low pH causing flushing (mostly overstated but worth noting)',
    condition: 'Only at pH < 3.5 and high concentrations',
  },
  {
    ingredients: ['salicylic acid', 'glycolic acid'],
    severity: 'warning',
    reason: 'Stacking BHA + AHA increases irritation risk for sensitive skin',
  },
  {
    ingredients: ['sodium benzoate', 'ascorbic acid'],
    severity: 'warning',
    reason: 'Can form benzene under heat/light exposure in acidic conditions',
    condition: 'pH < 3 and exposure to heat/UV',
  },
  {
    ingredients: ['hydroquinone', 'benzoyl peroxide'],
    severity: 'avoid',
    reason: 'Benzoyl peroxide stains skin when combined with hydroquinone',
  },
];

// ---------------------------------------------------------------------------
// Mandatory Ingredients by Product Type
// ---------------------------------------------------------------------------

/**
 * Ingredients or phases that MUST be present in a valid formula.
 * If missing after generation, the engine auto-adds them.
 *
 * @param phase          - The phase that must have at least one ingredient
 * @param search_query   - Qdrant search query to find a suitable default ingredient
 * @param default_inci   - Fallback INCI name if search returns nothing
 * @param default_pct    - Default percentage to assign
 */
export interface MandatoryIngredient {
  phase: FormulaPhase;
  search_query: string;
  default_inci: string;
  default_pct: number;
}

export const MANDATORY_BY_PRODUCT_TYPE: Record<string, MandatoryIngredient[]> = {
  _default: [
    {
      phase: 'preservative_phase',
      search_query: 'preservative system cosmetic',
      default_inci: 'Phenoxyethanol',
      default_pct: 0.8,
    },
    {
      phase: 'ph_adjuster_phase',
      search_query: 'pH adjuster citric acid',
      default_inci: 'Citric Acid',
      default_pct: 0.15,
    },
  ],
  sunscreen: [
    {
      phase: 'preservative_phase',
      search_query: 'preservative system cosmetic',
      default_inci: 'Phenoxyethanol',
      default_pct: 0.8,
    },
    {
      phase: 'ph_adjuster_phase',
      search_query: 'pH adjuster citric acid',
      default_inci: 'Citric Acid',
      default_pct: 0.15,
    },
  ],
};

// ---------------------------------------------------------------------------
// Helper: Get budgets for a product type (with fallback to serum)
// ---------------------------------------------------------------------------

/**
 * Retrieve phase budgets for a given product type.
 * Falls back to serum template if the product type is unrecognized.
 *
 * @param product_type - The cosmetic product type key
 * @returns Record of phase budgets
 */
export function get_phase_budgets(product_type: string): Record<FormulaPhase, PhaseBudget> {
  console.log('[formulation-rules] get_phase_budgets — start', { product_type });
  const key = product_type.toLowerCase().trim();
  const budgets = PRODUCT_TYPE_PHASE_BUDGETS[key] || PRODUCT_TYPE_PHASE_BUDGETS['serum'];
  console.log('[formulation-rules] get_phase_budgets — done', { resolved_type: key in PRODUCT_TYPE_PHASE_BUDGETS ? key : 'serum (fallback)' });
  return budgets;
}

/**
 * Retrieve mandatory ingredients for a product type.
 * Always includes _default entries; product-specific entries override if present.
 *
 * @param product_type - The cosmetic product type key
 * @returns Array of mandatory ingredient definitions
 */
export function get_mandatory_ingredients(product_type: string): MandatoryIngredient[] {
  console.log('[formulation-rules] get_mandatory_ingredients — start', { product_type });
  const key = product_type.toLowerCase().trim();
  const result = MANDATORY_BY_PRODUCT_TYPE[key] || MANDATORY_BY_PRODUCT_TYPE['_default'];
  console.log('[formulation-rules] get_mandatory_ingredients — done', { count: result.length });
  return result;
}
