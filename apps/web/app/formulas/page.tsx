"use client";

/**
 * FormulasPage — Data table with slide-over panel for view/edit.
 * Panel takes 70% of screen width and supports both view and edit modes.
 * Includes AI suggest button for generating formula from a brief.
 *
 * @author AI Management System
 * @date 2026-03-30
 */

import { useAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import {
  Beaker, Search, Eye, Edit, Trash2, Sparkles, GitBranch, CheckCircle,
  X, Plus, Save, Wand2,
} from "lucide-react";
import { useState, useEffect } from "react";
import { FormulaComments } from "@/components/formula-comments";
import { FormulaVersionHistory } from "@/components/formula-version-history";
import { Separator } from "@/components/ui/separator";
import { ConsolePageShell } from "@/components/console_page_shell";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PanelMode = "view" | "edit" | null;

interface EditableIngredient {
  materialId: string;
  rm_code: string;
  productName: string;
  inci_name?: string;
  amount: number;
  percentage?: number;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FormulasPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const utils = trpc.useUtils();

  // --- State ---
  const [searchTerm, setSearchTerm] = useState("");
  const [panelFormula, setPanelFormula] = useState<any>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>(null);

  // Edit state
  const [editName, setEditName] = useState("");
  const [editClient, setEditClient] = useState("");
  const [editBenefits, setEditBenefits] = useState<string[]>([]);
  const [editBenefitInput, setEditBenefitInput] = useState("");
  const [editIngredients, setEditIngredients] = useState<EditableIngredient[]>([]);
  const [editTotalAmount, setEditTotalAmount] = useState(100);
  const [editRemarks, setEditRemarks] = useState("");
  const [editStatus, setEditStatus] = useState("draft");

  // AI suggest state
  const [showAiSuggest, setShowAiSuggest] = useState(false);
  const [aiBrief, setAiBrief] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  // --- Queries & Mutations ---
  const { data: formulas, isLoading: formulasLoading } = trpc.formulas.list.useQuery();
  const deleteFormula = trpc.formulas.delete.useMutation({
    onSuccess: () => utils.formulas.list.invalidate(),
    onError: (error) => alert(error.message || "Delete failed"),
  });
  const confirmFormula = trpc.formulas.confirm.useMutation({
    onSuccess: (data) => {
      utils.formulas.list.invalidate();
      if (panelFormula) {
        setPanelFormula({ ...panelFormula, status: "confirmed", version: data.version });
      }
    },
    onError: (error) => alert(error.message || "Confirm failed"),
  });
  const updateFormula = trpc.formulas.update.useMutation({
    onSuccess: () => {
      console.log("[formulas] updateFormula — success");
      utils.formulas.list.invalidate();
      // Refresh panel formula
      if (panelFormula) {
        setPanelFormula({
          ...panelFormula,
          formulaName: editName,
          client: editClient,
          targetBenefits: editBenefits,
          ingredients: editIngredients,
          totalAmount: editTotalAmount,
          remarks: editRemarks,
          status: editStatus,
        });
      }
      setPanelMode("view");
    },
    onError: (error) => alert(error.message || "Update failed"),
  });

  // --- Helpers ---

  /**
   * Open slide-over panel in the given mode.
   *
   * @param formula - Formula data to display
   * @param mode    - "view" or "edit"
   */
  const openPanel = (formula: any, mode: PanelMode) => {
    console.log("[formulas] openPanel", { id: formula._id, mode });
    setPanelFormula(formula);
    setPanelMode(mode);
    if (mode === "edit") {
      populateEditFields(formula);
    }
  };

  /**
   * Close the slide-over panel.
   */
  const closePanel = () => {
    setPanelFormula(null);
    setPanelMode(null);
  };

  /**
   * Populate edit form fields from a formula object.
   *
   * @param formula - Formula data
   */
  const populateEditFields = (formula: any) => {
    setEditName(formula.formulaName || "");
    setEditClient(formula.client || "");
    setEditBenefits(formula.targetBenefits || []);
    setEditIngredients(
      (formula.ingredients || []).map((ing: any) => ({
        materialId: ing.materialId || "",
        rm_code: ing.rm_code || "",
        productName: ing.productName || "",
        inci_name: ing.inci_name || "",
        amount: ing.amount || 0,
        percentage: ing.percentage || 0,
        notes: ing.notes || "",
      }))
    );
    setEditTotalAmount(formula.totalAmount || 100);
    setEditRemarks(formula.remarks || "");
    setEditStatus(formula.status || "draft");
  };

  /**
   * Save edited formula.
   */
  const handleSaveEdit = async () => {
    if (!panelFormula) return;
    console.log("[formulas] handleSaveEdit", { id: panelFormula._id });
    await updateFormula.mutateAsync({
      id: panelFormula._id,
      formulaName: editName,
      client: editClient,
      targetBenefits: editBenefits,
      ingredients: editIngredients.map((ing) => ({
        ...ing,
        amount: Number(ing.amount),
        percentage: ing.percentage ? Number(ing.percentage) : undefined,
      })),
      totalAmount: editTotalAmount,
      remarks: editRemarks,
      status: editStatus as any,
    });
  };

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Delete "${name}"?`)) {
      try { await deleteFormula.mutateAsync({ id }); }
      catch (e: any) { console.error("[formulas] handleDelete — error", e); }
      if (panelFormula?._id === id) closePanel();
    }
  };

  const handleConfirm = async (id: string, name: string) => {
    console.log("[formulas] handleConfirm", { id, name });
    const remarks = prompt(`Confirm "${name}" as next version?\n\nOptional remarks:`);
    if (remarks !== null) {
      try { await confirmFormula.mutateAsync({ id, remarks: remarks || undefined }); }
      catch (e: any) { console.error("[formulas] handleConfirm — error", e); }
    }
  };

  /**
   * Call AI to generate formula from a brief, then auto-open
   * the newly created draft in the slide-over panel.
   *
   * @remarks Posts to /api/ai/raw-materials-agent which triggers
   *          the ReAct agent's generate_formula tool, persisting
   *          the draft to MongoDB. After success we refetch the
   *          list and open the first (newest) draft.
   */
  const handleAiSuggest = async () => {
    if (!aiBrief.trim()) return;
    console.log("[formulas] handleAiSuggest — start", { brief: aiBrief });
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai/raw-materials-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Generate a formula for: ${aiBrief}. Return only the formula data.`,
          organizationId: user?.organizationId,
          userId: user?.id,
          conversationHistory: [],
        }),
      });
      const data = await res.json();
      console.log("[formulas] handleAiSuggest — response received", { success: data.success });

      // Close modal and reset
      setShowAiSuggest(false);
      setAiBrief("");

      // Refetch list then auto-open the newest draft in the panel
      const refreshed = await utils.formulas.list.fetch();
      if (refreshed && refreshed.length > 0) {
        const newest_draft = refreshed.find((f: any) => f.status === "draft" && f.aiGenerated);
        const target = newest_draft || refreshed[0];
        console.log("[formulas] handleAiSuggest — auto-opening formula", { id: target._id });
        openPanel(target, "view");
      }
    } catch (error) {
      console.error("[formulas] handleAiSuggest — error", error);
      alert("Failed to generate formula. Please try again.");
    } finally {
      setAiLoading(false);
    }
  };

  const status_style = (status: string) => ({
    draft: "text-gray-500 border-gray-200/80 bg-gray-50/50",
    confirmed: "text-blue-600 border-blue-200/80 bg-blue-50/50",
    testing: "text-amber-600 border-amber-200/80 bg-amber-50/50",
    approved: "text-emerald-600 border-emerald-200/80 bg-emerald-50/50",
    rejected: "text-red-500 border-red-200/80 bg-red-50/50",
  }[status] || "text-gray-500 border-gray-200/80");

  // --- Loading / Auth guards ---
  if (isLoading || formulasLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-gray-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-sm text-gray-500">Sign in required</p>
      </div>
    );
  }

  const filteredFormulas = formulas?.filter((f: any) => {
    const s = searchTerm.toLowerCase();
    return f.formulaCode?.toLowerCase().includes(s) || f.formulaName?.toLowerCase().includes(s) || f.client?.toLowerCase().includes(s);
  });

  const isPanelOpen = !!panelFormula && !!panelMode;

  return (
    <ConsolePageShell
      title="Formulas"
      subtitle={`${filteredFormulas?.length || 0} formulas`}
      action_label={user.role === "admin" ? "Add" : undefined}
      on_action={user.role === "admin" ? () => router.push("/formulas/create") : undefined}
      show_action={user.role === "admin"}
    >
      {/* Search + AI Suggest */}
      <div className="px-4 py-2 border-b border-gray-50 bg-[#fafafa] flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-300" />
          <Input
            placeholder="Search code, name, client..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 h-8 text-[12px] border-gray-200/60 bg-white rounded-lg"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowAiSuggest(true)}
          className="h-8 text-[11px] gap-1.5 border-violet-200/80 text-violet-600 hover:bg-violet-50/50"
        >
          <Wand2 className="h-3.5 w-3.5" />
          AI Suggest
        </Button>
      </div>

      {/* Table */}
      <div className={`transition-all duration-200 ${isPanelOpen ? "mr-[70vw]" : ""}`}>
        {filteredFormulas && filteredFormulas.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-100/80">
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Code</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Name</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Ver</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Status</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredFormulas.map((f: any) => (
                <TableRow
                  key={f._id}
                  className={`border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer ${panelFormula?._id === f._id ? "bg-blue-50/50" : ""}`}
                  onClick={() => openPanel(f, "view")}
                >
                  <TableCell className="font-mono text-[11px] text-gray-400">{f.formulaCode}</TableCell>
                  <TableCell className="text-[12px] font-medium text-gray-800">
                    <div className="flex items-center gap-1.5">
                      {f.formulaName}
                      {f.aiGenerated && <Sparkles className="h-3 w-3 text-violet-400" />}
                    </div>
                  </TableCell>
                  <TableCell><span className="text-[11px] text-gray-400 font-mono">v{String(f.version || 0).padStart(2, "0")}</span></TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-normal capitalize ${status_style(f.status)}`}>{f.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-0.5" onClick={(e) => e.stopPropagation()}>
                      {f.status === "draft" && (
                        <Button size="sm" variant="ghost" onClick={() => handleConfirm(f._id, f.formulaName)} className="h-6 w-6 p-0 text-gray-300 hover:text-emerald-500" title="Confirm">
                          <CheckCircle className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {user.role === "admin" && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => openPanel(f, "edit")} className="h-6 w-6 p-0 text-gray-300 hover:text-gray-500" title="Edit">
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDelete(f._id, f.formulaName)} className="h-6 w-6 p-0 text-gray-300 hover:text-red-500" title="Delete">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-16">
            <Beaker className="h-8 w-8 text-gray-200 mx-auto mb-2" />
            <p className="text-[12px] text-gray-400">No formulas found</p>
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* Slide-over Panel — 70% width */}
      {/* ============================================================ */}
      {isPanelOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/20 z-40" onClick={closePanel} />

          {/* Panel */}
          <div className="fixed inset-y-0 right-0 w-[70vw] bg-white shadow-xl z-50 flex flex-col border-l border-gray-200 animate-in slide-in-from-right duration-200">
            {/* Panel Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-[#fafafa]">
              <div className="flex items-center gap-3">
                <span className="font-mono text-[11px] text-gray-400">{panelFormula.formulaCode}</span>
                <span className="text-[13px] font-medium text-gray-800">{panelFormula.formulaName}</span>
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-normal capitalize ${status_style(panelFormula.status)}`}>
                  {panelFormula.status}
                </Badge>
                <span className="text-[11px] text-gray-400 font-mono">v{String(panelFormula.version || 0).padStart(2, "0")}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {panelMode === "view" && user.role === "admin" && (
                  <Button size="sm" variant="outline" onClick={() => { setPanelMode("edit"); populateEditFields(panelFormula); }} className="h-7 text-[11px] gap-1">
                    <Edit className="h-3 w-3" /> Edit
                  </Button>
                )}
                {panelMode === "edit" && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setPanelMode("view")} className="h-7 text-[11px] text-gray-500">
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleSaveEdit} disabled={updateFormula.isPending} className="h-7 text-[11px] gap-1 bg-gray-900 hover:bg-gray-800 text-white">
                      <Save className="h-3 w-3" /> {updateFormula.isPending ? "Saving..." : "Save"}
                    </Button>
                  </>
                )}
                <Button size="sm" variant="ghost" onClick={closePanel} className="h-7 w-7 p-0 text-gray-400 hover:text-gray-600">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Panel Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {panelMode === "view" ? (
                /* ====== VIEW MODE ====== */
                <>
                  {(panelFormula.aiGenerated || panelFormula.parentFormulaId) && (
                    <div className="flex flex-wrap gap-2">
                      {panelFormula.aiGenerated && (
                        <Badge variant="outline" className="text-[11px] font-normal text-violet-500 border-violet-200/80 bg-violet-50/50">
                          <Sparkles className="h-3 w-3 mr-1" /> AI Generated
                        </Badge>
                      )}
                      {panelFormula.parentFormulaId && (
                        <Badge variant="outline" className="text-[11px] font-normal text-gray-500 border-gray-200/80">
                          <GitBranch className="h-3 w-3 mr-1" /> Derived
                        </Badge>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Code", value: panelFormula.formulaCode, mono: true },
                      { label: "Name", value: panelFormula.formulaName },
                      { label: "Version", value: `v${String(panelFormula.version || 0).padStart(2, "0")}` },
                      { label: "Client", value: panelFormula.client || "–" },
                      { label: "Status", value: panelFormula.status },
                      { label: "Batch Size", value: `${panelFormula.totalAmount || 0} g/ml` },
                    ].map((field, i) => (
                      <div key={i}>
                        <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wider">{field.label}</p>
                        {field.label === "Status" ? (
                          <Badge variant="outline" className={`text-[11px] font-normal capitalize ${status_style(field.value)}`}>{field.value}</Badge>
                        ) : (
                          <p className={`text-[13px] text-gray-800 ${field.mono ? "font-mono" : ""}`}>{field.value}</p>
                        )}
                      </div>
                    ))}
                  </div>

                  {panelFormula.targetBenefits?.length > 0 && (
                    <div>
                      <p className="text-[10px] text-gray-400 mb-1.5 uppercase tracking-wider">Target Benefits</p>
                      <div className="flex flex-wrap gap-1">
                        {panelFormula.targetBenefits.map((b: string, i: number) => (
                          <Badge key={i} variant="outline" className="text-[11px] font-normal text-gray-600 border-gray-200/80">{b}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="text-[10px] text-gray-400 mb-1.5 uppercase tracking-wider">Ingredients ({panelFormula.ingredients?.length || 0})</p>
                    <Table>
                      <TableHeader>
                        <TableRow className="border-b border-gray-100/80">
                          <TableHead className="text-[10px] text-gray-400 uppercase">Code</TableHead>
                          <TableHead className="text-[10px] text-gray-400 uppercase">Name</TableHead>
                          <TableHead className="text-[10px] text-gray-400 uppercase">Amount</TableHead>
                          <TableHead className="text-[10px] text-gray-400 uppercase">%</TableHead>
                          <TableHead className="text-[10px] text-gray-400 uppercase">Notes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {panelFormula.ingredients?.map((ing: any, idx: number) => (
                          <TableRow key={idx} className="border-b border-gray-50">
                            <TableCell className="font-mono text-[11px] text-gray-400">{ing.rm_code}</TableCell>
                            <TableCell className="text-[12px] text-gray-800">{ing.productName}</TableCell>
                            <TableCell className="text-[11px] text-gray-500 tabular-nums">{ing.amount}</TableCell>
                            <TableCell className="text-[11px] text-gray-500 tabular-nums">{ing.percentage?.toFixed(2) || 0}%</TableCell>
                            <TableCell className="text-[11px] text-gray-400">{ing.notes || "–"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {panelFormula.remarks && (
                    <div>
                      <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wider">Remarks</p>
                      <p className="text-[12px] text-gray-600 bg-gray-50 p-3 rounded-lg">{panelFormula.remarks}</p>
                    </div>
                  )}

                  {panelFormula.generationPrompt && (
                    <div>
                      <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wider">
                        <Sparkles className="h-3 w-3 inline mr-1" /> Generation Prompt
                      </p>
                      <p className="text-[12px] text-violet-600 bg-violet-50/50 p-3 rounded-lg">{panelFormula.generationPrompt}</p>
                    </div>
                  )}

                  {/* Confirm button for drafts */}
                  {panelFormula.status === "draft" && (
                    <div className="flex items-center gap-2 p-3 bg-amber-50/50 border border-amber-200/60 rounded-lg">
                      <div className="flex-1">
                        <p className="text-[12px] font-medium text-amber-700">This formula is a draft</p>
                        <p className="text-[11px] text-amber-500">Confirm to create an official version (v{String((panelFormula.version || 0) + 1).padStart(2, "0")})</p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleConfirm(panelFormula._id, panelFormula.formulaName)}
                        disabled={confirmFormula.isPending}
                        className="h-7 px-3 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg"
                      >
                        <CheckCircle className="h-3 w-3 mr-1" />
                        {confirmFormula.isPending ? "Confirming..." : "Confirm"}
                      </Button>
                    </div>
                  )}

                  <Separator />
                  <FormulaVersionHistory formula_id={panelFormula._id} />
                  <Separator />
                  <FormulaComments formula_id={panelFormula._id} version={panelFormula.version || 0} user_name={user?.name} />
                </>
              ) : (
                /* ====== EDIT MODE ====== */
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-[11px] text-gray-500">Formula Name</Label>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8 text-[12px] mt-1" />
                    </div>
                    <div>
                      <Label className="text-[11px] text-gray-500">Client</Label>
                      <Input value={editClient} onChange={(e) => setEditClient(e.target.value)} className="h-8 text-[12px] mt-1" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-[11px] text-gray-500">Batch Size (g/ml)</Label>
                      <Input type="number" value={editTotalAmount} onChange={(e) => setEditTotalAmount(parseFloat(e.target.value) || 100)} className="h-8 text-[12px] mt-1" />
                    </div>
                    <div>
                      <Label className="text-[11px] text-gray-500">Status</Label>
                      <select
                        value={editStatus}
                        onChange={(e) => setEditStatus(e.target.value)}
                        className="w-full h-8 px-2 mt-1 text-[12px] border border-gray-200 rounded-lg bg-white"
                      >
                        <option value="draft">Draft</option>
                        <option value="confirmed">Confirmed</option>
                        <option value="testing">Testing</option>
                        <option value="approved">Approved</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    </div>
                  </div>

                  {/* Target Benefits */}
                  <div>
                    <Label className="text-[11px] text-gray-500">Target Benefits</Label>
                    <div className="flex gap-1.5 mt-1">
                      <Input
                        placeholder="Add benefit..."
                        value={editBenefitInput}
                        onChange={(e) => setEditBenefitInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (editBenefitInput.trim()) {
                              setEditBenefits([...editBenefits, editBenefitInput.trim()]);
                              setEditBenefitInput("");
                            }
                          }
                        }}
                        className="h-8 text-[12px]"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (editBenefitInput.trim()) {
                            setEditBenefits([...editBenefits, editBenefitInput.trim()]);
                            setEditBenefitInput("");
                          }
                        }}
                        className="h-8 w-8 p-0"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {editBenefits.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {editBenefits.map((b, i) => (
                          <Badge
                            key={i}
                            variant="outline"
                            className="text-[10px] cursor-pointer hover:bg-red-50 hover:text-red-500 hover:border-red-200"
                            onClick={() => setEditBenefits(editBenefits.filter((_, idx) => idx !== i))}
                          >
                            {b} ×
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Ingredients */}
                  <div>
                    <p className="text-[10px] text-gray-400 mb-1.5 uppercase tracking-wider">
                      Ingredients ({editIngredients.length})
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow className="border-b border-gray-100/80">
                          <TableHead className="text-[10px] text-gray-400 uppercase">Code</TableHead>
                          <TableHead className="text-[10px] text-gray-400 uppercase">Name</TableHead>
                          <TableHead className="text-[10px] text-gray-400 uppercase w-20">Amount</TableHead>
                          <TableHead className="text-[10px] text-gray-400 uppercase w-20">%</TableHead>
                          <TableHead className="text-[10px] text-gray-400 uppercase">Notes</TableHead>
                          <TableHead className="w-8"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {editIngredients.map((ing, idx) => (
                          <TableRow key={idx} className="border-b border-gray-50">
                            <TableCell className="font-mono text-[11px] text-gray-400">{ing.rm_code}</TableCell>
                            <TableCell className="text-[12px] text-gray-800">{ing.productName}</TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                value={ing.amount}
                                onChange={(e) => {
                                  const updated = [...editIngredients];
                                  updated[idx] = { ...updated[idx], amount: parseFloat(e.target.value) || 0 };
                                  if (editTotalAmount > 0) {
                                    updated[idx].percentage = (updated[idx].amount / editTotalAmount) * 100;
                                  }
                                  setEditIngredients(updated);
                                }}
                                className="h-7 text-[11px] w-20"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                value={ing.percentage?.toFixed(2) || 0}
                                onChange={(e) => {
                                  const updated = [...editIngredients];
                                  updated[idx] = { ...updated[idx], percentage: parseFloat(e.target.value) || 0 };
                                  setEditIngredients(updated);
                                }}
                                className="h-7 text-[11px] w-20"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={ing.notes || ""}
                                onChange={(e) => {
                                  const updated = [...editIngredients];
                                  updated[idx] = { ...updated[idx], notes: e.target.value };
                                  setEditIngredients(updated);
                                }}
                                className="h-7 text-[11px]"
                              />
                            </TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditIngredients(editIngredients.filter((_, i) => i !== idx))}
                                className="h-6 w-6 p-0 text-gray-300 hover:text-red-500"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Remarks */}
                  <div>
                    <Label className="text-[11px] text-gray-500">Remarks</Label>
                    <Textarea value={editRemarks} onChange={(e) => setEditRemarks(e.target.value)} className="text-[12px] mt-1 min-h-[60px]" />
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ============================================================ */}
      {/* AI Suggest Modal */}
      {/* ============================================================ */}
      <Dialog open={showAiSuggest} onOpenChange={setShowAiSuggest}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[13px] font-medium flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-violet-500" />
              AI Formula Suggest
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-[12px] text-gray-500">
              Describe what you want and AI will generate a complete formula as a draft.
            </p>
            <Textarea
              placeholder="e.g. Anti-aging serum with retinol and vitamin C for mature skin, budget ≤500 THB/kg"
              value={aiBrief}
              onChange={(e) => setAiBrief(e.target.value)}
              className="min-h-[100px] text-[12px]"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setShowAiSuggest(false)} className="h-8 text-[12px]">
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleAiSuggest}
                disabled={!aiBrief.trim() || aiLoading}
                className="h-8 text-[12px] gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
              >
                {aiLoading ? (
                  <div className="animate-spin rounded-full h-3 w-3 border border-white border-t-transparent" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {aiLoading ? "Generating..." : "Generate"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </ConsolePageShell>
  );
}
