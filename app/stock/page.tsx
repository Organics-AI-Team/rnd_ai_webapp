"use client";

/**
 * Stock Management Page
 * Allows users to:
 * - Add stock entries for raw materials with quantity, price, expiration
 * - View all stock entries with filtering and pagination
 * - View stock summary aggregated by material
 * - Edit and delete stock entries
 */

import { useAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc-client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Package, Edit, Trash2, Search, ArrowUpDown, ChevronLeft, ChevronRight, Calendar, DollarSign, Weight } from "lucide-react";
import { useState, useEffect, Suspense } from "react";
import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

function StockContent() {
  console.log('📦 [StockContent] Component mounting');

  const { user, isLoading } = useAuth();
  const router = useRouter();
  const utils = trpc.useUtils();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingStock, setEditingStock] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "expired" | "depleted">("active");
  const [materialFilter, setMaterialFilter] = useState<string>("");
  const [sortField, setSortField] = useState<string>("createdAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const itemsPerPage = 50;

  // Material search for dropdown
  const [materialSearch, setMaterialSearch] = useState("");
  const [selectedMaterial, setSelectedMaterial] = useState<any>(null);
  const [showMaterialDropdown, setShowMaterialDropdown] = useState(false);

  const [formData, setFormData] = useState({
    quantityKg: "",
    unitPrice: "",
    expirationDate: "",
    batchNumber: "",
    supplier: "",
    notes: "",
  });

  console.log('🔍 [StockContent] Current state:', {
    showAddForm,
    editingStock: editingStock?._id,
    statusFilter,
    currentPage
  });

  // Fetch materials for dropdown
  const { data: materialsData } = trpc.stock.getMaterials.useQuery(
    { searchTerm: materialSearch, limit: 20 },
    { enabled: showAddForm }
  );

  // Fetch stock entries
  const { data: stockData, isLoading: stockLoading } = trpc.stock.list.useQuery({
    limit: itemsPerPage,
    offset: (currentPage - 1) * itemsPerPage,
    materialId: materialFilter || undefined,
    status: statusFilter,
    sortField,
    sortDirection,
  });

  // Fetch stock summary
  const { data: summaryData } = trpc.stock.summary.useQuery({
    materialId: materialFilter || undefined,
  });

  const stockEntries = stockData?.entries || [];
  const totalCount = stockData?.totalCount || 0;
  const totalPages = stockData?.totalPages || 1;
  const hasMore = stockData?.hasMore || false;

  console.log(`📊 [StockContent] Loaded ${stockEntries.length} stock entries (total: ${totalCount})`);

  // Mutations
  const createStock = trpc.stock.create.useMutation({
    onSuccess: () => {
      console.log('✅ [StockContent] Stock entry created successfully');
      utils.stock.list.invalidate();
      utils.stock.summary.invalidate();
      setShowAddForm(false);
      setSelectedMaterial(null);
      setMaterialSearch("");
      setFormData({
        quantityKg: "",
        unitPrice: "",
        expirationDate: "",
        batchNumber: "",
        supplier: "",
        notes: "",
      });
    },
    onError: (error) => {
      console.error('❌ [StockContent] Create stock error:', error);
    },
  });

  const updateStock = trpc.stock.update.useMutation({
    onSuccess: () => {
      console.log('✅ [StockContent] Stock entry updated successfully');
      utils.stock.list.invalidate();
      utils.stock.summary.invalidate();
      setShowAddForm(false);
      setEditingStock(null);
      setSelectedMaterial(null);
      setMaterialSearch("");
      setFormData({
        quantityKg: "",
        unitPrice: "",
        expirationDate: "",
        batchNumber: "",
        supplier: "",
        notes: "",
      });
    },
    onError: (error) => {
      console.error('❌ [StockContent] Update stock error:', error);
    },
  });

  const deleteStock = trpc.stock.delete.useMutation({
    onSuccess: () => {
      console.log('✅ [StockContent] Stock entry deleted successfully');
      utils.stock.list.invalidate();
      utils.stock.summary.invalidate();
    },
    onError: (error) => {
      console.error('❌ [StockContent] Delete stock error:', error);
    },
  });

  // Reset to page 1 when filters change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, materialFilter, sortField, sortDirection]);

  if (isLoading || stockLoading) {
    console.log('⏳ [StockContent] Loading...');
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">กำลังโหลด...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    console.log('⚠️ [StockContent] User not authenticated');
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

  if (user.role !== "admin") {
    console.log('⚠️ [StockContent] Access denied - user role:', user.role);
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Card className="max-w-md">
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-red-600 font-semibold mb-4">ไม่มีสิทธิ์เข้าถึง</p>
              <p className="text-gray-600 mb-4">
                เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถเข้าถึงหน้านี้ได้
              </p>
              <Button onClick={() => router.push("/ingredients")}>
                ไปที่สารทั้งหมด
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleFormChange = (field: string, value: string) => {
    setFormData({ ...formData, [field]: value });
  };

  const handleEdit = (stock: any) => {
    console.log('✏️ [StockContent] Editing stock entry:', stock._id);
    setEditingStock(stock);
    setSelectedMaterial({
      _id: stock.materialId,
      code: stock.materialCode,
      name: stock.materialName,
    });
    setFormData({
      quantityKg: stock.quantityKg.toString(),
      unitPrice: stock.unitPrice.toString(),
      expirationDate: stock.expirationDate ? new Date(stock.expirationDate).toISOString().split('T')[0] : "",
      batchNumber: stock.batchNumber || "",
      supplier: stock.supplier || "",
      notes: stock.notes || "",
    });
    setShowAddForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('💾 [StockContent] Submitting form', { editingStock: !!editingStock });

    if (!selectedMaterial && !editingStock) {
      alert("กรุณาเลือกวัตถุดิบ");
      return;
    }

    try {
      if (editingStock) {
        await updateStock.mutateAsync({
          id: editingStock._id,
          quantityKg: parseFloat(formData.quantityKg),
          unitPrice: parseFloat(formData.unitPrice),
          expirationDate: formData.expirationDate,
          batchNumber: formData.batchNumber,
          supplier: formData.supplier,
          notes: formData.notes,
        });
        alert("อัปเดตสต็อกเรียบร้อยแล้ว!");
      } else {
        await createStock.mutateAsync({
          materialId: selectedMaterial._id,
          materialCode: selectedMaterial.code,
          materialName: selectedMaterial.name,
          quantityKg: parseFloat(formData.quantityKg),
          unitPrice: parseFloat(formData.unitPrice),
          expirationDate: formData.expirationDate,
          batchNumber: formData.batchNumber,
          supplier: formData.supplier,
          notes: formData.notes,
        });
        alert("เพิ่มสต็อกเรียบร้อยแล้ว!");
      }
    } catch (error: any) {
      console.error('❌ [StockContent] Submit error:', error);
      alert(error.message || (editingStock ? "ไม่สามารถอัปเดตสต็อกได้" : "ไม่สามารถเพิ่มสต็อกได้"));
    }
  };

  const handleDelete = async (id: string, materialName: string) => {
    console.log('🗑️ [StockContent] Deleting stock entry:', id);
    if (confirm(`คุณแน่ใจหรือไม่ที่จะลบสต็อก "${materialName}"?`)) {
      try {
        await deleteStock.mutateAsync({ id });
        alert("ลบสต็อกเรียบร้อยแล้ว!");
      } catch (error: any) {
        console.error('❌ [StockContent] Delete error:', error);
        alert(error.message || "ไม่สามารถลบสต็อกได้");
      }
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    return date.toLocaleDateString('th-TH');
  };

  const isExpiringSoon = (dateString: string) => {
    if (!dateString) return false;
    const expirationDate = new Date(dateString);
    const today = new Date();
    const daysUntilExpiration = Math.floor((expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilExpiration <= 30 && daysUntilExpiration >= 0;
  };

  const isExpired = (dateString: string) => {
    if (!dateString) return false;
    const expirationDate = new Date(dateString);
    const today = new Date();
    return expirationDate < today;
  };

  console.log('🎨 [StockContent] Rendering component');

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
                <Package className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">
                  เพิ่มสต็อก
                </h1>
                <p className="text-gray-600">
                  จัดการสต็อกวัตถุดิบ ติดตามปริมาณ ราคา และวันหมดอายุ
                </p>
              </div>
            </div>

            <Button
              onClick={() => {
                console.log('➕ [StockContent] Opening add form');
                setEditingStock(null);
                setSelectedMaterial(null);
                setMaterialSearch("");
                setFormData({
                  quantityKg: "",
                  unitPrice: "",
                  expirationDate: "",
                  batchNumber: "",
                  supplier: "",
                  notes: "",
                });
                setShowAddForm(!showAddForm);
              }}
              className="bg-purple-600 hover:bg-purple-700"
            >
              <Plus className="h-4 w-4 mr-2" />
              เพิ่มสต็อก
            </Button>
          </div>
        </div>

        {/* Stock Summary Cards */}
        {summaryData && summaryData.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-600">จำนวนวัตถุดิบที่มีสต็อก</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summaryData.length}</div>
                <p className="text-xs text-gray-500 mt-1">ประเภทวัตถุดิบ</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-600">ปริมาณทั้งหมด</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {summaryData.reduce((sum: number, item: any) => sum + item.totalQuantityKg, 0).toLocaleString()} kg
                </div>
                <p className="text-xs text-gray-500 mt-1">น้ำหนักรวม</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-600">มูลค่าทั้งหมด</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  ฿{summaryData.reduce((sum: number, item: any) => sum + item.totalValue, 0).toLocaleString()}
                </div>
                <p className="text-xs text-gray-500 mt-1">มูลค่ารวม</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Add/Edit Stock Form */}
        {showAddForm && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>{editingStock ? "แก้ไขสต็อก" : "เพิ่มสต็อก"}</CardTitle>
              <CardDescription>
                {editingStock ? "อัปเดตรายละเอียดสต็อก" : "เลือกวัตถุดิบและกรอกรายละเอียดสต็อก"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Material Selection */}
                {!editingStock && (
                  <div className="space-y-2">
                    <Label htmlFor="material">วัตถุดิบ *</Label>
                    <div className="relative">
                      <Input
                        id="material"
                        placeholder="ค้นหาวัตถุดิบ..."
                        value={selectedMaterial ? `${selectedMaterial.code} - ${selectedMaterial.name}` : materialSearch}
                        onChange={(e) => {
                          setMaterialSearch(e.target.value);
                          setShowMaterialDropdown(true);
                          if (selectedMaterial) setSelectedMaterial(null);
                        }}
                        onFocus={() => setShowMaterialDropdown(true)}
                        required
                      />
                      {showMaterialDropdown && materialsData && materialsData.length > 0 && !selectedMaterial && (
                        <div className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-60 overflow-auto">
                          {materialsData.map((material: any) => (
                            <div
                              key={material._id}
                              className="p-2 hover:bg-gray-100 cursor-pointer"
                              onClick={() => {
                                console.log('📦 [StockContent] Material selected:', material.code);
                                setSelectedMaterial(material);
                                setMaterialSearch("");
                                setShowMaterialDropdown(false);
                              }}
                            >
                              <div className="font-medium">{material.code} - {material.name}</div>
                              {material.inci && (
                                <div className="text-xs text-gray-500">{material.inci}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {editingStock && (
                  <div className="space-y-2">
                    <Label>วัตถุดิบ</Label>
                    <Input
                      value={`${selectedMaterial?.code} - ${selectedMaterial?.name}`}
                      disabled
                      className="bg-gray-100 cursor-not-allowed"
                    />
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="quantityKg">ปริมาณ (kg) *</Label>
                    <div className="relative">
                      <Weight className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <Input
                        id="quantityKg"
                        type="number"
                        step="0.01"
                        placeholder="200.00"
                        value={formData.quantityKg}
                        onChange={(e) => handleFormChange("quantityKg", e.target.value)}
                        className="pl-9"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="unitPrice">ราคาต่อ kg (฿) *</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <Input
                        id="unitPrice"
                        type="number"
                        step="0.01"
                        placeholder="150.00"
                        value={formData.unitPrice}
                        onChange={(e) => handleFormChange("unitPrice", e.target.value)}
                        className="pl-9"
                        required
                      />
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="expirationDate">วันหมดอายุ *</Label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <Input
                        id="expirationDate"
                        type="date"
                        value={formData.expirationDate}
                        onChange={(e) => handleFormChange("expirationDate", e.target.value)}
                        className="pl-9"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="batchNumber">Batch Number</Label>
                    <Input
                      id="batchNumber"
                      placeholder="B20250101"
                      value={formData.batchNumber}
                      onChange={(e) => handleFormChange("batchNumber", e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="supplier">ผู้จัดหา</Label>
                  <Input
                    id="supplier"
                    placeholder="ชื่อผู้จัดหา"
                    value={formData.supplier}
                    onChange={(e) => handleFormChange("supplier", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notes">หมายเหตุ</Label>
                  <Textarea
                    id="notes"
                    placeholder="หมายเหตุเพิ่มเติม..."
                    value={formData.notes}
                    onChange={(e) => handleFormChange("notes", e.target.value)}
                    rows={3}
                  />
                </div>

                {/* Show calculated total */}
                {formData.quantityKg && formData.unitPrice && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                    <div className="text-sm text-blue-900">
                      <strong>ราคารวม:</strong> ฿{(parseFloat(formData.quantityKg) * parseFloat(formData.unitPrice)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button type="submit" disabled={createStock.isPending || updateStock.isPending}>
                    {editingStock
                      ? (updateStock.isPending ? "กำลังอัปเดต..." : "อัปเดตสต็อก")
                      : (createStock.isPending ? "กำลังเพิ่ม..." : "เพิ่มสต็อก")
                    }
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      console.log('❌ [StockContent] Cancelling form');
                      setShowAddForm(false);
                      setEditingStock(null);
                      setSelectedMaterial(null);
                      setMaterialSearch("");
                      setFormData({
                        quantityKg: "",
                        unitPrice: "",
                        expirationDate: "",
                        batchNumber: "",
                        supplier: "",
                        notes: "",
                      });
                    }}
                  >
                    ยกเลิก
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Stock Summary Table - Aggregated by Material */}
        {summaryData && summaryData.length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Package className="h-5 w-5" />
                    สรุปสต็อกแยกตามวัตถุดิบ
                  </CardTitle>
                  <CardDescription>
                    ยอดรวมสต็อกของแต่ละวัตถุดิบ (รวมทุก Batch)
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>รหัสวัตถุดิบ</TableHead>
                    <TableHead>ชื่อวัตถุดิบ</TableHead>
                    <TableHead className="text-right">ปริมาณรวม (kg)</TableHead>
                    <TableHead className="text-right">มูลค่ารวม (฿)</TableHead>
                    <TableHead className="text-right">ราคาเฉลี่ย/kg (฿)</TableHead>
                    <TableHead className="text-center">จำนวน Batch</TableHead>
                    <TableHead>วันหมดอายุใกล้สุด</TableHead>
                    <TableHead className="text-center">ดูรายละเอียด</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaryData.map((summary: any) => {
                    const isExpiringSoonSummary = summary.nearestExpiration && isExpiringSoon(summary.nearestExpiration);
                    const isExpiredSummary = summary.nearestExpiration && isExpired(summary.nearestExpiration);

                    return (
                      <TableRow
                        key={summary.materialId}
                        className={
                          isExpiredSummary
                            ? "bg-red-50"
                            : isExpiringSoonSummary
                            ? "bg-yellow-50"
                            : ""
                        }
                      >
                        <TableCell className="font-mono text-sm">
                          {summary.materialCode}
                        </TableCell>
                        <TableCell className="font-medium">
                          {summary.materialName}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold text-green-700">
                          {summary.totalQuantityKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold text-blue-700">
                          {summary.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {summary.averagePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="bg-gray-50">
                            {summary.batchCount}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {summary.nearestExpiration ? formatDate(summary.nearestExpiration) : "-"}
                            {isExpiredSummary && (
                              <Badge variant="destructive" className="text-xs">หมดอายุ</Badge>
                            )}
                            {!isExpiredSummary && isExpiringSoonSummary && (
                              <Badge variant="outline" className="text-xs bg-yellow-50 text-yellow-700 border-yellow-300">ใกล้หมดอายุ</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              console.log('🔍 [StockContent] Filtering by material:', summary.materialId);
                              setMaterialFilter(summary.materialId);
                              // Scroll to detailed table
                              document.getElementById('detailed-entries-section')?.scrollIntoView({ behavior: 'smooth' });
                            }}
                            className="text-xs"
                          >
                            <Search className="h-3 w-3 mr-1" />
                            ดู
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Stock Entries List */}
        <Card id="detailed-entries-section">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  รายการสต็อกทั้งหมด (แยกตาม Batch)
                </CardTitle>
                <CardDescription>
                  {materialFilter ? (
                    <div className="flex items-center gap-2">
                      <span>กำลังกรองตามวัตถุดิบที่เลือก</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setMaterialFilter("")}
                        className="h-6 text-xs text-blue-600 hover:text-blue-700"
                      >
                        แสดงทั้งหมด
                      </Button>
                    </div>
                  ) : (
                    `แสดง ${stockEntries.length} รายการในหน้านี้ (ทั้งหมด ${totalCount.toLocaleString()} สต็อก)`
                  )}
                </CardDescription>
              </div>
            </div>

            {/* Filters */}
            <div className="flex gap-4 mt-4 flex-wrap">
              <div className="flex gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="px-3 py-2 border rounded-md text-sm bg-white"
                >
                  <option value="all">ทั้งหมด</option>
                  <option value="active">ใช้งานได้</option>
                  <option value="expired">หมดอายุ</option>
                  <option value="depleted">หมดแล้ว</option>
                </select>

                <select
                  value={sortField}
                  onChange={(e) => setSortField(e.target.value)}
                  className="px-3 py-2 border rounded-md text-sm bg-white"
                >
                  <option value="createdAt">วันที่เพิ่ม</option>
                  <option value="expirationDate">วันหมดอายุ</option>
                  <option value="materialName">ชื่อวัตถุดิบ</option>
                  <option value="quantityKg">ปริมาณ</option>
                </select>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")}
                >
                  <ArrowUpDown className="h-4 w-4 mr-1" />
                  {sortDirection === "asc" ? "น้อย-มาก" : "มาก-น้อย"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {stockEntries && stockEntries.length > 0 ? (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>รหัส</TableHead>
                      <TableHead>ชื่อวัตถุดิบ</TableHead>
                      <TableHead>ปริมาณ (kg)</TableHead>
                      <TableHead>ราคา/kg (฿)</TableHead>
                      <TableHead>ราคารวม (฿)</TableHead>
                      <TableHead>วันหมดอายุ</TableHead>
                      <TableHead>Batch</TableHead>
                      <TableHead>ผู้จัดหา</TableHead>
                      <TableHead>สถานะ</TableHead>
                      <TableHead>จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stockEntries.map((stock: any) => (
                      <TableRow key={stock._id}>
                        <TableCell className="font-mono text-sm">
                          {stock.materialCode}
                        </TableCell>
                        <TableCell className="font-medium">
                          {stock.materialName}
                        </TableCell>
                        <TableCell className="text-sm font-mono">
                          {stock.quantityKg.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-sm font-mono">
                          {stock.unitPrice.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-sm font-mono font-semibold">
                          {stock.totalCost.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {formatDate(stock.expirationDate)}
                            {isExpired(stock.expirationDate) && (
                              <Badge variant="destructive" className="text-xs">หมดอายุ</Badge>
                            )}
                            {!isExpired(stock.expirationDate) && isExpiringSoon(stock.expirationDate) && (
                              <Badge variant="outline" className="text-xs bg-yellow-50 text-yellow-700 border-yellow-300">ใกล้หมดอายุ</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {stock.batchNumber || "-"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {stock.supplier || "-"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={stock.status === "active" ? "default" : "secondary"}
                            className={
                              stock.status === "active"
                                ? "bg-green-100 text-green-800 hover:bg-green-200"
                                : stock.status === "expired"
                                ? "bg-red-100 text-red-800"
                                : "bg-gray-100 text-gray-800"
                            }
                          >
                            {stock.status === "active" ? "ใช้งานได้" : stock.status === "expired" ? "หมดอายุ" : "หมดแล้ว"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleEdit(stock)}
                            >
                              <Edit className="h-4 w-4 text-blue-600" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                handleDelete(stock._id, stock.materialName)
                              }
                            >
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t">
                    <div className="text-sm text-gray-600">
                      แสดง {(currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, totalCount)} จากทั้งหมด {totalCount.toLocaleString()} สต็อก
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                      >
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        ก่อนหน้า
                      </Button>
                      <div className="text-sm text-gray-600">
                        หน้า {currentPage} / {totalPages}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        disabled={!hasMore}
                      >
                        ถัดไป
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-12">
                <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 mb-2">ยังไม่มีสต็อก</p>
                <p className="text-sm text-gray-500">
                  คลิก &quot;เพิ่มสต็อก&quot; เพื่อเพิ่มสต็อกวัตถุดิบใหม่
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function StockPage() {
  console.log('🎬 [StockPage] Page component rendering');
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">กำลังโหลด...</p>
        </div>
      </div>
    }>
      <StockContent />
    </Suspense>
  );
}
