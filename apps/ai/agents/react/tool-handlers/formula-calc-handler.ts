/**
 * Formula Calculation Tool Handler
 * Handles the `formula_calculate` ReAct tool by performing pure math
 * operations on cosmetic formula ingredients — no external dependencies.
 *
 * Supported operations:
 *   - batch_cost           : Total cost for a batch of ingredients
 *   - scale_formula        : Scale ingredient quantities to a new batch size
 *   - unit_convert         : Convert all ingredient quantities to a target unit
 *   - ingredient_percentage: Compute each ingredient's weight percentage
 *
 * Unit-to-gram conversion map:
 *   g=1, kg=1000, lb=453.592, ton=1_000_000, oz=28.3495, ml=1, l=1000
 *
 * @author AI Management System
 * @date 2026-03-27
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single ingredient entry used in formula calculations.
 *
 * @param name           - Ingredient name or INCI name
 * @param quantity       - Amount of ingredient in the given unit
 * @param unit           - Unit of measure (g, kg, ml, l, lb, ton, oz)
 * @param cost_per_unit  - Cost per unit in THB (required for batch_cost)
 */
interface Ingredient {
  name: string;
  quantity: number;
  unit: string;
  cost_per_unit?: number;
}

/**
 * Input parameters for the formula_calculate tool handler.
 *
 * @param operation    - Calculation type: batch_cost | scale_formula | unit_convert | ingredient_percentage
 * @param ingredients  - Array of ingredient objects (required for all operations)
 * @param batch_size   - Target batch size for scale_formula / batch_cost scaling
 * @param target_unit  - Target unit string for unit_convert (must be in UNIT_TO_GRAMS)
 * @param formula_id   - Optional formula ID (currently informational; not fetched from DB in this handler)
 */
