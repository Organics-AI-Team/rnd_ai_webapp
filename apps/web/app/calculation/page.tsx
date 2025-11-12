"use client";

/**
 * Price Calculation Page (คำนวนราคา)
 *
 * Allows users to:
 * - Pick materials from stock with their current prices
 * - Specify amounts needed for production
 * - Add overhead, labor, packaging costs
 * - Calculate total production cost and suggested selling price
 * - Save calculations for future reference
 *
 * @module CalculationPage
 */

import { useAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc-client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calculator,
  Plus,
  Trash2,
  Save,
  TrendingUp,
  Package,
  Search,
  FileText,
} from "lucide-react";
import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface SelectedMaterial {
  materialId: string;
  materialCode: string;
  materialName: string;
  stockEntryId: string;
  unitPrice: number;
  amountKg: number;
  availableQuantity: number;
}

export default function CalculationPage() {
  console.log("📊 [CalculationPage] Component rendering");

  const { user, isLoading } = useAuth();
  const router = useRouter();
  const utils = trpc.useUtils();

  // Material selection state
  const [materialSearch, setMaterialSearch] = useState("");
  const [showMaterialDropdown, setShowMaterialDropdown] = useState(false);
  const [selectedMaterials, setSelectedMaterials] = useState<SelectedMaterial[]>([]);

  // Calculation parameters
  const [calculationName, setCalculationName] = useState("");
  const [markupPercentage, setMarkupPercentage] = useState("30");
  const [notes, setNotes] = useState("");

  // Results state
  const [calculationResult, setCalculationResult] = useState<any>(null);

  // Fetch stock entries for material picker
  const { data: stockData } = trpc.stock.list.useQuery(
    {
      limit: 20,
      offset: 0,
      status: "active",
      sortField: "materialName",
      sortDirection: "asc",
    },
    { enabled: showMaterialDropdown && materialSearch.length > 0 }
  );

  // Fetch saved calculations (only when user is logged in)
  const { data: savedCalculations, isLoading: calculationsLoading } =
    trpc.calculations.listCalculations.useQuery(undefined, {
      enabled: !!user, // Only run query when user exists
    });

  // Calculate price mutation
  const calculateMutation = trpc.calculations.calculateManual.useMutation({
    onSuccess: (data) => {
      console.log("✅ [CalculationPage] Calculation completed", data);
      setCalculationResult(data);
    },
    onError: (error) => {
      console.error("❌ [CalculationPage] Calculation error:", error);
      alert(error.message || "เกิดข้อผิดพลาดในการคำนวณ");
    },
  });

  // Save calculation mutation
  const saveCalculation = trpc.calculations.saveCalculation.useMutation({
    onSuccess: () => {
      console.log("✅ [CalculationPage] Calculation saved");
      utils.calculations.listCalculations.invalidate();
      alert("บันทึกการคำนวณเรียบร้อยแล้ว!");
    },
    onError: (error) => {
      console.error("❌ [CalculationPage] Save error:", error);
      alert(error.message || "ไม่สามารถบันทึกการคำนวณได้");
    },
  });

  // Delete calculation mutation
  const deleteCalculation = trpc.calculations.deleteCalculation.useMutation({
    onSuccess: () => {
      console.log("✅ [CalculationPage] Calculation deleted");
      utils.calculations.listCalculations.invalidate();
      alert("ลบการคำนวณเรียบร้อยแล้ว!");
    },
    onError: (error) => {
      console.error("❌ [CalculationPage] Delete error:", error);
      alert(error.message || "ไม่สามารถลบการคำนวณได้");
    },
  });

  if (isLoading) {
    console.log("⏳ [CalculationPage] Loading...");
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
    console.log("⚠️ [CalculationPage] User not authenticated");
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

  /**
   * Add a material from stock to the calculation
   */
  const handleAddMaterial = (stockEntry: any) => {
    console.log("➕ [CalculationPage] Adding material:", stockEntry.materialCode);

    // Check if already added
    if (selectedMaterials.some((m) => m.stockEntryId === stockEntry._id)) {
      alert("วัตถุดิบนี้ถูกเพิ่มแล้ว");
      return;
    }

    setSelectedMaterials([
      ...selectedMaterials,
      {
        materialId: stockEntry.materialId,
        materialCode: stockEntry.materialCode,
        materialName: stockEntry.materialName,
        stockEntryId: stockEntry._id,
        unitPrice: stockEntry.unitPrice,
        amountKg: 0,
        availableQuantity: stockEntry.quantityKg,
      },
    ]);

    setMaterialSearch("");
    setShowMaterialDropdown(false);
  };

  /**
   * Remove a material from the calculation
   */
  const handleRemoveMaterial = (stockEntryId: string) => {
    console.log("🗑️ [CalculationPage] Removing material:", stockEntryId);
    setSelectedMaterials(
      selectedMaterials.filter((m) => m.stockEntryId !== stockEntryId)
    );
  };

  /**
   * Update material amount
   */
  const handleUpdateAmount = (stockEntryId: string, amount: string) => {
    const amountNum = parseFloat(amount) || 0;
    setSelectedMaterials(
      selectedMaterials.map((m) =>
        m.stockEntryId === stockEntryId ? { ...m, amountKg: amountNum } : m
      )
    );
  };

  /**
   * Calculate the price
   */
  const handleCalculate = () => {
    console.log("🔢 [CalculationPage] Starting calculation");

    if (!calculationName.trim()) {
      alert("กรุณากรอกชื่อการคำนวณ");
      return;
    }

    if (selectedMaterials.length === 0) {
      alert("กรุณาเลือกวัตถุดิบอย่างน้อย 1 รายการ");
      return;
    }

    if (selectedMaterials.some((m) => m.amountKg <= 0)) {
      alert("กรุณากรอกจำนวนวัตถุดิบให้ครบ");
      return;
    }

    // Calculate total weight from selected materials
    const totalWeight = selectedMaterials.reduce((sum, m) => sum + m.amountKg, 0);

    calculateMutation.mutate({
      name: calculationName,
      items: selectedMaterials.map((m) => ({
        materialId: m.materialId,
        materialCode: m.materialCode,
        materialName: m.materialName,
        amountKg: m.amountKg,
        unitPrice: m.unitPrice,
        stockEntryId: m.stockEntryId,
      })),
      batchSize: totalWeight, // Use total material weight as batch size
      overheadPercentage: 0, // No overhead
      markupPercentage: parseFloat(markupPercentage) || 0,
      packagingCost: 0, // No packaging cost
      laborCostPerBatch: 0, // No labor cost
      notes,
    });
  };

  /**
   * Save the calculation
   */
  const handleSave = () => {
    console.log("💾 [CalculationPage] Saving calculation");

    if (!calculationResult) {
      alert("ยังไม่มีผลการคำนวณ กรุณาคำนวณก่อน");
      return;
    }

    saveCalculation.mutate(calculationResult);
  };

  /**
   * Load a saved calculation
   */
  const handleLoadCalculation = (calc: any) => {
    console.log("📂 [CalculationPage] Loading calculation:", calc._id);

    setCalculationName(calc.name);
    setMarkupPercentage(
      calc.markupAmount && calc.totalProductionCost
        ? ((calc.markupAmount / calc.totalProductionCost) * 100).toFixed(2)
        : "30"
    );
    setNotes(calc.notes || "");

    setSelectedMaterials(
      calc.items.map((item: any) => ({
        materialId: item.materialCode, // This might need adjustment
        materialCode: item.materialCode,
        materialName: item.materialName,
        stockEntryId: item.stockEntryId || "",
        unitPrice: item.unitPrice,
        amountKg: item.amountKg,
        availableQuantity: 0,
      }))
    );

    setCalculationResult(calc);
  };

  const filteredStockEntries = stockData?.entries?.filter((entry: any) => {
    const searchLower = materialSearch.toLowerCase();
    return (
      entry.materialCode.toLowerCase().includes(searchLower) ||
      entry.materialName.toLowerCase().includes(searchLower)
    );
  });

  console.log("🎨 [CalculationPage] Rendering component");

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Button variant="ghost" onClick={() => router.back()} className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            ย้อนกลับ
          </Button>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-600 rounded-lg">
                <Calculator className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">
                  คำนวนราคา
                </h1>
                <p className="text-gray-600">
                  คำนวณต้นทุนการผลิตและราคาขาย
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Input Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Calculation Info */}
            <Card>
              <CardHeader>
                <CardTitle>ข้อมูลการคำนวณ</CardTitle>
                <CardDescription>ระบุชื่อและรายละเอียด</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="calcName">ชื่อการคำนวณ *</Label>
                  <Input
                    id="calcName"
                    placeholder="เช่น: เซรั่มบำรุงผิวหน้า"
                    value={calculationName}
                    onChange={(e) => setCalculationName(e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Material Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plus className="h-5 w-5 text-green-600" />
                  เลือกวัตถุดิบจาก Stock (เพิ่มได้หลายรายการ)
                </CardTitle>
                <CardDescription>
                  ค้นหาและเพิ่มวัตถุดิบหลายรายการ พร้อมระบุจำนวนที่ต้องใช้
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Material Search */}
                <div className="space-y-2">
                  <Label htmlFor="materialSearch">ค้นหาวัตถุดิบ</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                    <Input
                      id="materialSearch"
                      placeholder="ค้นหารหัสหรือชื่อวัตถุดิบ..."
                      value={materialSearch}
                      onChange={(e) => {
                        setMaterialSearch(e.target.value);
                        setShowMaterialDropdown(true);
                      }}
                      onFocus={() => setShowMaterialDropdown(true)}
                      className="pl-9"
                    />
                    {showMaterialDropdown &&
                      filteredStockEntries &&
                      filteredStockEntries.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-60 overflow-auto">
                          {filteredStockEntries.map((entry: any) => (
                            <div
                              key={entry._id}
                              className="p-3 hover:bg-gray-100 cursor-pointer border-b last:border-b-0"
                              onClick={() => handleAddMaterial(entry)}
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="font-medium">
                                    {entry.materialCode} - {entry.materialName}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    ราคา: ฿{entry.unitPrice}/kg | มีอยู่:{" "}
                                    {entry.quantityKg} kg
                                  </div>
                                </div>
                                <Plus className="h-4 w-4 text-green-600" />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                  </div>
                </div>

                {/* Selected Materials Table */}
                {selectedMaterials.length > 0 ? (
                  <div className="mt-4">
                    <Label className="mb-2 block">วัตถุดิบที่เลือก</Label>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>รหัส</TableHead>
                          <TableHead>ชื่อ</TableHead>
                          <TableHead>ราคา/kg</TableHead>
                          <TableHead>จำนวน (kg)</TableHead>
                          <TableHead>รวม (฿)</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedMaterials.map((material) => {
                          const total = material.amountKg * material.unitPrice;
                          return (
                            <TableRow key={material.stockEntryId}>
                              <TableCell className="font-mono text-sm">
                                {material.materialCode}
                              </TableCell>
                              <TableCell className="font-medium">
                                {material.materialName}
                              </TableCell>
                              <TableCell className="font-mono text-sm">
                                ฿{material.unitPrice.toLocaleString()}
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  step="0.01"
                                  placeholder="0.00"
                                  value={material.amountKg || ""}
                                  onChange={(e) =>
                                    handleUpdateAmount(
                                      material.stockEntryId,
                                      e.target.value
                                    )
                                  }
                                  className="w-28"
                                />
                              </TableCell>
                              <TableCell className="font-mono font-semibold">
                                ฿{total.toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </TableCell>
                              <TableCell>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    handleRemoveMaterial(material.stockEntryId)
                                  }
                                >
                                  <Trash2 className="h-4 w-4 text-red-600" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500 border-2 border-dashed rounded-lg">
                    <Package className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                    <p>ยังไม่มีวัตถุดิบ</p>
                    <p className="text-sm">ค้นหาและเพิ่มวัตถุดิบจาก stock</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Cost Parameters */}
            <Card>
              <CardHeader>
                <CardTitle>กำไร (Markup)</CardTitle>
                <CardDescription>
                  ระบุอัตรากำไรที่ต้องการ
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="markup">
                    Markup (%)
                    <span className="text-xs text-gray-500 ml-2">
                      อัตรากำไร
                    </span>
                  </Label>
                  <div className="relative">
                    <TrendingUp className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                    <Input
                      id="markup"
                      type="number"
                      step="0.1"
                      placeholder="30"
                      value={markupPercentage}
                      onChange={(e) => setMarkupPercentage(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <p className="text-xs text-gray-500">
                    เช่น: ถ้าต้นทุน 100 บาท และ markup 30% จะได้ราคาขาย 130 บาท
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notes">หมายเหตุ</Label>
                  <Textarea
                    id="notes"
                    placeholder="หมายเหตุเพิ่มเติม..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Calculate Button */}
            <div className="flex gap-2">
              <Button
                onClick={handleCalculate}
                disabled={calculateMutation.isPending}
                className="flex-1 bg-green-600 hover:bg-green-700"
                size="lg"
              >
                <Calculator className="h-5 w-5 mr-2" />
                {calculateMutation.isPending ? "กำลังคำนวณ..." : "คำนวณ"}
              </Button>

              {calculationResult && (
                <Button
                  onClick={handleSave}
                  disabled={saveCalculation.isPending}
                  variant="outline"
                  size="lg"
                >
                  <Save className="h-5 w-5 mr-2" />
                  บันทึก
                </Button>
              )}
            </div>
          </div>

          {/* Right Column - Results */}
          <div className="space-y-6">
            {/* Calculation Result */}
            {calculationResult && (
              <Card className="border-green-200 bg-green-50">
                <CardHeader>
                  <CardTitle className="text-green-900">ผลการคำนวณ</CardTitle>
                  <CardDescription className="text-green-700">
                    {calculationResult.name}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-900 font-semibold">ต้นทุนวัตถุดิบ</span>
                      <span className="font-mono font-bold text-lg text-blue-700">
                        ฿{calculationResult.rawMaterialCost.toLocaleString()}
                      </span>
                    </div>
                    <div className="border-t pt-2 mt-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">กำไร ({calculationResult.profitMargin.toFixed(1)}%)</span>
                        <span className="font-mono font-semibold text-green-600">
                          +฿{calculationResult.markupAmount.toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div className="border-t pt-2 mt-2 bg-green-100 -mx-4 px-4 py-3 rounded-lg">
                      <div className="flex justify-between font-bold">
                        <span className="text-gray-900">ราคาขายแนะนำ</span>
                        <span className="font-mono text-2xl text-green-700">
                          ฿
                          {calculationResult.suggestedSellingPrice.toLocaleString()}
                        </span>
                      </div>
                      <div className="text-xs text-gray-600 mt-1 text-right">
                        น้ำหนักรวม: {calculationResult.batchSize.toLocaleString()} kg |
                        ต้นทุน/kg: ฿{calculationResult.costPerKg.toLocaleString()}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Saved Calculations */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  การคำนวณที่บันทึกไว้
                </CardTitle>
                <CardDescription>
                  {savedCalculations?.length || 0} รายการ
                </CardDescription>
              </CardHeader>
              <CardContent>
                {savedCalculations && savedCalculations.length > 0 ? (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {savedCalculations.map((calc: any) => (
                      <div
                        key={calc._id}
                        className="p-3 border rounded-lg hover:bg-gray-50 cursor-pointer"
                        onClick={() => handleLoadCalculation(calc)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="font-medium text-sm">
                              {calc.name}
                            </div>
                            <div className="text-xs text-gray-500">
                              ฿
                              {calc.suggestedSellingPrice.toLocaleString()} |{" "}
                              {new Date(
                                calc.createdAt
                              ).toLocaleDateString("th-TH")}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (
                                confirm(
                                  `ลบการคำนวณ "${calc.name}"?`
                                )
                              ) {
                                deleteCalculation.mutate({ id: calc._id });
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <FileText className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                    <p className="text-sm">ยังไม่มีการคำนวณที่บันทึกไว้</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
