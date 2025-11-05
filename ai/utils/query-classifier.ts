/**
 * Intelligent Query Classifier
 * Dynamically classifies queries and extracts search intent with high accuracy
 *
 * Features:
 * - Multi-language support (Thai, English)
 * - Pattern-based detection with regex
 * - Fuzzy matching for typos
 * - Confidence scoring
 * - Query expansion suggestions
 */

export interface QueryClassification {
  is_raw_materials_query: boolean;
  query_type: 'exact_code' | 'name_search' | 'description_search' | 'property_search' | 'generic';
  confidence: number;
  detected_patterns: string[];
  extracted_entities: {
    codes?: string[];
    names?: string[];
    properties?: string[];
    suppliers?: string[];
  };
  search_strategy: 'exact_match' | 'fuzzy_match' | 'semantic_search' | 'hybrid';
  expanded_queries?: string[];
  language: 'thai' | 'english' | 'mixed';
}

export interface QueryPattern {
  pattern: RegExp;
  type: string;
  weight: number;
  language?: 'thai' | 'english';
}

/**
 * Comprehensive pattern definitions for query classification
 */
const QUERY_PATTERNS: QueryPattern[] = [
  // Exact code patterns - highest priority
  { pattern: /\b(rm|RM)[-_]?\d{6}\b/g, type: 'exact_code', weight: 1.0 },
  { pattern: /\b(rc|RC)[A-Z0-9]{6,}\b/gi, type: 'exact_code', weight: 1.0 }, // RC00A008
  { pattern: /\b(rd|RD)[A-Z]{2,}[0-9]{3,}\b/gi, type: 'exact_code', weight: 1.0 }, // RDSAM00171
  { pattern: /\b[A-Z]{2,4}[-_]?\d{3,6}\b/g, type: 'material_code', weight: 0.95 },
  { pattern: /\b[A-Z]{3,}-[A-Z]{2,}\b/g, type: 'trade_code', weight: 0.9 },

  // Thai question patterns
  { pattern: /คืออะไร|ชื่ออะไร|มีอะไรบ้าง|หาอะไร/g, type: 'thai_question', weight: 0.85, language: 'thai' },
  { pattern: /รหัส(สาร|วัตถุดิบ)?|material\s*code|rm\s*code/gi, type: 'code_inquiry', weight: 0.9 },
  { pattern: /ชื่อ(การค้า|ทางการค้า|trade)|trade\s*name/gi, type: 'name_inquiry', weight: 0.85 },
  { pattern: /inci\s*(name)?|ชื่อสากล|ชื่อทางเคมี/gi, type: 'inci_inquiry', weight: 0.85 },

  // Thai material keywords
  { pattern: /วัตถุดิบ|สารสกัด|สารออกฤทธิ์|ส่วนผสม/g, type: 'thai_material', weight: 0.8, language: 'thai' },
  { pattern: /สูตร|ตำรับ|การผลิต|formulation/gi, type: 'formulation', weight: 0.75 },
  { pattern: /ซัพพลายเออร์|ผู้ผลิต|บริษัท|supplier|manufacturer/gi, type: 'supplier', weight: 0.75 },
  { pattern: /ราคา|ต้นทุน|cost|price/gi, type: 'cost', weight: 0.75 },
  { pattern: /ประโยชน์|คุณสมบัติ|benefit|property|function/gi, type: 'property', weight: 0.7 },

  // Thai property keywords - specific patterns for common searches
  { pattern: /ความชุ่มชื้น|hydrat|moisturiz/gi, type: 'property_moisturizing', weight: 0.8, language: 'thai' },
  { pattern: /ต้านริ้วรอย|anti[- ]aging|anti[- ]wrinkle/gi, type: 'property_antiaging', weight: 0.8, language: 'thai' },
  { pattern: /กระจ่างใส|whiten|brighten/gi, type: 'property_whitening', weight: 0.8, language: 'thai' },

  // English keywords
  { pattern: /\b(raw\s*material|ingredient|active|extract|chemical)\b/gi, type: 'eng_material', weight: 0.8, language: 'english' },
  { pattern: /\b(vitamin|acid|oil|extract|powder|gel)\b/gi, type: 'material_type', weight: 0.7, language: 'english' },

  // Specific ingredient patterns
  { pattern: /vitamin\s*[a-e]/gi, type: 'vitamin', weight: 0.75 },
  { pattern: /(hyaluronic|glycerin|retinol|niacinamide|ceramide)/gi, type: 'specific_ingredient', weight: 0.8 },
  { pattern: /(ginger|aloe|green\s*tea|chamomile|lavender)/gi, type: 'plant_extract', weight: 0.75 },
];

