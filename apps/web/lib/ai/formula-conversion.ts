export interface GeneratedFormulaIngredient {
  phase?: string;
  phase_label?: string;
  materialId?: string;
  rm_code?: string;
  inci_name?: string;
  trade_name?: string;
  productName?: string;
  function?: string;
  function_desc?: string;
  percentage?: number;
  amount_grams?: number;
  amount?: number;
  notes?: string;
}

export interface GeneratedFormula {
  formula_name?: string;
  formula_code?: string;
  formula_id?: string;
  product_type?: string;
  target_benefits?: string[];
  batch_size_grams?: number;
  total_percentage?: number;
  estimated_cost_thb?: number;
  ingredients?: GeneratedFormulaIngredient[];
  generation_prompt?: string;
  warnings?: Array<{ severity?: string; message?: string } | string>;
  [key: string]: unknown;
}

export interface FormulaCreateIngredient {
  materialId: string;
  rm_code: string;
  productName: string;
  inci_name?: string;
  amount: number;
  percentage?: number;
  notes?: string;
}

const to_number = (value: unknown): number | null => {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};

export function get_batch_size(formula: GeneratedFormula): number {
  const batch_size = to_number(formula.batch_size_grams);
  return batch_size && batch_size > 0 ? batch_size : 100;
}

/**
 * Converts an AI artifact into the same data shape that the formula editor
 * accepts. Missing catalog links remain blank so the draft is still editable
 * and can be matched to the raw-material catalog by the R&D user.
 */
export function to_formula_ingredients(formula: GeneratedFormula): FormulaCreateIngredient[] {
  const batch_size = get_batch_size(formula);

  return (Array.isArray(formula.ingredients) ? formula.ingredients : [])
    .map((ingredient): FormulaCreateIngredient | null => {
      const percentage = to_number(ingredient.percentage);
      const provided_amount = to_number(ingredient.amount_grams ?? ingredient.amount);
      const amount = provided_amount && provided_amount > 0
        ? provided_amount
        : percentage !== null && percentage > 0
          ? Number(((percentage / 100) * batch_size).toFixed(4))
          : null;
      const product_name = String(
        ingredient.trade_name || ingredient.productName || ingredient.inci_name || ingredient.rm_code || '',
      ).trim();

      if (!product_name || !amount || amount <= 0) return null;

      return {
        materialId: String(ingredient.materialId || ''),
        rm_code: String(ingredient.rm_code || ''),
        productName: product_name,
        inci_name: ingredient.inci_name ? String(ingredient.inci_name) : undefined,
        amount,
        percentage: percentage !== null && percentage >= 0 ? percentage : undefined,
        notes: String(ingredient.notes || ingredient.function || ingredient.function_desc || '').trim() || undefined,
      };
    })
    .filter((ingredient): ingredient is FormulaCreateIngredient => Boolean(ingredient));
}

export function to_formula_create_input(formula: GeneratedFormula, source_prompt?: string) {
  const ingredients = to_formula_ingredients(formula);
  if (ingredients.length === 0) {
    throw new Error('The AI plan did not contain usable ingredients. Ask the assistant to generate a complete formula first.');
  }

  return {
    formulaName: String(formula.formula_name || 'AI Formula Draft').trim(),
    version: 1,
    client: '',
    targetBenefits: Array.isArray(formula.target_benefits) ? formula.target_benefits.map(String) : [],
    ingredients,
    totalAmount: get_batch_size(formula),
    remarks: `AI-generated from chat${source_prompt ? `: ${source_prompt}` : ''}`,
    status: 'draft' as const,
  };
}
