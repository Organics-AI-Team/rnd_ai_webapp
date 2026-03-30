"use client";

import { useAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import { Beaker, Search, Eye, Edit, Trash2, Sparkles, GitBranch } from "lucide-react";
import { useState } from "react";
import { FormulaComments } from "@/components/formula-comments";
import { Separator } from "@/components/ui/separator";
import { ConsolePageShell } from "@/components/console_page_shell";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/**
 * Formulas list page — Minimal data table with status, search, and detail dialog.
 */
export default function FormulasPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [searchTerm, setSearchTerm] = useState("");
  const [viewingFormula, setViewingFormula] = useState<any>(null);

  const { data: formulas, isLoading: formulasLoading } = trpc.formulas.list.useQuery();
  const deleteFormula = trpc.formulas.delete.useMutation({
    onSuccess: () => utils.formulas.list.invalidate(),
    onError: (error) => alert(error.message || "Delete failed"),
  });

  if (isLoading || formulasLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-gray-600"></div>
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

  /**
   * Handles formula deletion with confirmation.
   *
   * @param id   - Formula ID
   * @param name - Formula name for confirmation
   */
  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Delete "${name}"?`)) {
      try { await deleteFormula.mutateAsync({ id }); }
      catch (e: any) { console.error("[formulas] handleDelete — error", e); }
    }
  };

  /**
   * Returns status badge styling by status key.
   *
   * @param status - Formula status string
   * @returns Badge className
   */
  const status_style = (status: string) => ({
    draft: "text-gray-500 border-gray-200/80 bg-gray-50/50",
    testing: "text-amber-600 border-amber-200/80 bg-amber-50/50",
    approved: "text-emerald-600 border-emerald-200/80 bg-emerald-50/50",
    rejected: "text-red-500 border-red-200/80 bg-red-50/50",
  }[status] || "text-gray-500 border-gray-200/80");

  return (
    <ConsolePageShell
      title="Formulas"
      subtitle={`${filteredFormulas?.length || 0} formulas`}
      action_label="Add"
      on_action={() => router.push("/formulas/create")}
      show_action={user.role === "admin"}
    >
      {/* Search */}
      <div className="px-4 py-2 border-b border-gray-50 bg-[#fafafa]">
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-300" />
          <Input
            placeholder="Search code, name, client..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 h-8 text-[12px] border-gray-200/60 bg-white rounded-lg"
          />
        </div>
      </div>

      {/* Table */}
      {filteredFormulas && filteredFormulas.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow className="border-b border-gray-100/80">
              <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Code</TableHead>
              <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Name</TableHead>
              <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Ver</TableHead>
              <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Client</TableHead>
              <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Ingredients</TableHead>
              <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Benefits</TableHead>
              <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Status</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredFormulas.map((f: any) => (
              <TableRow key={f._id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <TableCell className="font-mono text-[11px] text-gray-400">{f.formulaCode}</TableCell>
                <TableCell className="text-[12px] font-medium text-gray-800">
                  <div className="flex items-center gap-1.5">
                    {f.formulaName}
                    {f.aiGenerated && <Sparkles className="h-3 w-3 text-violet-400" />}
                  </div>
                </TableCell>
                <TableCell><span className="text-[11px] text-gray-400">v{f.version}</span></TableCell>
                <TableCell className="text-[11px] text-gray-500">{f.client || "–"}</TableCell>
                <TableCell><span className="text-[11px] text-gray-500 tabular-nums">{f.ingredients?.length || 0}</span></TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-0.5">
                    {f.targetBenefits?.slice(0, 2).map((b: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0 font-normal text-gray-500 border-gray-200/80 bg-gray-50/50">{b}</Badge>
                    ))}
                    {f.targetBenefits?.length > 2 && <span className="text-[10px] text-gray-300">+{f.targetBenefits.length - 2}</span>}
                    {(!f.targetBenefits || f.targetBenefits.length === 0) && <span className="text-[10px] text-gray-300">–</span>}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-normal capitalize ${status_style(f.status)}`}>{f.status}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-0.5">
                    <Button size="sm" variant="ghost" onClick={() => setViewingFormula(f)} className="h-6 w-6 p-0 text-gray-300 hover:text-gray-500">
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    {user.role === "admin" && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => router.push(`/formulas/create?edit=${f._id}`)} className="h-6 w-6 p-0 text-gray-300 hover:text-gray-500">
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(f._id, f.formulaName)} className="h-6 w-6 p-0 text-gray-300 hover:text-red-500">
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

      {/* Detail Dialog */}
      <Dialog open={!!viewingFormula} onOpenChange={() => setViewingFormula(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-[13px] font-medium">Formula Details</DialogTitle>
          </DialogHeader>
          {viewingFormula && (
            <div className="space-y-4">
              {(viewingFormula.aiGenerated || viewingFormula.parentFormulaId) && (
                <div className="flex flex-wrap gap-2">
                  {viewingFormula.aiGenerated && (
                    <Badge variant="outline" className="text-[11px] font-normal text-violet-500 border-violet-200/80 bg-violet-50/50">
                      <Sparkles className="h-3 w-3 mr-1" /> AI Generated
                    </Badge>
                  )}
                  {viewingFormula.parentFormulaId && (
                    <Badge variant="outline" className="text-[11px] font-normal text-gray-500 border-gray-200/80">
                      <GitBranch className="h-3 w-3 mr-1" /> Derived
                    </Badge>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Code", value: viewingFormula.formulaCode, mono: true },
                  { label: "Name", value: viewingFormula.formulaName },
                  { label: "Version", value: `v${viewingFormula.version}` },
                  { label: "Client", value: viewingFormula.client || "–" },
                  { label: "Status", value: viewingFormula.status },
                  { label: "Batch Size", value: `${viewingFormula.totalAmount || 0} g/ml` },
                ].map((field, i) => (
                  <div key={i}>
                    <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wider">{field.label}</p>
                    {field.label === "Status" ? (
                      <Badge variant="outline" className={`text-[11px] font-normal capitalize ${status_style(field.value)}`}>{field.value}</Badge>
                    ) : (
                      <p className={`text-[13px] text-gray-800 ${field.mono ? 'font-mono' : ''}`}>{field.value}</p>
                    )}
                  </div>
                ))}
              </div>

              {viewingFormula.targetBenefits?.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-400 mb-1.5 uppercase tracking-wider">Target Benefits</p>
                  <div className="flex flex-wrap gap-1">
                    {viewingFormula.targetBenefits.map((b: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-[11px] font-normal text-gray-600 border-gray-200/80">{b}</Badge>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-[10px] text-gray-400 mb-1.5 uppercase tracking-wider">Ingredients ({viewingFormula.ingredients?.length || 0})</p>
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
                    {viewingFormula.ingredients?.map((ing: any, idx: number) => (
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

              {viewingFormula.remarks && (
                <div>
                  <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wider">Remarks</p>
                  <p className="text-[12px] text-gray-600 bg-gray-50 p-3 rounded-lg">{viewingFormula.remarks}</p>
                </div>
              )}

              {viewingFormula.generationPrompt && (
                <div>
                  <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wider">
                    <Sparkles className="h-3 w-3 inline mr-1" /> Generation Prompt
                  </p>
                  <p className="text-[12px] text-violet-600 bg-violet-50/50 p-3 rounded-lg">{viewingFormula.generationPrompt}</p>
                </div>
              )}

              <Separator />
              <FormulaComments formula_id={viewingFormula._id} user_name={user?.name} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </ConsolePageShell>
  );
}
