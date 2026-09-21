"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server";
import { trpc } from "@/lib/trpc-client";
import { useAuth } from "@/lib/app-auth";
import { useAgentRun } from "@/hooks/use_agent_run";
import { AiRunView } from "@/components/ai";
import { formula_artifact_to_form_state } from "@/lib/formula_artifact_to_form";
import { is_formula_status } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IconTile, Surface } from "@/components/ui/surface";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Search, Beaker, CheckCircle2, Loader2, Sparkles, Wand2 } from "lucide-react";
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

function normalized_catalog_value(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase();
}

/** Resolve an artifact material to the tenant's own raw-material catalogue. */
function find_catalog_product(ingredient: FormulaIngredient, catalog: readonly any[]): any | undefined {
  const material_id = normalized_catalog_value(ingredient.materialId);
  const rm_code = normalized_catalog_value(ingredient.rm_code);
  return catalog.find((product: any) =>
    (material_id && normalized_catalog_value(product._id) === material_id)
    || (rm_code && normalized_catalog_value(product.productCode) === rm_code),
  );
}

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Formula = RouterOutputs["formulas"]["getById"];
type FormulaStatus = Formula["status"];

/**
 * FormulaForm — Create or edit a formula.
 * Reads `?edit=<id>` from the URL to determine edit mode.
 * When editing, fetches the existing formula and pre-populates the form.
 *
 * @returns JSX.Element
 */
