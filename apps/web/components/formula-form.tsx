"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Search, Beaker, CheckCircle2, Loader2, Sparkles, Wand2 } from "lucide-react";
import { to_formula_ingredients, type GeneratedFormula } from "@/lib/ai/formula-conversion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Shape of an ingredient row in the formula form.
 */
interface FormulaIngredient {
  materialId: string;
  rm_code: string;
  productName: string;
  inci_name?: string;
  amount: number;
  percentage?: number;
  notes?: string;
}

const FORMULA_EDITOR_STATUSES = ["draft", "confirmed", "testing", "approved", "rejected"] as const;
type FormulaEditorStatus = typeof FORMULA_EDITOR_STATUSES[number];

function is_formula_editor_status(value: unknown): value is FormulaEditorStatus {
  return typeof value === "string" && FORMULA_EDITOR_STATUSES.includes(value as FormulaEditorStatus);
}

/**
 * FormulaForm — Create or edit a formula.
 * Reads `?edit=<id>` from the URL to determine edit mode.
 * When editing, fetches the existing formula and pre-populates the form.
 *
 * @returns JSX.Element
 */
export function FormulaForm() {
  const utils = trpc.useUtils();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const isEditMode = !!editId;

  const [formulaName, setFormulaName] = useState("");
  const [version, setVersion] = useState(1);
  const [client, setClient] = useState("");
  const [targetBenefits, setTargetBenefits] = useState<string[]>([]);
  const [benefitInput, setBenefitInput] = useState("");
  const [ingredients, setIngredients] = useState<FormulaIngredient[]>([]);
  const [totalAmount, setTotalAmount] = useState(100);
  const [remarks, setRemarks] = useState("");
  const [status, setStatus] = useState<FormulaEditorStatus>("draft");
  const [formLoaded, setFormLoaded] = useState(false);

  const [showIngredientPicker, setShowIngredientPicker] = useState(false);
  const [ingredientSearch, setIngredientSearch] = useState("");
  const [filterByBenefit, setFilterByBenefit] = useState("");
  const [filterByUseCase, setFilterByUseCase] = useState("");
  const [aiBrief, setAiBrief] = useState("");
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [agentStatus, setAgentStatus] = useState("");
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentSuccess, setAgentSuccess] = useState<string | null>(null);

  // --- Fetch existing formula when in edit mode ---
  const { data: existingFormula, isLoading: formulaLoading } = trpc.formulas.getById.useQuery(
    { id: editId! },
    { enabled: isEditMode }
  );

  // Pre-populate form fields when formula data arrives
  useEffect(() => {
    if (existingFormula && !formLoaded) {
      console.log("[formula-form] populating edit form", { id: editId });
      setFormulaName(existingFormula.formulaName || "");
      setVersion(existingFormula.version || 1);
      setClient(existingFormula.client || "");
      setTargetBenefits(existingFormula.targetBenefits || []);
      setTotalAmount(existingFormula.totalAmount || 100);
      setRemarks(existingFormula.remarks || "");
      setStatus(is_formula_editor_status(existingFormula.status) ? existingFormula.status : "draft");
      setIngredients(
        (existingFormula.ingredients || []).map((ing: any) => ({
          materialId: ing.materialId || "",
          rm_code: ing.rm_code || "",
          productName: ing.productName || "",
          inci_name: ing.inci_name || "",
          amount: ing.amount || 0,
          percentage: ing.percentage || 0,
          notes: ing.notes || "",
        }))
      );
      setFormLoaded(true);
    }
  }, [existingFormula, formLoaded, editId]);

  const { data: productsData } = trpc.products.list.useQuery({
    limit: 1000,
    offset: 0,
  });
  const products = productsData?.products || [];

  /**
   * Ask the ReAct formula agent for a structured plan, then populate every
   * editable field. The chat endpoint is explicitly instructed not to save;
   * this screen remains the user's review-and-save step.
   */
  const generateFormulaPlan = useCallback(async () => {
    const brief = aiBrief.trim();
    if (!brief) {
      setAgentError("Describe the product, benefits, texture, size, and any constraints first.");
      return;
    }

    setIsGeneratingPlan(true);
    setAgentError(null);
    setAgentSuccess(null);
    setAgentStatus("Planning the formula and checking the ingredient knowledge base...");

    try {
      const response = await fetch("/api/ai/rnd-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Create a complete, editable cosmetic formula plan for this brief: ${brief}. Use the generate_formula tool. Return a structured formula with ingredients, percentages, batch amounts, and review warnings.`,
          userId: "formula-editor",
          conversationHistory: [],
          persistFormula: false,
          enableEnhancements: true,
          enableSearch: true,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "The formula agent could not complete the plan. Please refine the brief and try again.");
      }

      const formula = data?.metadata?.artifacts?.formula as GeneratedFormula | undefined;
      if (!formula) {
        throw new Error("The agent returned a response but no structured formula plan. Please ask for a product type and at least one target benefit.");
      }

      setAgentStatus("Matching the agent plan to your ingredient catalog and filling the editor...");
      const plannedIngredients = to_formula_ingredients(formula).map((ingredient) => {
        const catalogProduct = products.find((product: any) => (
          product.productCode === ingredient.rm_code
          || product.inci_name?.toLowerCase() === ingredient.inci_name?.toLowerCase()
          || product.productName?.toLowerCase() === ingredient.productName.toLowerCase()
        ));

        return {
          ...ingredient,
          materialId: catalogProduct?._id || ingredient.materialId,
          rm_code: catalogProduct?.productCode || ingredient.rm_code,
          productName: catalogProduct?.productName || ingredient.productName,
          inci_name: catalogProduct?.inci_name || ingredient.inci_name,
        };
      });
      if (plannedIngredients.length === 0) {
        throw new Error("The plan has no usable ingredients, so nothing was filled. Please try a more specific product brief.");
      }

      const warnings = Array.isArray(formula.warnings)
        ? formula.warnings.map((warning) => typeof warning === "string" ? warning : warning.message).filter(Boolean)
        : [];
      setFormulaName(String(formula.formula_name || `AI ${formula.product_type || "Formula"}`));
      setVersion(1);
      setTargetBenefits(Array.isArray(formula.target_benefits) ? formula.target_benefits.map(String) : []);
      setTotalAmount(Number(formula.batch_size_grams) > 0 ? Number(formula.batch_size_grams) : 100);
      setIngredients(plannedIngredients);
      setRemarks([
        `AI formula plan from brief: ${brief}`,
        formula.generation_prompt ? `Agent plan: ${formula.generation_prompt}` : "",
        warnings.length ? `Review before production: ${warnings.join(" | ")}` : "",
      ].filter(Boolean).join("\n"));
      setStatus("draft");
      setAgentStatus("");
      setAgentSuccess(`Formula plan added: ${plannedIngredients.length} ingredients are ready to review and edit.`);
    } catch (error) {
      console.error("[formula-form] generateFormulaPlan failed", error);
      setAgentStatus("");
      setAgentError(error instanceof Error ? error.message : "The formula agent failed before it could fill the form.");
    } finally {
      setIsGeneratingPlan(false);
    }
  }, [aiBrief, products]);

  const createFormula = trpc.formulas.create.useMutation({
    onSuccess: () => {
      utils.formulas.list.invalidate();
      setFormulaName("");
      setVersion(1);
      setClient("");
      setTargetBenefits([]);
      setIngredients([]);
      setTotalAmount(100);
      setRemarks("");
      setStatus("draft");
      alert("สร้างสูตรเรียบร้อยแล้ว!");
    },
    onError: (error) => {
      alert(error.message || "ไม่สามารถสร้างสูตรได้");
    },
  });

  const updateFormula = trpc.formulas.update.useMutation({
    onSuccess: () => {
      utils.formulas.list.invalidate();
      utils.formulas.getById.invalidate({ id: editId! });
      alert("บันทึกสูตรเรียบร้อยแล้ว!");
    },
    onError: (error) => {
      alert(error.message || "ไม่สามารถบันทึกสูตรได้");
    },
  });

  const handleAddBenefit = () => {
    if (benefitInput.trim()) {
      setTargetBenefits([...targetBenefits, benefitInput.trim()]);
      setBenefitInput("");
    }
  };

  const handleRemoveBenefit = (index: number) => {
    setTargetBenefits(targetBenefits.filter((_, i) => i !== index));
  };

  const handleAddIngredient = (product: any) => {
    const newIngredient: FormulaIngredient = {
      materialId: product._id,
      rm_code: product.productCode,
      productName: product.productName,
      inci_name: product.inci_name,
      amount: 0,
      percentage: 0,
      notes: "",
    };
    setIngredients([...ingredients, newIngredient]);
    setShowIngredientPicker(false);
    setIngredientSearch("");
  };

  const handleRemoveIngredient = (index: number) => {
    setIngredients(ingredients.filter((_, i) => i !== index));
  };

  const handleUpdateIngredient = (index: number, field: string, value: any) => {
    const updated = [...ingredients];
    updated[index] = { ...updated[index], [field]: value };

    // Auto-calculate percentage when amount changes
    if (field === "amount" && totalAmount > 0) {
      updated[index].percentage = (value / totalAmount) * 100;
    }

    setIngredients(updated);
  };

  /**
   * Submit handler — creates new formula or updates existing one.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log("[formula-form] handleSubmit", { isEditMode, editId });

    if (ingredients.length === 0) {
      alert("กรุณาเพิ่มสารอย่างน้อย 1 ชนิด");
      return;
    }

    const mapped_ingredients = ingredients.map((ing) => ({
      ...ing,
      amount: Number(ing.amount),
      percentage: ing.percentage ? Number(ing.percentage) : undefined,
    }));
    const editable_status = status === "confirmed" ? "draft" : status;

    try {
      if (isEditMode && editId) {
        await updateFormula.mutateAsync({
          id: editId,
          formulaName,
          version,
          client,
          targetBenefits,
          ingredients: mapped_ingredients,
          totalAmount,
          remarks,
          ...(status === "confirmed" ? {} : { status: editable_status }),
        });
      } else {
        await createFormula.mutateAsync({
          formulaName,
          version,
          client,
          targetBenefits,
          ingredients: mapped_ingredients,
          totalAmount,
          remarks,
          status: editable_status,
        });
      }
    } catch (error) {
      console.error("[formula-form] submit error:", error);
    }
  };

  const filteredProducts = products.filter((p: any) => {
    const searchLower = ingredientSearch.toLowerCase();

    // Text search filter
    const matchesSearch = !searchLower || (
      p.productCode?.toLowerCase().includes(searchLower) ||
      p.productName?.toLowerCase().includes(searchLower) ||
      p.inci_name?.toLowerCase().includes(searchLower)
    );

    // Benefit filter
    const matchesBenefit = !filterByBenefit || (
      Array.isArray(p.benefits) && p.benefits.some((b: string) =>
        b.toLowerCase().includes(filterByBenefit.toLowerCase())
      )
    );

    // Use case filter
    const matchesUseCase = !filterByUseCase || (
      Array.isArray(p.usecase) && p.usecase.some((u: string) =>
        u.toLowerCase().includes(filterByUseCase.toLowerCase())
      )
    );

    return matchesSearch && matchesBenefit && matchesUseCase;
  });

  // Get unique benefits and use cases for filter dropdowns
  const allBenefits = Array.from(new Set(
    products?.flatMap((p: any) => Array.isArray(p.benefits) ? p.benefits : []) || []
  )).sort();

  const allUseCases = Array.from(new Set(
    products?.flatMap((p: any) => Array.isArray(p.usecase) ? p.usecase : []) || []
  )).sort();

  const totalUsedAmount = ingredients.reduce((sum, ing) => sum + Number(ing.amount || 0), 0);
  const totalPercentage = ingredients.reduce((sum, ing) => sum + Number(ing.percentage || 0), 0);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Agentic formula planner */}
      <section className="relative overflow-hidden rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-white to-green-50 p-4 shadow-[0_14px_36px_rgba(16,185,129,0.12)]">
        <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-emerald-300/25 blur-2xl" />
        <div className="relative flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 text-white shadow-[0_8px_18px_rgba(5,150,105,0.28)]">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-emerald-950">
                Agentic Formula Planner <span className="rounded-full border border-emerald-200 bg-white/70 px-2 py-0.5 text-[10px] font-medium text-emerald-700">AI draft</span>
              </h2>
              <p className="mt-0.5 text-xs leading-relaxed text-emerald-900/65">
                Describe the product. The agent plans the formula, checks the ingredient knowledge base, and fills this editable draft for you to review.
              </p>
            </div>
          </div>
          <Textarea
            value={aiBrief}
            onChange={(event) => setAiBrief(event.target.value)}
            placeholder="Example: Create a light, fragrance-free niacinamide gel serum for oily skin, 100 g batch. Avoid alcohol and keep the texture non-sticky."
            rows={3}
            disabled={isGeneratingPlan}
            className="min-h-[84px] rounded-xl border-emerald-200/80 bg-white/80 pr-3 text-sm shadow-inner shadow-emerald-950/[0.03] focus:border-emerald-400"
            aria-describedby="formula-agent-help"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p id="formula-agent-help" className="text-[11px] text-emerald-800/60">
              Nothing is saved automatically. You can edit every field before saving the draft.
            </p>
            <Button
              type="button"
              onClick={generateFormulaPlan}
              disabled={isGeneratingPlan || !aiBrief.trim()}
              className="h-9 rounded-xl bg-gradient-to-br from-emerald-600 to-green-600 px-3.5 text-xs text-white shadow-[0_8px_18px_rgba(5,150,105,0.22)] hover:from-emerald-500 hover:to-green-500"
            >
              {isGeneratingPlan ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              {isGeneratingPlan ? "Agent is planning..." : "Generate & auto-fill"}
            </Button>
          </div>
          {agentStatus && <p role="status" className="flex items-center gap-1.5 text-xs text-emerald-700"><Loader2 className="h-3.5 w-3.5 animate-spin" />{agentStatus}</p>}
          {agentSuccess && <p role="status" className="flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{agentSuccess}</p>}
          {agentError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{agentError}</p>}
        </div>
      </section>

      {/* Formula Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Beaker className="h-5 w-5" />
            ข้อมูลสูตร
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="formulaName">ชื่อสูตร *</Label>
              <Input
                id="formulaName"
                placeholder="เช่น Vitamin C Serum"
                value={formulaName}
                onChange={(e) => setFormulaName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="version">Attempt/Version *</Label>
              <Input
                id="version"
                type="number"
                min="1"
                value={version}
                onChange={(e) => setVersion(parseInt(e.target.value) || 1)}
                required
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="client">Client</Label>
              <Input
                id="client"
                placeholder="ชื่อลูกค้า"
                value={client}
                onChange={(e) => setClient(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="totalAmount">Total Batch Size (g/ml)</Label>
              <Input
                id="totalAmount"
                type="number"
                min="0"
                step="0.01"
                value={totalAmount}
                onChange={(e) => setTotalAmount(parseFloat(e.target.value) || 100)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              value={status}
              onChange={(e) => {
                if (is_formula_editor_status(e.target.value)) {
                  setStatus(e.target.value);
                }
              }}
              disabled={status === "confirmed"}
              className="w-full rounded-md border px-3 py-2 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            >
              {status === "confirmed" && <option value="confirmed">Confirmed</option>}
              <option value="draft">Draft</option>
              <option value="testing">Testing</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            {status === "confirmed" && (
              <p className="text-xs text-muted-foreground">Confirmed formulas retain their status. Create a new draft to make a revision.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Target Benefits (เป้าหมายประโยชน์)</Label>
            <div className="flex gap-2">
              <Input
                placeholder="เช่น ผิวขาวกระจ่างใส"
                value={benefitInput}
                onChange={(e) => setBenefitInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddBenefit();
                  }
                }}
              />
              <Button type="button" onClick={handleAddBenefit}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {targetBenefits.map((benefit, idx) => (
                <Badge
                  key={idx}
                  variant="secondary"
                  className="cursor-pointer"
                  onClick={() => handleRemoveBenefit(idx)}
                >
                  {benefit} ×
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="remarks">Remarks (หมายเหตุ)</Label>
            <Textarea
              id="remarks"
              placeholder="รายละเอียดเพิ่มเติม..."
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* Ingredients */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>สารในสูตร ({ingredients.length} ชนิด)</CardTitle>
            <Dialog open={showIngredientPicker} onOpenChange={setShowIngredientPicker}>
              <DialogTrigger asChild>
                <Button type="button">
                  <Plus className="h-4 w-4 mr-2" />
                  เพิ่มสาร
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-[90vw] w-full max-h-[90vh] overflow-hidden flex flex-col">
                <DialogHeader>
                  <DialogTitle>เลือกสาร ({filteredProducts?.length || 0} รายการ)</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
                  {/* Search and Filters */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <Input
                        placeholder="ค้นหา รหัสสาร, ชื่อสาร, INCI Name..."
                        value={ingredientSearch}
                        onChange={(e) => setIngredientSearch(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                    <div>
                      <select
                        value={filterByBenefit}
                        onChange={(e) => setFilterByBenefit(e.target.value)}
                        className="w-full px-3 py-2 border rounded-md text-sm"
                      >
                        <option value="">ทุก Benefits</option>
                        {allBenefits.map((benefit: any) => (
                          <option key={benefit} value={benefit}>
                            {benefit}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <select
                        value={filterByUseCase}
                        onChange={(e) => setFilterByUseCase(e.target.value)}
                        className="w-full px-3 py-2 border rounded-md text-sm"
                      >
                        <option value="">ทุก Use Cases</option>
                        {allUseCases.map((usecase: any) => (
                          <option key={usecase} value={usecase}>
                            {usecase}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Results Table */}
                  <div className="flex-1 overflow-auto border rounded-lg">
                    <Table>
                      <TableHeader className="sticky top-0 bg-white z-10">
                        <TableRow>
                          <TableHead className="w-32">รหัสสาร</TableHead>
                          <TableHead className="min-w-[200px]">ชื่อสาร</TableHead>
                          <TableHead className="min-w-[150px]">INCI Name</TableHead>
                          <TableHead className="min-w-[200px]">Benefits</TableHead>
                          <TableHead className="min-w-[150px]">Use Cases</TableHead>
                          <TableHead className="w-24 sticky right-0 bg-white">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredProducts?.length > 0 ? (
                          filteredProducts.slice(0, 100).map((product: any) => (
                            <TableRow key={product._id}>
                              <TableCell className="font-mono text-sm">
                                {product.productCode}
                              </TableCell>
                              <TableCell className="font-medium">
                                {product.productName}
                              </TableCell>
                              <TableCell className="text-sm text-gray-600">
                                {product.inci_name || "-"}
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-1">
                                  {Array.isArray(product.benefits) && product.benefits.length > 0 ? (
                                    product.benefits.slice(0, 3).map((benefit: string, idx: number) => (
                                      <Badge
                                        key={idx}
                                        variant="secondary"
                                        className="text-xs bg-blue-100 text-blue-800"
                                      >
                                        {benefit}
                                      </Badge>
                                    ))
                                  ) : (
                                    <span className="text-xs text-gray-400">-</span>
                                  )}
                                  {Array.isArray(product.benefits) && product.benefits.length > 3 && (
                                    <Badge variant="outline" className="text-xs">
                                      +{product.benefits.length - 3}
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-1">
                                  {Array.isArray(product.usecase) && product.usecase.length > 0 ? (
                                    product.usecase.slice(0, 2).map((usecase: string, idx: number) => (
                                      <Badge
                                        key={idx}
                                        variant="outline"
                                        className="text-xs bg-green-50 text-green-700"
                                      >
                                        {usecase}
                                      </Badge>
                                    ))
                                  ) : (
                                    <span className="text-xs text-gray-400">-</span>
                                  )}
                                  {Array.isArray(product.usecase) && product.usecase.length > 2 && (
                                    <Badge variant="outline" className="text-xs">
                                      +{product.usecase.length - 2}
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="sticky right-0 bg-white">
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => handleAddIngredient(product)}
                                >
                                  เลือก
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                              ไม่พบสารที่ตรงกับเงื่อนไข
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {ingredients.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>รหัสสาร</TableHead>
                    <TableHead>ชื่อสาร</TableHead>
                    <TableHead>Amount (g/ml)</TableHead>
                    <TableHead>%</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ingredients.map((ingredient, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-mono text-sm">
                        {ingredient.rm_code}
                      </TableCell>
                      <TableCell>{ingredient.productName}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={ingredient.amount}
                          onChange={(e) =>
                            handleUpdateIngredient(idx, "amount", parseFloat(e.target.value) || 0)
                          }
                          className="w-24"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={ingredient.percentage?.toFixed(2) || 0}
                          onChange={(e) =>
                            handleUpdateIngredient(idx, "percentage", parseFloat(e.target.value) || 0)
                          }
                          className="w-24"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          placeholder="หมายเหตุ"
                          value={ingredient.notes || ""}
                          onChange={(e) => handleUpdateIngredient(idx, "notes", e.target.value)}
                          className="w-32"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRemoveIngredient(idx)}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold bg-gray-50">
                    <TableCell colSpan={2}>Total</TableCell>
                    <TableCell>{totalUsedAmount.toFixed(2)}</TableCell>
                    <TableCell>{totalPercentage.toFixed(2)}%</TableCell>
                    <TableCell colSpan={2}></TableCell>
                  </TableRow>
                </TableBody>
              </Table>

              {totalPercentage > 100 && (
                <p className="text-red-600 text-sm mt-2">
                  ⚠️ Warning: Total percentage exceeds 100%
                </p>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-gray-500">
              ยังไม่มีสารในสูตร กรุณาเพิ่มสาร
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={createFormula.isPending || updateFormula.isPending}
          className="bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-[12px] h-8 px-4"
        >
          {(createFormula.isPending || updateFormula.isPending)
            ? "กำลังบันทึก..."
            : isEditMode ? "บันทึกการแก้ไข" : "บันทึกสูตร"}
        </Button>
      </div>
    </form>
  );
}
