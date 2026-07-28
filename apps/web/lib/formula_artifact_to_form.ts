// apps/web/lib/formula_artifact_to_form.ts
/**
 * Pure mapper: server-validated FormulaArtifactV1 payload → FormulaForm state.
 *
 * The artifact API (/api/ai/artifacts/[id]) already validated the payload
 * against the canonical schema; this module only needs structural guards and
 * decimal-string → number conversion for the form inputs. Framework-free so
 * it is unit-testable in the node environment.
 */

/** One ingredient row in the FormulaForm state. */
export interface FormulaFormIngredientState {
  readonly materialId: string;
  readonly rm_code: string;
  readonly productName: string;
  readonly inci_name: string;
  readonly amount: number;
  readonly percentage: number;
  readonly notes: string;
}

/** The FormulaForm fields a generated artifact populates. */
export interface FormulaFormState {
  readonly formulaName: string;
  readonly targetBenefits: readonly string[];
  readonly totalAmount: number;
  readonly remarks: string;
  readonly ingredients: readonly FormulaFormIngredientState[];
}

/** Parse a decimal string (or number) into a finite non-negative number. */
function to_number(value: unknown, fallback: number): number {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Map a formula artifact payload into the FormulaForm state shape.
 *
 * @param content - The `content` field returned by GET /api/ai/artifacts/[id].
 * @returns Form state, or null when the payload is not usable (no name or no
 *          ingredient with an rm_code) — the caller then leaves the form as-is.
 */
export function formula_artifact_to_form_state(content: unknown): FormulaFormState | null {
  if (!content || typeof content !== "object") return null;
  const artifact = content as Record<string, unknown>;
  const name = typeof artifact.name === "string" ? artifact.name.trim() : "";
  const raw_ingredients = Array.isArray(artifact.ingredients) ? artifact.ingredients : [];
  if (!name || raw_ingredients.length === 0) return null;

  const ingredients: FormulaFormIngredientState[] = raw_ingredients.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const ingredient = raw as Record<string, unknown>;
    const rm_code = typeof ingredient.rm_code === "string" ? ingredient.rm_code.trim() : "";
    if (!rm_code) return [];
    return [
      {
        materialId: typeof ingredient.material_id === "string" ? ingredient.material_id : "",
        rm_code,
        // The artifact carries no trade name; the reviewer resolves it via the
        // picker — rm_code is the honest placeholder.
        productName: rm_code,
        inci_name: "",
        amount: to_number(ingredient.amount, 0),
        percentage: to_number(ingredient.percentage, 0),
        notes: typeof ingredient.rationale === "string" ? ingredient.rationale : "",
      },
    ];
  });
  if (ingredients.length === 0) return null;

  const claims = Array.isArray(artifact.claims) ? artifact.claims : [];
  const warnings = Array.isArray(artifact.warnings) ? artifact.warnings.map(String) : [];
  return {
    formulaName: name,
    targetBenefits: claims.flatMap((claim) =>
      claim && typeof claim === "object" && typeof (claim as { text?: unknown }).text === "string"
        ? [(claim as { text: string }).text]
        : [],
    ),
    totalAmount: to_number(artifact.batch_size, 100) || 100,
    remarks: warnings.join("\n"),
    ingredients,
  };
}
