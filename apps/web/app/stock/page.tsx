"use client";

/**
 * Stock Management Page — Cloudflare-minimal design
 *
 * Allows users to:
 * - Add stock entries for raw materials with quantity, price, expiration
 * - View all stock entries with filtering and pagination
 * - View stock summary aggregated by material
 * - Edit and delete stock entries
 */

import { useAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ConsolePageShell, ConsoleSection } from "@/components/console_page_shell";
import { useRouter } from "next/navigation";
import {
  Package,
  Edit,
  Trash2,
  Search,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Calendar,
  DollarSign,
  Weight,
  X,
} from "lucide-react";
import { useState, Suspense } from "react";
import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * StockContent — Inner component containing all stock management logic.
 * Wrapped in Suspense by the default export.
 */
function StockContent() {
  console.log("[stock] StockContent mounting");

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

  console.log("[stock] state:", {
    showAddForm,
    editingStock: editingStock?._id,
    statusFilter,
    currentPage,
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

  console.log(`[stock] loaded ${stockEntries.length} entries (total: ${totalCount})`);

  // ---------- Mutations ----------

  /**
   * Resets all form fields and selection state to defaults.
   */
  const resetForm = () => {
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
  };

  const createStock = trpc.stock.create.useMutation({
    onSuccess: () => {
      console.log("[stock] created successfully");
      utils.stock.list.invalidate();
      utils.stock.summary.invalidate();
      setShowAddForm(false);
      resetForm();
    },
    onError: (error) => {
      console.error("[stock] create error:", error);
    },
  });

  const updateStock = trpc.stock.update.useMutation({
    onSuccess: () => {
      console.log("[stock] updated successfully");
      utils.stock.list.invalidate();
      utils.stock.summary.invalidate();
      setShowAddForm(false);
      setEditingStock(null);
      resetForm();
    },
    onError: (error) => {
      console.error("[stock] update error:", error);
    },
  });

  const deleteStock = trpc.stock.delete.useMutation({
    onSuccess: () => {
      console.log("[stock] deleted successfully");
      utils.stock.list.invalidate();
      utils.stock.summary.invalidate();
    },
    onError: (error) => {
      console.error("[stock] delete error:", error);
    },
  });

  // Reset to page 1 when filters change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, materialFilter, sortField, sortDirection]);

  // ---------- Loading / auth guards ----------

  if (isLoading || stockLoading) {
    console.log("[stock] loading...");
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-gray-600" />
      </div>
    );
  }

  if (!user) {
    console.log("[stock] user not authenticated");
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-[12px] text-gray-500 mb-3">กรุณาเข้าสู่ระบบ</p>
          <Button
            size="sm"
            onClick={() => router.push("/login")}
            className="h-7 text-[11px] px-3 bg-gray-900 hover:bg-gray-800 text-white rounded-lg"
          >
            ไปหน้าเข้าสู่ระบบ
          </Button>
        </div>
      </div>
    );
  }

  if (user.role !== "admin") {
    console.log("[stock] access denied — role:", user.role);
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-[12px] text-red-500 mb-1">ไม่มีสิทธิ์เข้าถึง</p>
          <p className="text-[11px] text-gray-400 mb-3">เฉพาะผู้ดูแลระบบเท่านั้น</p>
          <Button
            size="sm"
            onClick={() => router.push("/ingredients")}
            className="h-7 text-[11px] px-3 bg-gray-900 hover:bg-gray-800 text-white rounded-lg"
          >
            ไปที่สารทั้งหมด
          </Button>
        </div>
      </div>
    );
  }

  // ---------- Handlers ----------

  /**
   * Updates a single form field value.
   *
   * @param field - Form field key
   * @param value - New value
   */
  const handleFormChange = (field: string, value: string) => {
    setFormData({ ...formData, [field]: value });
  };

  /**
   * Populates the edit form with an existing stock entry.
   *
   * @param stock - Stock entry to edit
   */
  const handleEdit = (stock: any) => {
    console.log("[stock] editing:", stock._id);
    setEditingStock(stock);
    setSelectedMaterial({
      _id: stock.materialId,
      code: stock.materialCode,
      name: stock.materialName,
    });
    setFormData({
      quantityKg: stock.quantityKg.toString(),
      unitPrice: stock.unitPrice.toString(),
      expirationDate: stock.expirationDate
        ? new Date(stock.expirationDate).toISOString().split("T")[0]
        : "",
      batchNumber: stock.batchNumber || "",
      supplier: stock.supplier || "",
      notes: stock.notes || "",
    });
    setShowAddForm(true);
  };

  /**
   * Submits the add/edit stock form.
   *
   * @param e - Form submission event
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log("[stock] submitting form", { editing: !!editingStock });

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
      console.error("[stock] submit error:", error);
      alert(
        error.message ||
          (editingStock ? "ไม่สามารถอัปเดตสต็อกได้" : "ไม่สามารถเพิ่มสต็อกได้")
      );
    }
  };

  /**
   * Deletes a stock entry after user confirmation.
   *
   * @param id           - Stock entry ID
   * @param materialName - Material name (for confirmation message)
   */
  const handleDelete = async (id: string, materialName: string) => {
    console.log("[stock] deleting:", id);
    if (confirm(`คุณแน่ใจหรือไม่ที่จะลบสต็อก "${materialName}"?`)) {
      try {
        await deleteStock.mutateAsync({ id });
        alert("ลบสต็อกเรียบร้อยแล้ว!");
      } catch (error: any) {
        console.error("[stock] delete error:", error);
        alert(error.message || "ไม่สามารถลบสต็อกได้");
      }
    }
  };

  /**
   * Formats a date string to Thai locale short format.
   *
   * @param dateString - ISO date string
   * @returns Formatted date or "-"
   */
  const formatDate = (dateString: string) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    return date.toLocaleDateString("th-TH");
  };

  /**
   * Checks if a date is within 30 days of today.
   *
   * @param dateString - ISO date string
   * @returns true if expiring within 30 days
   */
  const isExpiringSoon = (dateString: string) => {
    if (!dateString) return false;
    const expirationDate = new Date(dateString);
    const today = new Date();
    const daysUntilExpiration = Math.floor(
      (expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );
    return daysUntilExpiration <= 30 && daysUntilExpiration >= 0;
  };

  /**
   * Checks if a date is in the past.
   *
   * @param dateString - ISO date string
   * @returns true if expired
   */
  const isExpired = (dateString: string) => {
    if (!dateString) return false;
    const expirationDate = new Date(dateString);
    const today = new Date();
    return expirationDate < today;
  };

  /**
   * Opens the add-stock form with a clean state.
   */
  const handleOpenAddForm = () => {
    console.log("[stock] opening add form");
    setEditingStock(null);
    resetForm();
    setShowAddForm(!showAddForm);
  };

  console.log("[stock] rendering");

  return (
    <ConsolePageShell
      title="Stock Management"
      subtitle={`${totalCount.toLocaleString()} entries`}
      action_label="Add Stock"
      on_action={handleOpenAddForm}
    >
      {/* ── Add / Edit Form ── */}
      {showAddForm && (
        <div className="border-b border-gray-100">
          <div className="px-4 py-3">
            <div className="border border-gray-200/60 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-[13px] font-medium text-gray-800">
                    {editingStock ? "แก้ไขสต็อก" : "เพิ่มสต็อก"}
                  </h3>
                  <p className="text-[11px] text-gray-400">
                    {editingStock
                      ? "อัปเดตรายละเอียดสต็อก"
                      : "เลือกวัตถุดิบและกรอกรายละเอียดสต็อก"}
                  </p>
                </div>
                <button
                  onClick={() => {
                    console.log("[stock] closing form");
                    setShowAddForm(false);
                    setEditingStock(null);
                    resetForm();
                  }}
                  className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3">
                {/* Material Selection */}
                {!editingStock && (
                  <div className="space-y-1">
                    <Label htmlFor="material" className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                      วัตถุดิบ *
                    </Label>
                    <div className="relative">
                      <Input
                        id="material"
                        placeholder="ค้นหาวัตถุดิบ..."
                        value={
                          selectedMaterial
                            ? `${selectedMaterial.code} - ${selectedMaterial.name}`
                            : materialSearch
                        }
                        onChange={(e) => {
                          setMaterialSearch(e.target.value);
                          setShowMaterialDropdown(true);
                          if (selectedMaterial) setSelectedMaterial(null);
                        }}
                        onFocus={() => setShowMaterialDropdown(true)}
                        className="h-8 text-[12px] border-gray-200/60 rounded-lg"
                        required
                      />
                      {showMaterialDropdown &&
                        materialsData &&
                        materialsData.length > 0 &&
                        !selectedMaterial && (
                          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200/60 rounded-lg shadow-lg max-h-60 overflow-auto">
                            {materialsData.map((material: any) => (
                              <div
                                key={material._id}
                                className="px-3 py-2 hover:bg-gray-50/80 cursor-pointer border-b border-gray-50 last:border-0"
                                onClick={() => {
                                  console.log("[stock] material selected:", material.code);
                                  setSelectedMaterial(material);
                                  setMaterialSearch("");
                                  setShowMaterialDropdown(false);
                                }}
                              >
                                <div className="text-[12px] font-medium text-gray-700">
                                  {material.code} - {material.name}
                                </div>
                                {material.inci && (
                                  <div className="text-[11px] text-gray-400">{material.inci}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                    </div>
                  </div>
                )}

                {editingStock && (
                  <div className="space-y-1">
                    <Label className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                      วัตถุดิบ
                    </Label>
                    <Input
                      value={`${selectedMaterial?.code} - ${selectedMaterial?.name}`}
                      disabled
                      className="h-8 text-[12px] bg-gray-50 cursor-not-allowed border-gray-200/60 rounded-lg"
                    />
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="quantityKg" className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                      ปริมาณ (kg) *
                    </Label>
                    <div className="relative">
                      <Weight className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-300" />
                      <Input
                        id="quantityKg"
                        type="number"
                        step="0.01"
                        placeholder="200.00"
                        value={formData.quantityKg}
                        onChange={(e) => handleFormChange("quantityKg", e.target.value)}
                        className="h-8 text-[12px] pl-8 border-gray-200/60 rounded-lg"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="unitPrice" className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                      ราคาต่อ kg (฿) *
                    </Label>
                    <div className="relative">
                      <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-300" />
                      <Input
                        id="unitPrice"
                        type="number"
                        step="0.01"
                        placeholder="150.00"
                        value={formData.unitPrice}
                        onChange={(e) => handleFormChange("unitPrice", e.target.value)}
                        className="h-8 text-[12px] pl-8 border-gray-200/60 rounded-lg"
                        required
                      />
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="expirationDate" className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                      วันหมดอายุ *
                    </Label>
                    <div className="relative">
                      <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-300" />
                      <Input
                        id="expirationDate"
                        type="date"
                        value={formData.expirationDate}
                        onChange={(e) => handleFormChange("expirationDate", e.target.value)}
                        className="h-8 text-[12px] pl-8 border-gray-200/60 rounded-lg"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="batchNumber" className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                      Batch Number
                    </Label>
                    <Input
                      id="batchNumber"
                      placeholder="B20250101"
                      value={formData.batchNumber}
                      onChange={(e) => handleFormChange("batchNumber", e.target.value)}
                      className="h-8 text-[12px] border-gray-200/60 rounded-lg"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="supplier" className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                    ผู้จัดหา
                  </Label>
                  <Input
                    id="supplier"
                    placeholder="ชื่อผู้จัดหา"
                    value={formData.supplier}
                    onChange={(e) => handleFormChange("supplier", e.target.value)}
                    className="h-8 text-[12px] border-gray-200/60 rounded-lg"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="notes" className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                    หมายเหตุ
                  </Label>
                  <Textarea
                    id="notes"
                    placeholder="หมายเหตุเพิ่มเติม..."
                    value={formData.notes}
                    onChange={(e) => handleFormChange("notes", e.target.value)}
                    rows={2}
                    className="text-[12px] border-gray-200/60 rounded-lg resize-none"
                  />
                </div>

                {/* Calculated total */}
                {formData.quantityKg && formData.unitPrice && (
                  <div className="px-3 py-2 bg-gray-50 border border-gray-200/60 rounded-lg">
                    <span className="text-[11px] text-gray-500">ราคารวม: </span>
                    <span className="text-[12px] font-medium text-gray-800">
                      ฿
                      {(
                        parseFloat(formData.quantityKg) * parseFloat(formData.unitPrice)
                      ).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={createStock.isPending || updateStock.isPending}
                    className="h-7 text-[11px] px-3 bg-gray-900 hover:bg-gray-800 text-white rounded-lg"
                  >
                    {editingStock
                      ? updateStock.isPending
                        ? "กำลังอัปเดต..."
                        : "อัปเดตสต็อก"
                      : createStock.isPending
                        ? "กำลังเพิ่ม..."
                        : "เพิ่มสต็อก"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      console.log("[stock] cancelling form");
                      setShowAddForm(false);
                      setEditingStock(null);
                      resetForm();
                    }}
                    className="h-7 text-[11px] px-3 rounded-lg border-gray-200/60"
                  >
                    ยกเลิก
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Summary stat cards ── */}
      {summaryData && summaryData.length > 0 && (
        <div className="grid grid-cols-3 border-b border-gray-50">
          <div className="px-4 py-3 border-r border-gray-50">
            <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">วัตถุดิบที่มีสต็อก</p>
            <p className="text-[16px] font-semibold text-gray-800 mt-0.5">{summaryData.length}</p>
            <p className="text-[11px] text-gray-400">ประเภท</p>
          </div>
          <div className="px-4 py-3 border-r border-gray-50">
            <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">ปริมาณทั้งหมด</p>
            <p className="text-[16px] font-semibold text-gray-800 mt-0.5">
              {summaryData
                .reduce((sum: number, item: any) => sum + item.totalQuantityKg, 0)
                .toLocaleString()}{" "}
              kg
            </p>
            <p className="text-[11px] text-gray-400">น้ำหนักรวม</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">มูลค่าทั้งหมด</p>
            <p className="text-[16px] font-semibold text-gray-800 mt-0.5">
              ฿
              {summaryData
                .reduce((sum: number, item: any) => sum + item.totalValue, 0)
                .toLocaleString()}
            </p>
            <p className="text-[11px] text-gray-400">มูลค่ารวม</p>
          </div>
        </div>
      )}

      {/* ── Summary table — aggregated by material ── */}
      {summaryData && summaryData.length > 0 && (
        <ConsoleSection
          title="สรุปสต็อกแยกตามวัตถุดิบ"
          subtitle="ยอดรวมสต็อกของแต่ละวัตถุดิบ (รวมทุก Batch)"
        >
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-50 hover:bg-transparent">
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">รหัส</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">ชื่อวัตถุดิบ</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider text-right">ปริมาณ (kg)</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider text-right">มูลค่า (฿)</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider text-right">เฉลี่ย/kg</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider text-center">Batch</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">หมดอายุใกล้สุด</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider text-center">ดู</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaryData.map((summary: any) => {
                const isExpiringSoonSummary =
                  summary.nearestExpiration && isExpiringSoon(summary.nearestExpiration);
                const isExpiredSummary =
                  summary.nearestExpiration && isExpired(summary.nearestExpiration);

                return (
                  <TableRow
                    key={summary.materialId}
                    className="border-b border-gray-50 hover:bg-gray-50/50"
                  >
                    <TableCell className="text-[12px] font-mono text-gray-600">
                      {summary.materialCode}
                    </TableCell>
                    <TableCell className="text-[12px] font-medium text-gray-700">
                      {summary.materialName}
                    </TableCell>
                    <TableCell className="text-[12px] font-mono text-right text-gray-700">
                      {summary.totalQuantityKg.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell className="text-[12px] font-mono text-right text-gray-700">
                      {summary.totalValue.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell className="text-[12px] font-mono text-right text-gray-500">
                      {summary.averagePrice.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="text-[10px] bg-gray-50/80 border-gray-200/60 text-gray-500">
                        {summary.batchCount}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] text-gray-600">
                          {summary.nearestExpiration
                            ? formatDate(summary.nearestExpiration)
                            : "-"}
                        </span>
                        {isExpiredSummary && (
                          <Badge className="text-[9px] px-1.5 py-0 bg-red-50 text-red-600 border border-red-200/60 hover:bg-red-50">
                            หมดอายุ
                          </Badge>
                        )}
                        {!isExpiredSummary && isExpiringSoonSummary && (
                          <Badge className="text-[9px] px-1.5 py-0 bg-amber-50 text-amber-600 border border-amber-200/60 hover:bg-amber-50">
                            ใกล้หมดอายุ
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <button
                        onClick={() => {
                          console.log("[stock] filtering by material:", summary.materialId);
                          setMaterialFilter(summary.materialId);
                          document
                            .getElementById("detailed-entries-section")
                            ?.scrollIntoView({ behavior: "smooth" });
                        }}
                        className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700 transition-colors"
                      >
                        <Search className="h-3 w-3" />
                        ดู
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </ConsoleSection>
      )}

      {/* ── Detailed entries — per-batch ── */}
      <div id="detailed-entries-section">
        {/* Filter toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-50 bg-[#fafafa] flex-wrap">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[11px] text-gray-400 flex-shrink-0">รายการสต็อก</span>
            {materialFilter ? (
              <button
                onClick={() => setMaterialFilter("")}
                className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700 transition-colors bg-white border border-gray-200/60 rounded-md px-1.5 py-0.5"
              >
                <X className="h-2.5 w-2.5" />
                ล้างตัวกรอง
              </button>
            ) : (
              <span className="text-[11px] text-gray-300">
                {totalCount.toLocaleString()} รายการ
              </span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="h-7 px-2 border border-gray-200/60 rounded-lg text-[11px] bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-gray-300"
            >
              <option value="all">ทั้งหมด</option>
              <option value="active">ใช้งานได้</option>
              <option value="expired">หมดอายุ</option>
              <option value="depleted">หมดแล้ว</option>
            </select>

            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value)}
              className="h-7 px-2 border border-gray-200/60 rounded-lg text-[11px] bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-gray-300"
            >
              <option value="createdAt">วันที่เพิ่ม</option>
              <option value="expirationDate">วันหมดอายุ</option>
              <option value="materialName">ชื่อวัตถุดิบ</option>
              <option value="quantityKg">ปริมาณ</option>
            </select>

            <button
              onClick={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")}
              className="h-7 px-2 border border-gray-200/60 rounded-lg text-[11px] bg-white text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-1"
            >
              <ArrowUpDown className="h-3 w-3" />
              {sortDirection === "asc" ? "น้อย-มาก" : "มาก-น้อย"}
            </button>
          </div>
        </div>

        {/* Table */}
        {stockEntries && stockEntries.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow className="border-b border-gray-50 hover:bg-transparent">
                  <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">รหัส</TableHead>
                  <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">ชื่อวัตถุดิบ</TableHead>
                  <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">ปริมาณ (kg)</TableHead>
                  <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">ราคา/kg</TableHead>
                  <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">ราคารวม</TableHead>
                  <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">หมดอายุ</TableHead>
                  <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Batch</TableHead>
                  <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">ผู้จัดหา</TableHead>
                  <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">สถานะ</TableHead>
                  <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stockEntries.map((stock: any) => (
                  <TableRow key={stock._id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <TableCell className="text-[12px] font-mono text-gray-600">
                      {stock.materialCode}
                    </TableCell>
                    <TableCell className="text-[12px] font-medium text-gray-700">
                      {stock.materialName}
                    </TableCell>
                    <TableCell className="text-[12px] font-mono text-gray-600">
                      {stock.quantityKg.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-[12px] font-mono text-gray-600">
                      {stock.unitPrice.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-[12px] font-mono font-medium text-gray-700">
                      {stock.totalCost.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] text-gray-600">
                          {formatDate(stock.expirationDate)}
                        </span>
                        {isExpired(stock.expirationDate) && (
                          <Badge className="text-[9px] px-1.5 py-0 bg-red-50 text-red-600 border border-red-200/60 hover:bg-red-50">
                            หมดอายุ
                          </Badge>
                        )}
                        {!isExpired(stock.expirationDate) &&
                          isExpiringSoon(stock.expirationDate) && (
                            <Badge className="text-[9px] px-1.5 py-0 bg-amber-50 text-amber-600 border border-amber-200/60 hover:bg-amber-50">
                              ใกล้หมดอายุ
                            </Badge>
                          )}
                      </div>
                    </TableCell>
                    <TableCell className="text-[12px] text-gray-500">
                      {stock.batchNumber || "-"}
                    </TableCell>
                    <TableCell className="text-[12px] text-gray-500">
                      {stock.supplier || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`text-[10px] px-1.5 py-0 border ${
                          stock.status === "active"
                            ? "bg-emerald-50 text-emerald-600 border-emerald-200/60 hover:bg-emerald-50"
                            : stock.status === "expired"
                              ? "bg-red-50 text-red-600 border-red-200/60 hover:bg-red-50"
                              : "bg-gray-50 text-gray-500 border-gray-200/60 hover:bg-gray-50"
                        }`}
                      >
                        {stock.status === "active"
                          ? "ใช้งานได้"
                          : stock.status === "expired"
                            ? "หมดอายุ"
                            : "หมดแล้ว"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => handleEdit(stock)}
                          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(stock._id, stock.materialName)}
                          className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-2 border-t border-gray-50">
                <span className="text-[11px] text-gray-400">
                  {(currentPage - 1) * itemsPerPage + 1}-
                  {Math.min(currentPage * itemsPerPage, totalCount)} of{" "}
                  {totalCount.toLocaleString()}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="h-7 px-2 border border-gray-200/60 rounded-lg text-[11px] text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                  >
                    <ChevronLeft className="h-3 w-3" />
                    ก่อนหน้า
                  </button>
                  <span className="text-[11px] text-gray-400 px-1">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={!hasMore}
                    className="h-7 px-2 border border-gray-200/60 rounded-lg text-[11px] text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                  >
                    ถัดไป
                    <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Empty state */
          <div className="py-16 text-center">
            <Package className="h-8 w-8 text-gray-200 mx-auto mb-3" />
            <p className="text-[12px] text-gray-400">ยังไม่มีสต็อก</p>
            <p className="text-[11px] text-gray-300 mt-0.5">
              คลิก &quot;Add Stock&quot; เพื่อเพิ่มสต็อกวัตถุดิบใหม่
            </p>
          </div>
        )}
      </div>
    </ConsolePageShell>
  );
}

/**
 * StockPage — Default export with Suspense boundary.
 */
export default function StockPage() {
  console.log("[stock] page rendering");
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-gray-600" />
        </div>
      }
    >
      <StockContent />
    </Suspense>
  );
}
