"use client";

import { useAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc-client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import { Beaker, ArrowLeft, Search, Plus, Edit, Trash2, Eye } from "lucide-react";
import { useState } from "react";
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
} from "@/components/ui/dialog";

/**
 * Formulas list page - Cloudflare-style data table
 *
 * Compact table with search, status badges, and detail dialogs.
 */
export default function FormulasPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const utils = trpc.useUtils();

  const [searchTerm, setSearchTerm] = useState("");
  const [viewingFormula, setViewingFormula] = useState<any>(null);

  const { data: formulas, isLoading: formulasLoading } = trpc.formulas.list.useQuery();

  const deleteFormula = trpc.formulas.delete.useMutation({
    onSuccess: () => {
      utils.formulas.list.invalidate();
    },
    onError: (error) => {
      alert(error.message || "Delete failed");
    },
  });

  if (isLoading || formulasLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-900 border-t-transparent mx-auto"></div>
          <p className="mt-3 text-xs text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="max-w-sm">
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-sm font-medium text-gray-900 mb-2">Sign in required</p>
              <p className="text-xs text-gray-500 mb-3">You need to be authenticated to view this page.</p>
              <Button onClick={() => router.push("/login")} size="sm">Sign in</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const filteredFormulas = formulas?.filter((formula: any) => {
    const searchLower = searchTerm.toLowerCase();
    return (
      formula.formulaCode?.toLowerCase().includes(searchLower) ||
      formula.formulaName?.toLowerCase().includes(searchLower) ||
      formula.client?.toLowerCase().includes(searchLower)
    );
  });

  /**
   * Handles formula deletion with confirmation
   *
   * @param id - Formula ID
   * @param name - Formula name for confirmation
   */
  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Delete "${name}"?`)) {
      try {
        await deleteFormula.mutateAsync({ id });
      } catch (error: any) {
        console.error("Error deleting formula:", error);
      }
    }
  };

  /**
   * Returns status badge with consistent styling
   *
   * @param status - Formula status string
   * @returns Badge JSX element
   */
  const getStatusBadge = (status: string) => {
    const statusMap: any = {
      draft: { label: "Draft", className: "bg-gray-50 text-gray-600 border-gray-200" },
      testing: { label: "Testing", className: "bg-amber-50 text-amber-700 border-amber-200" },
      approved: { label: "Approved", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
      rejected: { label: "Rejected", className: "bg-red-50 text-red-700 border-red-200" },
    };

    const statusInfo = statusMap[status] || statusMap.draft;
    return <Badge variant="outline" className={statusInfo.className}>{statusInfo.label}</Badge>;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
      {/* Header */}
      <div className="mb-4">
        <Button variant="ghost" onClick={() => router.back()} size="sm" className="mb-2 -ml-2">
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Back
        </Button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Formulas</h1>
            <p className="text-xs text-gray-500">Manage product formulas</p>
          </div>
          {user.role === "admin" && (
            <Button onClick={() => router.push("/formulas/create")} size="sm">
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add
            </Button>
          )}
        </div>
      </div>

      {/* Table Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Formula List</CardTitle>
              <CardDescription>
                {filteredFormulas?.length || 0} formulas
              </CardDescription>
            </div>
          </div>

          {/* Search */}
          <div className="mt-3">
            <div className="relative max-w-sm">
              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-gray-500" />
              <Input
                placeholder="Search code, name, client..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-7"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredFormulas && filteredFormulas.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Ver</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Ingredients</TableHead>
                  <TableHead>Benefits</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredFormulas.map((formula: any) => (
                  <TableRow key={formula._id}>
                    <TableCell className="font-mono text-xs text-gray-500">
                      {formula.formulaCode}
                    </TableCell>
                    <TableCell className="font-medium text-sm">
                      {formula.formulaName}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">v{formula.version}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {formula.client || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {formula.ingredients?.length || 0}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-0.5">
                        {formula.targetBenefits && formula.targetBenefits.length > 0 ? (
                          formula.targetBenefits.slice(0, 2).map((benefit: string, idx: number) => (
                            <Badge key={idx} variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">{benefit}</Badge>
                          ))
                        ) : (
                          <span className="text-2xs text-gray-500">-</span>
                        )}
                        {formula.targetBenefits && formula.targetBenefits.length > 2 && (
                          <Badge variant="outline">+{formula.targetBenefits.length - 2}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(formula.status)}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-0.5">
                        <Button size="sm" variant="ghost" onClick={() => setViewingFormula(formula)} className="h-7 w-7 p-0">
                          <Eye className="h-3.5 w-3.5 text-blue-600" />
                        </Button>
                        {user.role === "admin" && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => router.push(`/formulas/create?edit=${formula._id}`)} className="h-7 w-7 p-0">
                              <Edit className="h-3.5 w-3.5 text-emerald-600" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => handleDelete(formula._id, formula.formulaName)} className="h-7 w-7 p-0">
                              <Trash2 className="h-3.5 w-3.5 text-red-600" />
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
            <div className="text-center py-8">
              <Beaker className="h-8 w-8 text-gray-500/30 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No formulas found</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!viewingFormula} onOpenChange={() => setViewingFormula(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">Formula Details</DialogTitle>
          </DialogHeader>
          {viewingFormula && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Code", value: viewingFormula.formulaCode, mono: true },
                  { label: "Name", value: viewingFormula.formulaName },
                  { label: "Version", value: `v${viewingFormula.version}` },
                  { label: "Client", value: viewingFormula.client || "-" },
                  { label: "Status", value: viewingFormula.status, badge: true },
                  { label: "Batch Size", value: `${viewingFormula.totalAmount || 0} g/ml` },
                ].map((field, i) => (
                  <div key={i}>
                    <p className="text-2xs text-gray-500 mb-0.5">{field.label}</p>
                    {field.badge ? (
                      <div className="mt-0.5">{getStatusBadge(field.value)}</div>
                    ) : (
                      <p className={`text-sm font-medium ${field.mono ? 'font-mono' : ''}`}>{field.value}</p>
                    )}
                  </div>
                ))}
              </div>

              {viewingFormula.targetBenefits && viewingFormula.targetBenefits.length > 0 && (
                <div>
                  <p className="text-2xs text-gray-500 mb-1.5">Target Benefits</p>
                  <div className="flex flex-wrap gap-1">
                    {viewingFormula.targetBenefits.map((benefit: string, idx: number) => (
                      <Badge key={idx} variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">{benefit}</Badge>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-2xs text-gray-500 mb-1.5">
                  Ingredients ({viewingFormula.ingredients?.length || 0})
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>%</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {viewingFormula.ingredients?.map((ing: any, idx: number) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-xs">{ing.rm_code}</TableCell>
                        <TableCell className="text-sm">{ing.productName}</TableCell>
                        <TableCell className="text-xs">{ing.amount}</TableCell>
                        <TableCell className="text-xs">{ing.percentage?.toFixed(2) || 0}%</TableCell>
                        <TableCell className="text-xs text-gray-500">{ing.notes || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {viewingFormula.remarks && (
                <div>
                  <p className="text-2xs text-gray-500 mb-1">Remarks</p>
                  <p className="text-xs bg-gray-50 p-2.5 rounded-md">{viewingFormula.remarks}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
