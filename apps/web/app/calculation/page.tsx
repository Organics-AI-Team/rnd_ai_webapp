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
import { ConsolePageShell } from "@/components/console_page_shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "next/navigation";
import {
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
  console.log("[CalculationPage] Component rendering");

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
      console.log("[CalculationPage] Calculation completed", data);
      setCalculationResult(data);
    },
    onError: (error) => {
      console.error("[CalculationPage] Calculation error:", error);
      alert(error.message || "เกิดข้อผิดพลาดในการคำนวณ");
    },
  });

  // Save calculation mutation
  const saveCalculation = trpc.calculations.saveCalculation.useMutation({
    onSuccess: () => {
      console.log("[CalculationPage] Calculation saved");
      utils.calculations.listCalculations.invalidate();
      alert("บันทึกการคำนวณเรียบร้อยแล้ว!");
    },
    onError: (error) => {
      console.error("[CalculationPage] Save error:", error);
      alert(error.message || "ไม่สามารถบันทึกการคำนวณได้");
    },
  });

  // Delete calculation mutation
  const deleteCalculation = trpc.calculations.deleteCalculation.useMutation({
    onSuccess: () => {
      console.log("[CalculationPage] Calculation deleted");
      utils.calculations.listCalculations.invalidate();
      alert("ลบการคำนวณเรียบร้อยแล้ว!");
    },
    onError: (error) => {
      console.error("[CalculationPage] Delete error:", error);
      alert(error.message || "ไม่สามารถลบการคำนวณได้");
    },
  });

  if (isLoading) {
    console.log("[CalculationPage] Loading...");
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400 mx-auto"></div>
          <p className="mt-3 text-[12px] text-gray-400">กำลังโหลด...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    console.log("[CalculationPage] User not authenticated");
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="border border-gray-200/60 rounded-xl p-8 max-w-sm text-center">
          <p className="text-[13px] font-medium text-gray-800 mb-2">กรุณาเข้าสู่ระบบ</p>
          <p className="text-[12px] text-gray-400 mb-4">
            คุณต้องเข้าสู่ระบบก่อนเข้าใช้งานหน้านี้
          </p>
          <Button
            onClick={() => router.push("/login")}
            className="bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-[12px]"
          >
            ไปหน้าเข้าสู่ระบบ
          </Button>
        </div>
      </div>
    );
  }

  /**
   * Add a material from stock to the calculation
   */
  const handleAddMaterial = (stockEntry: any) => {
    console.log("[CalculationPage] Adding material:", stockEntry.materialCode);

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
    console.log("[CalculationPage] Removing material:", stockEntryId);
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
    console.log("[CalculationPage] Starting calculation");

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
    console.log("[CalculationPage] Saving calculation");

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
    console.log("[CalculationPage] Loading calculation:", calc._id);

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

  console.log("[CalculationPage] Rendering component");

  return (
    <ConsolePageShell title="Price Calculator" subtitle="Cost estimation">
      <div className="p-4 md:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left Column - Input Form */}
          <div className="lg:col-span-2 space-y-5">
            {/* Calculation Info */}
            <div className="border border-gray-200/60 rounded-xl p-4 space-y-3">
              <div>
                <h2 className="text-[12px] font-medium text-gray-600">ข้อมูลการคำนวณ</h2>
                <p className="text-[11px] text-gray-400">ระบุชื่อและรายละเอียด</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="calcName" className="text-[12px] text-gray-500">ชื่อการคำนวณ *</Label>
                <Input
                  id="calcName"
                  placeholder="เช่น: เซรั่มบำรุงผิวหน้า"
                  value={calculationName}
                  onChange={(e) => setCalculationName(e.target.value)}
                  className="border-gray-200/60 bg-white rounded-lg text-[12px]"
                />
              </div>
            </div>

            {/* Material Selection */}
            <div className="border border-gray-200/60 rounded-xl p-4 space-y-3">
              <div>
                <h2 className="text-[12px] font-medium text-gray-600">
                  เลือกวัตถุดิบจาก Stock (เพิ่มได้หลายรายการ)
                </h2>
                <p className="text-[11px] text-gray-400">
                  ค้นหาและเพิ่มวัตถุดิบหลายรายการ พร้อมระบุจำนวนที่ต้องใช้
                </p>
              </div>

              {/* Material Search */}
              <div className="space-y-1.5">
                <Label htmlFor="materialSearch" className="text-[12px] text-gray-500">ค้นหาวัตถุดิบ</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-400" />
                  <Input
                    id="materialSearch"
                    placeholder="ค้นหารหัสหรือชื่อวัตถุดิบ..."
                    value={materialSearch}
                    onChange={(e) => {
                      setMaterialSearch(e.target.value);
                      setShowMaterialDropdown(true);
                    }}
                    onFocus={() => setShowMaterialDropdown(true)}
                    className="pl-8 h-8 text-[12px] border-gray-200/60 bg-white rounded-lg"
                  />
                  {showMaterialDropdown &&
                    filteredStockEntries &&
                    filteredStockEntries.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200/60 rounded-lg shadow-sm max-h-60 overflow-auto">
                        {filteredStockEntries.map((entry: any) => (
                          <div
                            key={entry._id}
                            className="px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                            onClick={() => handleAddMaterial(entry)}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="text-[12px] font-medium text-gray-700">
                                  {entry.materialCode} - {entry.materialName}
                                </div>
                                <div className="text-[11px] text-gray-400">
                                  ราคา: ฿{entry.unitPrice}/kg | มีอยู่:{" "}
                                  {entry.quantityKg} kg
                                </div>
                              </div>
                              <Plus className="h-3.5 w-3.5 text-gray-400" />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                </div>
              </div>

              {/* Selected Materials Table */}
              {selectedMaterials.length > 0 ? (
                <div className="mt-3">
                  <Label className="mb-2 block text-[12px] text-gray-500">วัตถุดิบที่เลือก</Label>
                  <Table>
                    <TableHeader>
                      <TableRow className="border-gray-100">
                        <TableHead className="text-[11px] text-gray-400">รหัส</TableHead>
                        <TableHead className="text-[11px] text-gray-400">ชื่อ</TableHead>
                        <TableHead className="text-[11px] text-gray-400">ราคา/kg</TableHead>
                        <TableHead className="text-[11px] text-gray-400">จำนวน (kg)</TableHead>
                        <TableHead className="text-[11px] text-gray-400">รวม (฿)</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedMaterials.map((material) => {
                        const total = material.amountKg * material.unitPrice;
                        return (
                          <TableRow key={material.stockEntryId} className="border-gray-100">
                            <TableCell className="font-mono text-[11px] text-gray-600">
                              {material.materialCode}
                            </TableCell>
                            <TableCell className="text-[12px] text-gray-700">
                              {material.materialName}
                            </TableCell>
                            <TableCell className="font-mono text-[11px] text-gray-600">
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
                                className="w-28 h-7 text-[12px] border-gray-200/60 bg-white rounded-lg"
                              />
                            </TableCell>
                            <TableCell className="font-mono text-[12px] font-medium text-gray-800">
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
                                className="h-7 w-7 p-0"
                              >
                                <Trash2 className="h-3.5 w-3.5 text-gray-400 hover:text-red-500" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-16 border border-dashed border-gray-200/60 rounded-lg">
                  <Package className="h-8 w-8 mx-auto mb-2 text-gray-200" />
                  <p className="text-[12px] text-gray-400">ยังไม่มีวัตถุดิบ</p>
                  <p className="text-[11px] text-gray-400">ค้นหาและเพิ่มวัตถุดิบจาก stock</p>
                </div>
              )}
            </div>

            {/* Cost Parameters */}
            <div className="border border-gray-200/60 rounded-xl p-4 space-y-3">
              <div>
                <h2 className="text-[12px] font-medium text-gray-600">กำไร (Markup)</h2>
                <p className="text-[11px] text-gray-400">ระบุอัตรากำไรที่ต้องการ</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="markup" className="text-[12px] text-gray-500">
                  Markup (%)
                  <span className="text-[11px] text-gray-400 ml-2">
                    อัตรากำไร
                  </span>
                </Label>
                <div className="relative">
                  <TrendingUp className="absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-400" />
                  <Input
                    id="markup"
                    type="number"
                    step="0.1"
                    placeholder="30"
                    value={markupPercentage}
                    onChange={(e) => setMarkupPercentage(e.target.value)}
                    className="pl-8 h-8 text-[12px] border-gray-200/60 bg-white rounded-lg"
                  />
                </div>
                <p className="text-[11px] text-gray-400">
                  เช่น: ถ้าต้นทุน 100 บาท และ markup 30% จะได้ราคาขาย 130 บาท
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="notes" className="text-[12px] text-gray-500">หมายเหตุ</Label>
                <Textarea
                  id="notes"
                  placeholder="หมายเหตุเพิ่มเติม..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="text-[12px] border-gray-200/60 bg-white rounded-lg"
                />
              </div>
            </div>

            {/* Calculate Button */}
            <div className="flex gap-2">
              <Button
                onClick={handleCalculate}
                disabled={calculateMutation.isPending}
                className="flex-1 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-[12px] h-9"
              >
                <Calculator className="h-3.5 w-3.5 mr-1.5" />
                {calculateMutation.isPending ? "กำลังคำนวณ..." : "คำนวณ"}
              </Button>

              {calculationResult && (
                <Button
                  onClick={handleSave}
                  disabled={saveCalculation.isPending}
                  variant="outline"
                  className="rounded-lg text-[12px] h-9 border-gray-200/60"
                >
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  บันทึก
                </Button>
              )}
            </div>
          </div>

          {/* Right Column - Results */}
          <div className="space-y-5">
            {/* Calculation Result */}
            {calculationResult && (
              <div className="border border-gray-200/60 rounded-xl p-4 space-y-3">
                <div>
                  <h2 className="text-[12px] font-medium text-gray-600">ผลการคำนวณ</h2>
                  <p className="text-[11px] text-gray-400">{calculationResult.name}</p>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[12px] text-gray-600">ต้นทุนวัตถุดิบ</span>
                    <span className="font-mono text-[13px] font-medium text-gray-800">
                      ฿{calculationResult.rawMaterialCost.toLocaleString()}
                    </span>
                  </div>
                  <div className="border-t border-gray-100 pt-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] text-gray-400">กำไร ({calculationResult.profitMargin.toFixed(1)}%)</span>
                      <span className="font-mono text-[12px] text-gray-600">
                        +฿{calculationResult.markupAmount.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div className="border-t border-gray-100 pt-3 mt-2 bg-gray-50 -mx-4 px-4 py-3 rounded-lg">
                    <div className="flex justify-between items-center">
                      <span className="text-[12px] font-medium text-gray-700">ราคาขายแนะนำ</span>
                      <span className="font-mono text-[16px] font-semibold text-gray-900">
                        ฿
                        {calculationResult.suggestedSellingPrice.toLocaleString()}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-400 mt-1 text-right">
                      น้ำหนักรวม: {calculationResult.batchSize.toLocaleString()} kg |
                      ต้นทุน/kg: ฿{calculationResult.costPerKg.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Saved Calculations */}
            <div className="border border-gray-200/60 rounded-xl">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="text-[12px] font-medium text-gray-600">การคำนวณที่บันทึกไว้</h2>
                <p className="text-[11px] text-gray-400">
                  {savedCalculations?.length || 0} รายการ
                </p>
              </div>
              <div className="p-3">
                {savedCalculations && savedCalculations.length > 0 ? (
                  <div className="space-y-1.5 max-h-96 overflow-y-auto">
                    {savedCalculations.map((calc: any) => (
                      <div
                        key={calc._id}
                        className="px-3 py-2.5 border border-gray-100 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => handleLoadCalculation(calc)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="text-[12px] font-medium text-gray-700 truncate">
                              {calc.name}
                            </div>
                            <div className="text-[11px] text-gray-400">
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
                            className="h-7 w-7 p-0 flex-shrink-0"
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
                            <Trash2 className="h-3.5 w-3.5 text-gray-400 hover:text-red-500" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-16">
                    <FileText className="h-8 w-8 mx-auto mb-2 text-gray-200" />
                    <p className="text-[12px] text-gray-400">ยังไม่มีการคำนวณที่บันทึกไว้</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ConsolePageShell>
  );
}