interface FormulaCalcParams {
  operation: 'batch_cost' | 'scale_formula' | 'unit_convert' | 'ingredient_percentage';
  ingredients?: Ingredient[];
  batch_size?: number;
  target_unit?: string;
  formula_id?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Conversion factors from each unit to grams.
 * ml and l are treated as weight-equivalent (1 ml = 1 g) for cosmetic
 * formulations where density ≈ 1 g/ml is a safe approximation.
 */
const UNIT_TO_GRAMS: Record<string, number> = {
  g: 1,
  kg: 1000,
  lb: 453.592,
  ton: 1_000_000,
  oz: 28.3495,
  ml: 1,
  l: 1000,
};

/** Decimal precision for rounded output values */
const ROUND_PRECISION = 4;

// ---------------------------------------------------------------------------
// Utility Helpers
// ---------------------------------------------------------------------------

/**
 * Round a number to a fixed number of decimal places.
 *
 * @param value     - The number to round
 * @param precision - Number of decimal places (default: ROUND_PRECISION)
 * @returns Rounded number
 */
function round(value: number, precision = ROUND_PRECISION): number {
  const factor = Math.pow(10, precision);
  return Math.round(value * factor) / factor;
}

/**
 * Normalize a unit string to lowercase and handle common aliases.
 *
 * @param unit - Raw unit string from caller
 * @returns Lowercase normalized unit string
 */
function normalize_unit(unit: string): string {
  const lower = unit.toLowerCase().trim();
  // Handle common aliases
  const aliases: Record<string, string> = {
    litre: 'l',
    liter: 'l',
    litters: 'l',
    liters: 'l',
    gram: 'g',
    grams: 'g',
    kilogram: 'kg',
    kilograms: 'kg',
    pound: 'lb',
    pounds: 'lb',
    ounce: 'oz',
    ounces: 'oz',
    tonne: 'ton',
    tonnes: 'ton',
    milliliter: 'ml',
    milliliters: 'ml',
    millilitre: 'ml',
    millilitres: 'ml',
  };
  return aliases[lower] ?? lower;
}

/**
 * Convert a quantity from a source unit to grams.
 *
 * @param quantity    - Amount in source unit
 * @param unit        - Source unit string
 * @returns Quantity in grams
 * @throws Error if the unit is not recognized
 */
function to_grams(quantity: number, unit: string): number {
  const normalized = normalize_unit(unit);
  const factor = UNIT_TO_GRAMS[normalized];
  if (factor === undefined) {
    throw new Error(
      `Unsupported unit "${unit}". Supported: ${Object.keys(UNIT_TO_GRAMS).join(', ')}.`,
    );
  }
  return quantity * factor;
}

/**
 * Convert a quantity from grams to a target unit.
 *
 * @param grams       - Amount in grams
 * @param target_unit - Target unit string
 * @returns Quantity in target unit
 * @throws Error if the target unit is not recognized
 */
function from_grams(grams: number, target_unit: string): number {
  const normalized = normalize_unit(target_unit);
  const factor = UNIT_TO_GRAMS[normalized];
  if (factor === undefined) {
    throw new Error(
      `Unsupported target unit "${target_unit}". Supported: ${Object.keys(UNIT_TO_GRAMS).join(', ')}.`,
    );
  }
  return grams / factor;
}

// ---------------------------------------------------------------------------
// Operation Implementations
// ---------------------------------------------------------------------------

/**
 * Calculate total batch cost from ingredient quantities and costs.
 * Converts all quantities to grams then multiplies by cost_per_unit (per gram).
 * If batch_size is provided, scales the total proportionally.
 *
 * @param ingredients - Array of ingredients with quantity, unit, cost_per_unit
 * @param batch_size  - Optional target batch size in grams for proportional scaling
 * @returns Formatted string with per-ingredient cost breakdown and total
 * @throws Error if any ingredient is missing cost_per_unit
 */
function calculate_batch_cost(ingredients: Ingredient[], batch_size?: number): string {
  console.log('[formula-calc-handler] calculate_batch_cost — start', {
    ingredient_count: ingredients.length,
    batch_size,
  });

  const lines: string[] = ['Batch Cost Calculation\n' + '─'.repeat(50)];
  let total_grams = 0;
  let total_cost = 0;

  for (const ing of ingredients) {
    if (ing.cost_per_unit === undefined || ing.cost_per_unit === null) {
      throw new Error(`Ingredient "${ing.name}" is missing cost_per_unit. Required for batch_cost.`);
    }

    const grams = to_grams(ing.quantity, ing.unit);
    // cost_per_unit is per original unit; convert cost to per-gram for uniform calculation
    const grams_per_unit = to_grams(1, ing.unit);
    const cost_per_gram = ing.cost_per_unit / grams_per_unit;
    const ingredient_cost = grams * cost_per_gram;

    total_grams += grams;
    total_cost += ingredient_cost;

    lines.push(
      `  ${ing.name}: ${ing.quantity} ${ing.unit} (${round(grams, 2)} g) × ` +
        `${round(cost_per_gram, 4)} THB/g = ${round(ingredient_cost, 2)} THB`,
    );
  }

  lines.push('─'.repeat(50));
  lines.push(`Total batch weight: ${round(total_grams, 2)} g`);
  lines.push(`Total batch cost:   ${round(total_cost, 2)} THB`);

  if (total_grams > 0) {
    lines.push(`Cost per gram:      ${round(total_cost / total_grams, 4)} THB/g`);
    lines.push(`Cost per kg:        ${round((total_cost / total_grams) * 1000, 2)} THB/kg`);
  }

  if (batch_size && batch_size > 0 && batch_size !== total_grams) {
    const scale = batch_size / total_grams;
    const scaled_cost = total_cost * scale;
    lines.push('─'.repeat(50));
    lines.push(`Scaled to ${batch_size} g (×${round(scale, 4)}):`);
    lines.push(`  Scaled total cost: ${round(scaled_cost, 2)} THB`);
  }

  console.log('[formula-calc-handler] calculate_batch_cost — done', {
    total_grams,
    total_cost,
  });

  return lines.join('\n');
}

/**
 * Scale a formula's ingredient quantities to a new batch size.
 * Preserves relative proportions; scales every ingredient by the same factor.
 *
 * @param ingredients - Array of ingredients in original quantities/units
 * @param batch_size  - Target batch size in grams
 * @returns Formatted string with scaled quantities for each ingredient
 * @throws Error if batch_size is not provided or ingredients are empty
 */
function scale_formula(ingredients: Ingredient[], batch_size: number): string {
  console.log('[formula-calc-handler] scale_formula — start', {
    ingredient_count: ingredients.length,
    batch_size,
  });

  if (!batch_size || batch_size <= 0) {
    throw new Error('batch_size must be a positive number for scale_formula.');
  }

  // Compute current total batch weight in grams
  const current_total_grams = ingredients.reduce((sum, ing) => sum + to_grams(ing.quantity, ing.unit), 0);

  if (current_total_grams === 0) {
    throw new Error('Total ingredient weight is 0. Cannot scale formula.');
  }

  const scale_factor = batch_size / current_total_grams;

  const lines: string[] = [
    `Formula Scaling: ${round(current_total_grams, 2)} g → ${batch_size} g (factor: ×${round(scale_factor, 4)})\n` +
      '─'.repeat(60),
  ];

  for (const ing of ingredients) {
    const original_grams = to_grams(ing.quantity, ing.unit);
    const scaled_grams = original_grams * scale_factor;
    // Present result in the same unit as original for usability
    const grams_per_unit = to_grams(1, ing.unit);
    const scaled_in_original_unit = scaled_grams / grams_per_unit;

    lines.push(
      `  ${ing.name}: ${ing.quantity} ${ing.unit} → ${round(scaled_in_original_unit, 4)} ${ing.unit} (${round(scaled_grams, 2)} g)`,
    );
  }

  lines.push('─'.repeat(60));
  lines.push(`New total batch: ${batch_size} g`);

  console.log('[formula-calc-handler] scale_formula — done', { scale_factor });
  return lines.join('\n');
}

/**
 * Convert all ingredient quantities to a single target unit.
 *
 * @param ingredients - Array of ingredients in their original units
 * @param target_unit - Target unit to convert all quantities into
 * @returns Formatted string listing each ingredient in the target unit
 * @throws Error if target_unit is missing or not recognized
 */
function unit_convert(ingredients: Ingredient[], target_unit: string): string {
  console.log('[formula-calc-handler] unit_convert — start', {
    ingredient_count: ingredients.length,
    target_unit,
  });

  if (!target_unit) {
    throw new Error('target_unit is required for unit_convert.');
  }

  const lines: string[] = [
    `Unit Conversion → ${target_unit}\n` + '─'.repeat(50),
  ];

  for (const ing of ingredients) {
    const grams = to_grams(ing.quantity, ing.unit);
    const converted = from_grams(grams, target_unit);
    lines.push(
      `  ${ing.name}: ${ing.quantity} ${ing.unit} = ${round(converted, 4)} ${target_unit}`,
    );
  }

  console.log('[formula-calc-handler] unit_convert — done');
  return lines.join('\n');
}

/**
 * Compute each ingredient's weight percentage relative to the total batch.
 * All quantities are first converted to grams for fair comparison.
 *
 * @param ingredients - Array of ingredients with quantity and unit
 * @returns Formatted string with percentage breakdown per ingredient
 * @throws Error if total weight is 0
 */
function ingredient_percentage(ingredients: Ingredient[]): string {
  console.log('[formula-calc-handler] ingredient_percentage — start', {
    ingredient_count: ingredients.length,
  });

  const grams_per_ingredient = ingredients.map((ing) => ({
    name: ing.name,
    grams: to_grams(ing.quantity, ing.unit),
    original: `${ing.quantity} ${ing.unit}`,
  }));

  const total_grams = grams_per_ingredient.reduce((sum, i) => sum + i.grams, 0);

  if (total_grams === 0) {
    throw new Error('Total batch weight is 0. Cannot compute percentages.');
  }

  const lines: string[] = [
    `Ingredient Percentages (total batch: ${round(total_grams, 2)} g)\n` + '─'.repeat(55),
  ];

  for (const item of grams_per_ingredient) {
    const pct = (item.grams / total_grams) * 100;
    lines.push(
      `  ${item.name.padEnd(35)} ${item.original.padStart(12)}  →  ${round(pct, 2).toFixed(2)}%`,
    );
  }

  lines.push('─'.repeat(55));
  lines.push(`Total: ${round(total_grams, 2)} g  →  100.00%`);

  console.log('[formula-calc-handler] ingredient_percentage — done', { total_grams });
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main Handler
// ---------------------------------------------------------------------------

/**
 * Handle the `formula_calculate` ReAct tool call.
 *
 * Dispatches to the appropriate pure-math calculation function based on
 * params.operation. No external API calls are made.
 *
 * @param params - FormulaCalcParams specifying the operation and inputs
 * @returns Formatted calculation result string or a descriptive error string
 * @throws Never throws directly — errors are caught and returned as strings
 */
export async function handle_formula_calculate(params: FormulaCalcParams): Promise<string> {
  const start_ts = Date.now();
  console.log('[formula-calc-handler] handle_formula_calculate — start', {
    operation: params.operation,
    ingredient_count: params.ingredients?.length ?? 0,
    batch_size: params.batch_size,
    target_unit: params.target_unit,
    formula_id: params.formula_id,
  });

  // --- Validation ---
  if (!params.operation) {
    return 'Error: operation parameter is required.';
  }

  const valid_operations = ['batch_cost', 'scale_formula', 'unit_convert', 'ingredient_percentage'];
  if (!valid_operations.includes(params.operation)) {
    return `Error: unknown operation "${params.operation}". Valid: ${valid_operations.join(', ')}.`;
  }

  // All operations require ingredients
  if (!params.ingredients || params.ingredients.length === 0) {
    return `Error: ingredients array is required and must not be empty for "${params.operation}".`;
  }

  // Validate each ingredient has required fields
  for (let i = 0; i < params.ingredients.length; i++) {
    const ing = params.ingredients[i];
    if (!ing.name) return `Error: ingredient[${i}] is missing "name".`;
    if (ing.quantity === undefined || ing.quantity === null || isNaN(ing.quantity)) {
      return `Error: ingredient[${i}] "${ing.name}" has invalid "quantity".`;
    }
    if (!ing.unit) return `Error: ingredient[${i}] "${ing.name}" is missing "unit".`;
  }

  try {
    let result: string;

    switch (params.operation) {
      case 'batch_cost':
        result = calculate_batch_cost(params.ingredients, params.batch_size);
        break;

      case 'scale_formula':
        if (!params.batch_size) {
          return 'Error: batch_size is required for scale_formula.';
        }
        result = scale_formula(params.ingredients, params.batch_size);
        break;

      case 'unit_convert':
        if (!params.target_unit) {
          return 'Error: target_unit is required for unit_convert.';
        }
        result = unit_convert(params.ingredients, params.target_unit);
        break;

      case 'ingredient_percentage':
        result = ingredient_percentage(params.ingredients);
        break;

      default:
        return `Error: unhandled operation "${params.operation}".`;
    }

    const elapsed = Date.now() - start_ts;
    console.log('[formula-calc-handler] handle_formula_calculate — done', {
      operation: params.operation,
      elapsed_ms: elapsed,
    });

    return result;
  } catch (error) {
    const elapsed = Date.now() - start_ts;
    const err_msg = error instanceof Error ? error.message : String(error);
    console.log('[formula-calc-handler] handle_formula_calculate — error', {
      operation: params.operation,
      error: err_msg,
      elapsed_ms: elapsed,
    });
    return `Formula calculation failed (operation: "${params.operation}"): ${err_msg}`;
  }
}