export function FormulaForm() {
  const { user } = useAuth();
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
  const [status, setStatus] = useState<FormulaStatus>("draft");
  const [formLoaded, setFormLoaded] = useState(false);

  // --- Formulate (governed agentic generation, spec §11.2) ---
  const agent_run = useAgentRun();
  const [formulateBrief, setFormulateBrief] = useState("");
  const [formulateStarted, setFormulateStarted] = useState(false);
  const [formulation_thread_id, set_formulation_thread_id] = useState<string | null>(null);
  const [formulate_error, set_formulate_error] = useState<string | null>(null);
  const [artifact_error, set_artifact_error] = useState<string | null>(null);
  const applied_artifact_ref = useRef<string | null>(null);

  const [showIngredientPicker, setShowIngredientPicker] = useState(false);
  const [ingredientSearch, setIngredientSearch] = useState("");
  const [filterByBenefit, setFilterByBenefit] = useState("");
  const [filterByUseCase, setFilterByUseCase] = useState("");

  // --- Fetch existing formula when in edit mode ---
  const { data: existingFormula, isLoading: formulaLoading } = trpc.formulas.getById.useQuery(
    { id: editId! },
    { enabled: isEditMode }
  );

  // Pre-populate form fields when formula data arrives
  useEffect(() => {
    if (existingFormula && !formLoaded) {
      const formula: Formula = existingFormula;
      let is_active = true;

      queueMicrotask(() => {
        if (!is_active) return;
        console.log("[formula-form] populating edit form", { id: editId });
        setFormulaName(formula.formulaName || "");
        setVersion(formula.version || 1);
        setClient(formula.client || "");
        setTargetBenefits(formula.targetBenefits || []);
        setTotalAmount(formula.totalAmount || 100);
        setRemarks(formula.remarks || "");
        setStatus(formula.status || "draft");
        setIngredients(
          (formula.ingredients || []).map((ing) => ({
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
      });

      return () => {
        is_active = false;
      };
    }
  }, [existingFormula, formLoaded, editId]);

  const { data: productsData, isFetching: productsSearching } = trpc.products.list.useQuery({
    // The generated artifact must be resolved against the whole tenant
    // catalogue before any row is applied. The endpoint's maximum is 1,000.
    limit: 1000,
    offset: 0,
  });
  const products = productsData?.products || [];
  const create_formulation_thread = trpc.chatThreads.create.useMutation();
  const add_formulation_message = trpc.chatThreads.addMessage.useMutation();

  /**
   * Start a governed agentic run that formulates from the brief.
   * The run streams typed SSE events into AiRunView (evidence, clarification
   * questions, approval checkpoints); the produced artifact populates this
   * form for human review — it is never saved without the reviewer.
   */
  const handleFormulate = async () => {
    if (!formulateBrief.trim() || agent_run.is_starting || agent_run.is_streaming) return;
    console.log("[formula-form] handleFormulate — starting governed run", {
      brief: formulateBrief,
    });
    setFormulateStarted(true);
    set_formulate_error(null);
    set_artifact_error(null);
    applied_artifact_ref.current = null;
    const message = `Generate a complete, cited formula draft for: ${formulateBrief}`;
    try {
      // A governed run must be tied to a tenant-owned thread. Persisting the
      // brief first prevents a worker-side runtime failure and keeps the
      // answer/artifact traceable when the user leaves and returns.
      let thread_id = formulation_thread_id;
      if (!thread_id) {
        const thread = await create_formulation_thread.mutateAsync({
          agentType: "formulation",
          title: formulateBrief.trim().slice(0, 80),
        });
        thread_id = thread.id;
        set_formulation_thread_id(thread_id);
      }
      await add_formulation_message.mutateAsync({
        threadId: thread_id,
        role: "user",
        content: message,
        metadata: { source: "formula_form" },
      });
      await agent_run.start_run({
        thread_id,
        agent_key: "formulation",
        message,
        attachment_source_ids: [],
        response_preferences: {
          language: /[฀-๿]/.test(formulateBrief) ? "th" : "en",
          detail: "detailed",
        },
      });
    } catch (error) {
      console.error("[formula-form] formulate brief persistence failed", error);
      set_formulate_error("The formula brief could not be saved. Please try again.");
    }
  };

  // When the run announces an artifact, fetch its validated payload and
  // populate the form exactly once per artifact id (review-first: the user
  // still edits and saves through the normal create flow).
  useEffect(() => {
    const announced_artifacts = agent_run.state.output?.artifacts
      ?? agent_run.state.artifacts;
    const artifact = announced_artifacts[announced_artifacts.length - 1];
    if (!artifact || applied_artifact_ref.current === artifact.artifact_id) return;
    let cancelled = false;
    const populate = async () => {
      try {
        set_artifact_error(null);
        console.log("[formula-form] fetching generated artifact", {
          artifact_id: artifact.artifact_id,
        });
        const response = await fetch(
          `/api/ai/artifacts/${encodeURIComponent(artifact.artifact_id)}`,
          { credentials: "include" },
        );
        if (!response.ok) throw new Error("Artifact fetch failed.");
        const body = await response.json();
        const form_state = formula_artifact_to_form_state(body.content);
        if (!form_state) throw new Error("Artifact payload is invalid.");
        if (cancelled) return;
        if (!productsData) {
          set_artifact_error("Checking your ingredient catalogue before filling the draft…");
          return;
        }
        const resolved_ingredients: FormulaIngredient[] = [];
        const unresolved_codes: string[] = [];
        for (const ingredient of form_state.ingredients) {
          const product = find_catalog_product(ingredient, products);
          if (!product) {
            unresolved_codes.push(ingredient.rm_code);
            continue;
          }
          resolved_ingredients.push({
            ...ingredient,
            materialId: String(product._id),
            rm_code: String(product.productCode || ingredient.rm_code),
            productName: String(product.productName || ingredient.productName),
            inci_name: String(product.inci_name || ingredient.inci_name),
          });
        }
        const unique_unresolved_codes = unresolved_codes
          .filter((code, index, codes) => codes.indexOf(code) === index);
        if (unique_unresolved_codes.length > 0) {
          applied_artifact_ref.current = artifact.artifact_id;
          set_artifact_error(
            `The agent proposed material code(s) not found in this catalogue: ${unique_unresolved_codes.join(", ")}. The form was not changed; add or correct the materials, then run Formulate again.`,
          );
          return;
        }
        applied_artifact_ref.current = artifact.artifact_id;
        setFormulaName(form_state.formulaName);
        setTargetBenefits([...form_state.targetBenefits]);
        setTotalAmount(form_state.totalAmount);
        setRemarks(form_state.remarks);
        setIngredients(resolved_ingredients);
        console.log("[formula-form] populated form from artifact", {
          artifact_id: artifact.artifact_id,
          ingredients: form_state.ingredients.length,
        });
      } catch {
        if (cancelled) return;
        console.error("[formula-form] artifact fetch failed");
        set_artifact_error("The generated formula could not be loaded. Please run Formulate again.");
      }
    };
    void populate();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent_run.state.artifacts, agent_run.state.output, productsData]);

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
          status,
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
          status,
        });
      }
    } catch (error) {
      console.error("[formula-form] submit error:", error);
    }
  };

  const filteredProducts = products.filter((p: any) => {
    const search_lower = ingredientSearch.toLocaleLowerCase();
    const matches_search = !search_lower || (
      p.productCode?.toLocaleLowerCase().includes(search_lower)
      || p.productName?.toLocaleLowerCase().includes(search_lower)
      || p.inci_name?.toLocaleLowerCase().includes(search_lower)
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

    return matches_search && matchesBenefit && matchesUseCase;
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
      {/* Formulate — governed agentic generation (spec §11.2) */}
      {!isEditMode && (
        <Surface variant="panel" className="p-6">
          <div className="flex flex-col gap-5">
            <div className="flex items-start gap-3">
              <IconTile tone="brand" className="size-11 rounded-2xl">
                <Sparkles className="h-5 w-5" />
              </IconTile>
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
                  Agentic Formula Planner
                  <span className="rounded-full border border-border bg-subtle px-2 py-0.5 text-xs font-medium text-muted">AI draft</span>
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">
                  Describe the product. The agent checks the knowledge base and fills a fully matched, editable draft for your review.
                </p>
              </div>
            </div>
            <Textarea
              value={formulateBrief}
              onChange={(e) => setFormulateBrief(e.target.value)}
              placeholder="Example: Create a light, fragrance-free niacinamide gel serum for oily skin, 100 g batch. Avoid alcohol and keep the texture non-sticky."
              rows={3}
              disabled={agent_run.is_starting || agent_run.is_streaming}
              className="min-h-[112px]"
              aria-describedby="formula-agent-help"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p id="formula-agent-help" className="max-w-xl text-xs leading-relaxed text-muted">
                Nothing is saved automatically. The agent only fills a complete catalogue-matched draft for you to review.
              </p>
              <Button
                type="button"
                onClick={handleFormulate}
                disabled={!formulateBrief.trim() || agent_run.is_starting || agent_run.is_streaming}
                className="h-10 px-5 text-sm"
              >
                {agent_run.is_starting || agent_run.is_streaming
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Wand2 className="h-4 w-4" />}
                {agent_run.is_starting || agent_run.is_streaming ? "Agent is planning..." : "Generate & auto-fill"}
              </Button>
            </div>
            {formulateStarted && (
              <div className="max-h-[50vh] overflow-y-auto rounded-2xl border border-border bg-subtle p-4">
                <AiRunView
                  state={agent_run.state}
                  client_error={agent_run.client_error}
                  is_streaming={agent_run.is_streaming}
                  is_resuming={agent_run.is_resuming}
                  is_manager={user?.role === "admin"}
                  on_clarification={agent_run.submit_clarification}
                  on_approval={agent_run.submit_approval}
                  on_cancel_stream={agent_run.cancel_stream}
                />
              </div>
            )}
            {applied_artifact_ref.current && !artifact_error && (
              <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-ink">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Formula draft filled from the validated agent artifact. Review and edit it before saving.
              </p>
            )}
            {artifact_error && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {artifact_error}
              </p>
            )}
            {formulate_error && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {formulate_error}
              </p>
            )}
          </div>
        </Surface>
      )}
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
                if (is_formula_status(e.target.value)) setStatus(e.target.value);
              }}
              className="w-full px-3 py-2 border rounded-md"
            >
              <option value="draft">Draft</option>
              <option value="testing">Testing</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
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
                  <DialogTitle>
                    {productsSearching
                      ? "กำลังค้นหาสาร..."
                      : `เลือกสาร (${filteredProducts?.length || 0} รายการ)`}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
                  {/* Search and Filters */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-3 h-4 w-4 text-muted" />
                      <Input
                        placeholder="ค้นหา รหัสสาร, ชื่อสาร, INCI Name..."
                        value={ingredientSearch}
                        onChange={(e) => setIngredientSearch(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                    <div>
                      <Select
                        value={filterByBenefit || "all"}
                        onValueChange={(value) => setFilterByBenefit(value === "all" ? "" : value)}
                      >
                        <SelectTrigger><SelectValue placeholder="ทุก Benefits" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">ทุก Benefits</SelectItem>
                          {allBenefits.map((benefit: any) => <SelectItem key={benefit} value={benefit}>{benefit}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Select
                        value={filterByUseCase || "all"}
                        onValueChange={(value) => setFilterByUseCase(value === "all" ? "" : value)}
                      >
                        <SelectTrigger><SelectValue placeholder="ทุก Use Cases" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">ทุก Use Cases</SelectItem>
                          {allUseCases.map((usecase: any) => <SelectItem key={usecase} value={usecase}>{usecase}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Results Table */}
                  <div className="flex-1 overflow-auto rounded-2xl border border-border">
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
                              <TableCell className="text-sm text-muted">
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
                                    <span className="text-xs text-muted">-</span>
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
                                    <span className="text-xs text-muted">-</span>
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
                            <TableCell colSpan={6} className="py-8 text-center text-muted">
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
                  <TableRow className="bg-subtle font-semibold">
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
            <div className="py-8 text-center text-muted">
              ยังไม่มีสารในสูตร กรุณาเพิ่มสาร
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={createFormula.isPending || updateFormula.isPending}
          className="h-10 px-5 text-sm"
        >
          {(createFormula.isPending || updateFormula.isPending)
            ? "กำลังบันทึก..."
            : isEditMode ? "บันทึกการแก้ไข" : "บันทึกสูตร"}
        </Button>
      </div>
    </form>
  );
}
