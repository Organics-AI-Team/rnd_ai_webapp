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
import React from "react";
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
      alert("ลบสูตรเรียบร้อยแล้ว!");
    },
    onError: (error) => {
      alert(error.message || "ไม่สามารถลบสูตรได้");
    },
  });

  if (isLoading || formulasLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Card className="max-w-md">
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-red-600 font-semibold mb-4">กรุณาเข้าสู่ระบบ</p>
              <p className="text-gray-600 mb-4">
                คุณต้องเข้าสู่ระบบก่อนเข้าใช้งานหน้านี้
              </p>
              <Button onClick={() => router.push("/login")}>
                ไปหน้าเข้าสู่ระบบ
              </Button>
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

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`คุณแน่ใจหรือไม่ที่จะลบสูตร "${name}"?`)) {
      try {
        await deleteFormula.mutateAsync({ id });
      } catch (error: any) {
        console.error("Error deleting formula:", error);
      }
    }
  };

  const getStatusBadge = (status: string) => {
    const statusMap: any = {
      draft: { label: "Draft", className: "bg-gray-100 text-gray-800" },
      testing: { label: "Testing", className: "bg-yellow-100 text-yellow-800" },
      approved: { label: "Approved", className: "bg-green-100 text-green-800" },
      rejected: { label: "Rejected", className: "bg-red-100 text-red-800" },
    };

    const statusInfo = statusMap[status] || statusMap.draft;

    return (
      <Badge variant="secondary" className={statusInfo.className}>
        {statusInfo.label}
      </Badge>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Button
            variant="ghost"
            onClick={() => router.back()}
            className="mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            ย้อนกลับ
          </Button>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-600 rounded-lg">
                <Beaker className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">
                  สูตรทั้งหมด
                </h1>
                <p className="text-gray-600">
                  จัดการและดูสูตรผลิตภัณฑ์
                </p>
              </div>
            </div>

            {user.role === "admin" && (
              <Button
                onClick={() => router.push("/admin/formulas")}
                className="bg-purple-600 hover:bg-purple-700"
              >
                <Plus className="h-4 w-4 mr-2" />
                เพิ่มสูตรใหม่
              </Button>
            )}
          </div>
        </div>

        {/* Formulas List */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>รายการสูตร</CardTitle>
                <CardDescription>
                  แสดง {filteredFormulas?.length || 0} สูตร
                </CardDescription>
              </div>
            </div>

            {/* Search */}
            <div className="mt-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="ค้นหา รหัสสูตร, ชื่อสูตร, ลูกค้า..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filteredFormulas && filteredFormulas.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>รหัสสูตร</TableHead>
                    <TableHead>ชื่อสูตร</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>สารทั้งหมด</TableHead>
                    <TableHead>Target Benefits</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredFormulas.map((formula: any) => (
                    <TableRow key={formula._id}>
                      <TableCell className="font-mono text-sm">
                        {formula.formulaCode}
                      </TableCell>
                      <TableCell className="font-medium">
                        {formula.formulaName}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">v{formula.version}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {formula.client || "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {formula.ingredients?.length || 0} ชนิด
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {formula.targetBenefits && formula.targetBenefits.length > 0 ? (
                            formula.targetBenefits.slice(0, 2).map((benefit: string, idx: number) => (
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
                          {formula.targetBenefits && formula.targetBenefits.length > 2 && (
                            <Badge variant="outline" className="text-xs">
                              +{formula.targetBenefits.length - 2}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(formula.status)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setViewingFormula(formula)}
                            title="ดูรายละเอียด"
                          >
                            <Eye className="h-4 w-4 text-blue-600" />
                          </Button>
                          {user.role === "admin" && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => router.push(`/admin/formulas?edit=${formula._id}`)}
                                title="แก้ไข"
                              >
                                <Edit className="h-4 w-4 text-green-600" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDelete(formula._id, formula.formulaName)}
                                title="ลบ"
                              >
                                <Trash2 className="h-4 w-4 text-red-600" />
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
              <div className="text-center py-12">
                <Beaker className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 mb-2">ยังไม่มีสูตร</p>
                {user.role === "admin" && (
                  <p className="text-sm text-gray-500">
                    คลิก &quot;เพิ่มสูตรใหม่&quot; เพื่อสร้างสูตร
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* View Formula Dialog */}
        <Dialog open={!!viewingFormula} onOpenChange={() => setViewingFormula(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>รายละเอียดสูตร</DialogTitle>
            </DialogHeader>
            {viewingFormula && (
              <div className="space-y-6">
                {/* Formula Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">รหัสสูตร</p>
                    <p className="font-mono font-semibold">{viewingFormula.formulaCode}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">ชื่อสูตร</p>
                    <p className="font-semibold">{viewingFormula.formulaName}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Version</p>
                    <p className="font-semibold">v{viewingFormula.version}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Client</p>
                    <p className="font-semibold">{viewingFormula.client || "-"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Status</p>
                    <div className="mt-1">{getStatusBadge(viewingFormula.status)}</div>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Total Batch Size</p>
                    <p className="font-semibold">{viewingFormula.totalAmount || 0} g/ml</p>
                  </div>
                </div>

                {/* Target Benefits */}
                {viewingFormula.targetBenefits && viewingFormula.targetBenefits.length > 0 && (
                  <div>
                    <p className="text-sm text-gray-600 mb-2">Target Benefits</p>
                    <div className="flex flex-wrap gap-2">
                      {viewingFormula.targetBenefits.map((benefit: string, idx: number) => (
                        <Badge
                          key={idx}
                          variant="secondary"
                          className="bg-blue-100 text-blue-800"
                        >
                          {benefit}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Ingredients */}
                <div>
                  <p className="text-sm text-gray-600 mb-2">สารในสูตร ({viewingFormula.ingredients?.length || 0} ชนิด)</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>รหัสสาร</TableHead>
                        <TableHead>ชื่อสาร</TableHead>
                        <TableHead>Amount (g/ml)</TableHead>
                        <TableHead>%</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {viewingFormula.ingredients?.map((ing: any, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell className="font-mono text-sm">{ing.rm_code}</TableCell>
                          <TableCell>{ing.productName}</TableCell>
                          <TableCell>{ing.amount}</TableCell>
                          <TableCell>{ing.percentage?.toFixed(2) || 0}%</TableCell>
                          <TableCell className="text-sm text-gray-600">{ing.notes || "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Remarks */}
                {viewingFormula.remarks && (
                  <div>
                    <p className="text-sm text-gray-600 mb-2">Remarks</p>
                    <p className="text-sm bg-gray-50 p-3 rounded-lg">{viewingFormula.remarks}</p>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