/**
 * Thai-English keyword mapping for query expansion
 */
const KEYWORD_EXPANSION: Record<string, string[]> = {
  'วัตถุดิบ': ['raw material', 'ingredient', 'material', 'component'],
  'สารสกัด': ['extract', 'extraction', 'active extract'],
  'รหัสสาร': ['material code', 'rm code', 'product code', 'ingredient code'],
  'ชื่อการค้า': ['trade name', 'commercial name', 'brand name'],
  'ซัพพลายเออร์': ['supplier', 'vendor', 'manufacturer', 'provider'],
  'ราคา': ['price', 'cost', 'pricing'],
  'ประโยชน์': ['benefit', 'property', 'function', 'effect'],
  'สูตร': ['formula', 'formulation', 'recipe', 'composition'],
};

/**
 * Extract codes from query string
 */
function extract_codes(query: string): string[] {
  const codes: string[] = [];
  const code_patterns = [
    /\b(rm|RM)[-_]?(\d{6})\b/g,
    /\b(rc|RC)([A-Z0-9]{6,})\b/gi, // RC00A008
    /\b(rd|RD)([A-Z]{2,}[0-9]{3,})\b/gi, // RDSAM00171
    /\b([A-Z]{2,4})[-_](\d{3,6})\b/g,
    /\b([A-Z]{3,}-[A-Z]{2,})\b/g
  ];

  code_patterns.forEach(pattern => {
    const matches = query.matchAll(pattern);
    for (const match of matches) {
      const code = match[0].toUpperCase().replace(/[-_]/g, '');
      codes.push(code);
      // Also add original format
      codes.push(match[0]);
    }
  });

  return [...new Set(codes)]; // Remove duplicates
}

/**
 * Extract material names from query
 */
function extract_names(query: string): string[] {
  const names: string[] = [];

  // Common ingredient name patterns
  const name_patterns = [
    /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g, // "Hyaluronic Acid"
    /\b[A-Z][a-z]+\s+Extract\b/gi,    // "Ginger Extract"
    /"([^"]+)"/g,                      // Quoted names
    /'([^']+)'/g,                      // Single quoted names
  ];

  name_patterns.forEach(pattern => {
    const matches = query.matchAll(pattern);
    for (const match of matches) {
      const name = match[1] || match[0];
      if (name.length > 2) {
        names.push(name.trim());
      }
    }
  });

  return [...new Set(names)];
}

/**
 * Extract properties/benefits being searched
 */
function extract_properties(query: string): string[] {
  const properties: string[] = [];
  const property_keywords = [
    'moisturizing', 'anti-aging', 'whitening', 'brightening',
    'hydrating', 'smoothing', 'firming', 'soothing',
    'ความชุ่มชื้น', 'ต้านริ้วรอย', 'กระจ่างใส', 'บำรุง'
  ];

  const query_lower = query.toLowerCase();
  property_keywords.forEach(prop => {
    if (query_lower.includes(prop.toLowerCase())) {
      properties.push(prop);
    }
  });

  return properties;
}

/**
 * Detect query language
 */
function detect_language(query: string): 'thai' | 'english' | 'mixed' {
  const thai_chars = query.match(/[\u0E00-\u0E7F]/g) || [];
  const english_chars = query.match(/[a-zA-Z]/g) || [];

  const thai_ratio = thai_chars.length / query.length;
  const english_ratio = english_chars.length / query.length;

  if (thai_ratio > 0.3 && english_ratio > 0.1) return 'mixed';
  if (thai_ratio > 0.3) return 'thai';
  return 'english';
}

/**
 * Generate expanded queries for better matching
 */
function generate_expanded_queries(
  query: string,
  language: 'thai' | 'english' | 'mixed'
): string[] {
  const expanded: string[] = [query]; // Always include original

  // Add keyword expansions
  Object.entries(KEYWORD_EXPANSION).forEach(([thai, english_variants]) => {
    if (query.includes(thai)) {
      english_variants.forEach(eng => {
        expanded.push(query.replace(thai, eng));
      });
    }
  });

  // Add case variations for codes
  const codes = extract_codes(query);
  codes.forEach(code => {
    expanded.push(code.toUpperCase());
    expanded.push(code.toLowerCase());
    // Add with separators
    if (code.length >= 6) {
      expanded.push(`${code.slice(0, 2)}-${code.slice(2)}`);
      expanded.push(`${code.slice(0, 2)}_${code.slice(2)}`);
    }
  });

  return [...new Set(expanded)];
}

