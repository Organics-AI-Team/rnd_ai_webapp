"use client";

import { type FormEvent, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type IngredientEditorMode = "create" | "edit" | "duplicate";

interface IngredientEditorDialogProps {
  open: boolean;
  mode: IngredientEditorMode;
  ingredient?: any | null;
  on_open_change: (open: boolean) => void;
}

interface IngredientFormData {
  product_name: string;
  inci_name: string;
  supplier: string;
  price: string;
  benefits: string;
  use_cases: string;
}

const empty_form: IngredientFormData = {
  product_name: "",
  inci_name: "",
  supplier: "",
  price: "",
  benefits: "",
  use_cases: "",
};

function text_value(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "string" ? value : "";
}

function form_from_ingredient(ingredient?: any | null): IngredientFormData {
  if (!ingredient) return empty_form;

  return {
    product_name: ingredient.productName || "",
    inci_name: ingredient.inci_name || "",
    supplier: ingredient.supplier || "",
    price: ingredient.price !== undefined && ingredient.price !== null ? String(ingredient.price) : "",
    benefits: text_value(ingredient.benefits),
    use_cases: text_value(ingredient.usecase ?? ingredient.details),
  };
}

/**
 * Focused create/edit surface for an ingredient. It deliberately lives in a
 * dialog so the Ingredients table remains the single ingredients workspace.
 */
export function IngredientEditorDialog({
  open,
  mode,
  ingredient,
  on_open_change,
}: IngredientEditorDialogProps) {
  const utils = trpc.useUtils();
  const [form_data, set_form_data] = useState<IngredientFormData>(empty_form);
  const [has_changed_duplicate, set_has_changed_duplicate] = useState(false);
  const [form_error, set_form_error] = useState<string>("");

  const is_editing = mode === "edit";
  const is_duplicate = mode === "duplicate";
  const { data: next_code_data } = trpc.products.getNextCode.useQuery(undefined, {
    enabled: open && !is_editing,
  });

  useEffect(() => {
    if (!open) return;
    set_form_data(form_from_ingredient(ingredient));
    set_has_changed_duplicate(false);
    set_form_error("");
  }, [ingredient, mode, open]);

  const close_dialog = () => {
    set_form_error("");
    on_open_change(false);
  };

  const create_ingredient = trpc.products.create.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.products.list.invalidate(),
        utils.products.getNextCode.invalidate(),
      ]);
      close_dialog();
    },
  });

  const update_ingredient = trpc.products.update.useMutation({
    onSuccess: async () => {
      await utils.products.list.invalidate();
      close_dialog();
    },
  });

  const is_saving = create_ingredient.isPending || update_ingredient.isPending;

  const update_field = (field: keyof IngredientFormData, value: string) => {
    set_form_data((current) => ({ ...current, [field]: value }));
    set_form_error("");
    if (is_duplicate) set_has_changed_duplicate(true);
  };

  const handle_submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (is_duplicate && !has_changed_duplicate) {
      set_form_error("Change at least one field before saving this copy.");
      return;
    }

    const price = form_data.price.trim() ? Number(form_data.price) : undefined;
    if (price !== undefined && (!Number.isFinite(price) || price < 0)) {
      set_form_error("Enter a valid price or leave it blank.");
      return;
    }

    try {
      const payload = {
        productName: form_data.product_name.trim(),
        inciName: form_data.inci_name.trim(),
        price,
        supplier: form_data.supplier.trim(),
        benefits: form_data.benefits.trim(),
        details: form_data.use_cases.trim(),
      };

      if (is_editing && ingredient?._id) {
        await update_ingredient.mutateAsync({
          id: ingredient._id,
          productCode: ingredient.productCode,
          ...payload,
        });
      } else {
        await create_ingredient.mutateAsync(payload);
      }
    } catch (error: any) {
      set_form_error(error?.message || "The ingredient could not be saved. Please try again.");
    }
  };

  const heading = is_editing ? "Edit ingredient" : is_duplicate ? "Duplicate ingredient" : "Add ingredient";
  const description = is_editing
    ? "Update this ingredient without leaving your catalog."
    : is_duplicate
      ? "Make a distinct copy. Change at least one field before saving."
      : "Add a raw material to your shared ingredient catalog.";
  const displayed_code = is_editing ? ingredient?.productCode : next_code_data?.nextCode || "Generating…";

  return (
    <Dialog open={open} onOpenChange={(next_open) => (next_open ? on_open_change(true) : close_dialog())}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto rounded-3xl border-2 border-emerald-100 bg-white p-0 shadow-[0_30px_90px_rgba(17,24,39,0.24)]">
        <DialogHeader className="border-b border-emerald-100 bg-gradient-to-r from-white via-emerald-50/70 to-green-50/80 px-6 py-5 pr-14">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 p-2 text-white shadow-[0_8px_18px_rgba(5,150,105,0.25)]">
              {is_duplicate ? <Sparkles className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            </div>
            <div className="space-y-1">
              <DialogTitle className="text-base font-semibold text-emerald-950">{heading}</DialogTitle>
              <DialogDescription className="text-sm text-emerald-900/55">{description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handle_submit} className="space-y-5 px-6 py-5">
          {is_duplicate && (
            <Alert className="border-amber-200 bg-amber-50 text-amber-950 [&>svg]:text-amber-600">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle className="text-amber-950">Copy mode</AlertTitle>
              <AlertDescription className="text-amber-900/75">
                {has_changed_duplicate ? "A change is ready to save." : "Edit any field to create a distinct ingredient."}
              </AlertDescription>
            </Alert>
          )}

          {form_error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Could not save</AlertTitle>
              <AlertDescription>{form_error}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-[0.8fr_1.2fr]">
            <div className="space-y-2">
              <Label htmlFor="ingredient-code">Ingredient code</Label>
              <Input
                id="ingredient-code"
                value={displayed_code}
                disabled
                className="h-10 border-emerald-100 bg-emerald-50/70 font-mono text-sm font-semibold text-emerald-900 disabled:opacity-100"
              />
              {!is_editing && <p className="text-xs text-emerald-900/45">Generated automatically on save.</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="ingredient-name">Trade name <span className="text-red-600">*</span></Label>
              <Input
                id="ingredient-name"
                value={form_data.product_name}
                onChange={(event) => update_field("product_name", event.target.value)}
                placeholder="e.g. Green tea extract"
                className="h-10"
                required
                autoFocus
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ingredient-inci">INCI name</Label>
            <Textarea
              id="ingredient-inci"
              value={form_data.inci_name}
              onChange={(event) => update_field("inci_name", event.target.value)}
              placeholder="International Nomenclature Cosmetic Ingredient name"
              rows={2}
              className="min-h-[76px]"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ingredient-supplier">Supplier</Label>
              <Input
                id="ingredient-supplier"
                value={form_data.supplier}
                onChange={(event) => update_field("supplier", event.target.value)}
                placeholder="Supplier name"
                className="h-10"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ingredient-price">Cost (THB)</Label>
              <Input
                id="ingredient-price"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={form_data.price}
                onChange={(event) => update_field("price", event.target.value)}
                placeholder="0.00"
                className="h-10"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ingredient-benefits">Benefits</Label>
              <Textarea
                id="ingredient-benefits"
                value={form_data.benefits}
                onChange={(event) => update_field("benefits", event.target.value)}
                placeholder="Hydrating, soothing, antioxidant"
                rows={3}
                className="min-h-[94px]"
              />
              <p className="text-xs text-emerald-900/45">Separate items with commas.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ingredient-use-cases">Use cases</Label>
              <Textarea
                id="ingredient-use-cases"
                value={form_data.use_cases}
                onChange={(event) => update_field("use_cases", event.target.value)}
                placeholder="Serums, lotions, leave-on care"
                rows={3}
                className="min-h-[94px]"
              />
              <p className="text-xs text-emerald-900/45">Separate items with commas.</p>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-emerald-100 pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={close_dialog} disabled={is_saving} className="h-10">
              Cancel
            </Button>
            <Button type="submit" disabled={is_saving} className="h-10 min-w-32">
              {is_saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {is_saving ? "Saving…" : is_editing ? "Save changes" : "Save ingredient"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