/**
 * Calculate confidence score based on pattern matches
 */
function calculate_confidence(
  detected_patterns: string[],
  pattern_weights: number[]
): number {
  if (pattern_weights.length === 0) return 0.1;

  // Weighted average with boost for multiple patterns
  const sum = pattern_weights.reduce((a, b) => a + b, 0);
  const avg = sum / pattern_weights.length;
  const multi_pattern_boost = Math.min(pattern_weights.length * 0.05, 0.2);

  return Math.min(avg + multi_pattern_boost, 1.0);
}

/**
 * Determine optimal search strategy based on query type
 */
function determine_search_strategy(
  query_type: string,
  confidence: number,
  has_codes: boolean
): 'exact_match' | 'fuzzy_match' | 'semantic_search' | 'hybrid' {
  // High confidence code queries → exact match
  if (has_codes && confidence > 0.8) {
    return 'exact_match';
  }

  // Medium confidence with specific patterns → fuzzy match
  if (confidence > 0.6 && (query_type === 'name_search' || query_type === 'exact_code')) {
    return 'fuzzy_match';
  }

  // Low confidence or generic → hybrid (best of both worlds)
  if (confidence < 0.5 || query_type === 'generic') {
    return 'hybrid';
  }

  // Default to semantic for description/property searches
  return 'semantic_search';
}

/**
 * Main classification function
 * Analyzes query and returns comprehensive classification
 */
export function classify_query(query: string): QueryClassification {
  console.log('🔍 [query-classifier] Analyzing query:', query);

  const detected_patterns: string[] = [];
  const pattern_weights: number[] = [];

  // Apply all patterns
  QUERY_PATTERNS.forEach(({ pattern, type, weight }) => {
    if (pattern.test(query)) {
      detected_patterns.push(type);
      pattern_weights.push(weight);
    }
  });

  // Extract entities
  const codes = extract_codes(query);
  const names = extract_names(query);
  const properties = extract_properties(query);

  // Detect language
  const language = detect_language(query);

  // Determine query type
  let query_type: QueryClassification['query_type'] = 'generic';

  if (codes.length > 0 || detected_patterns.includes('exact_code')) {
    query_type = 'exact_code';
  } else if (detected_patterns.includes('name_inquiry') || names.length > 0) {
    query_type = 'name_search';
  } else if (
    detected_patterns.includes('property') ||
    properties.length > 0 ||
    detected_patterns.some(p => p.startsWith('property_'))
  ) {
    query_type = 'property_search';
  } else if (
    detected_patterns.some(p =>
      p.includes('material') || p.includes('ingredient') || p.includes('formulation')
    )
  ) {
    query_type = 'description_search';
  }

  // Calculate confidence
  const confidence = calculate_confidence(detected_patterns, pattern_weights);

  // Determine if this is a raw materials query
  const is_raw_materials_query =
    confidence > 0.5 ||
    codes.length > 0 ||
    names.length > 0 ||
    detected_patterns.length > 0;

  // Determine search strategy
  const search_strategy = determine_search_strategy(
    query_type,
    confidence,
    codes.length > 0
  );

  // Generate expanded queries
  const expanded_queries = generate_expanded_queries(query, language);

  const classification: QueryClassification = {
    is_raw_materials_query,
    query_type,
    confidence,
    detected_patterns,
    extracted_entities: {
      codes: codes.length > 0 ? codes : undefined,
      names: names.length > 0 ? names : undefined,
      properties: properties.length > 0 ? properties : undefined,
    },
    search_strategy,
    expanded_queries,
    language
  };

  console.log('✅ [query-classifier] Classification result:', classification);

  return classification;
}

/**
 * Fuzzy match score between two strings (Levenshtein distance)
 */
export function fuzzy_match_score(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  // Exact match
  if (s1 === s2) return 1.0;

  // Contains match
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;

  // Levenshtein distance
  const matrix: number[][] = [];
  const len1 = s1.length;
  const len2 = s2.length;

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  const distance = matrix[len1][len2];
  const max_len = Math.max(len1, len2);

  return 1 - (distance / max_len);
}
