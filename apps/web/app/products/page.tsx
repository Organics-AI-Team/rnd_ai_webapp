"use client";

import { useAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Package, Edit, Trash2, Search, ArrowUpDown, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useEffect, Suspense } from "react";
import React from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConsolePageShell, ConsoleSection } from "@/components/console_page_shell";

/**
 * ProductsContent — Main products management page (Cloudflare-minimal design).
 * Lists all raw materials/ingredients with CRUD operations.
 *
 * @returns JSX.Element - The products page content
 */
function ProductsContent() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const utils = trpc.useUtils();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [isDuplicateMode, setIsDuplicateMode] = useState(false);
  const [hasChangedDuplicate, setHasChangedDuplicate] = useState(false);
  const [searchInput, setSearchInput] = useState(""); // What user types
  const [searchTerm, setSearchTerm] = useState(""); // What's sent to server
  const [sortField, setSortField] = useState<string>("productCode");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  const [formData, setFormData] = useState({
    productName: "",
    inciName: "",
    description: "",
    price: "",
    supplier: "",
    benefits: "",
    details: "",
  });

  // Fetch next auto-generated code (only when form is open and not editing)
  const { data: nextCodeData, refetch: refetchNextCode } = trpc.products.getNextCode.useQuery(
    undefined,
    { enabled: showAddForm && !editingProduct }
  );

  // Handle duplicate mode on page load
  useEffect(() => {
    const isDuplicate = searchParams.get("duplicate") === "true";
    const duplicateData = searchParams.get("data");

    if (isDuplicate && duplicateData) {
      try {
        const data = JSON.parse(duplicateData);
        setIsDuplicateMode(true);
        setShowAddForm(true);
        setFormData({
          productName: data.productName || "",
          inciName: data.inci_name || "",
          description: data.description || "",
          price: data.price?.toString() || "",
          supplier: data.supplier || "",
          benefits: Array.isArray(data.benefits) ? data.benefits.join(", ") : "",
          details: Array.isArray(data.usecase) ? data.usecase.join(", ") : "",
        });
      } catch (error) {
        console.error("Error parsing duplicate data:", error);
      }
    }
  }, [searchParams]);

  const createProduct = trpc.products.create.useMutation({
    onSuccess: () => {
      utils.products.list.invalidate();
      utils.products.getNextCode.invalidate(); // Refresh next code
      setShowAddForm(false);
      setEditingProduct(null);
      setIsDuplicateMode(false);
      setHasChangedDuplicate(false);
      // Clear URL params
      router.replace("/products");
      setFormData({
        productName: "",
        inciName: "",
        description: "",
        price: "",
        supplier: "",
        benefits: "",
        details: "",
      });
    },
  });

  const updateProduct = trpc.products.update.useMutation({
    onSuccess: () => {
      utils.products.list.invalidate();
      setShowAddForm(false);
      setEditingProduct(null);
      setFormData({
        productName: "",
        inciName: "",
        description: "",
        price: "",
        supplier: "",
        benefits: "",
        details: "",
      });
    },
  });

  const deleteProduct = trpc.products.delete.useMutation({
    onSuccess: () => {
      utils.products.list.invalidate();
    },
  });

  const { data: productsData, isLoading: productsLoading } = trpc.products.list.useQuery({
    limit: itemsPerPage,
    offset: (currentPage - 1) * itemsPerPage,
    sortField,
    sortDirection,
    searchTerm,
  });

  const products = productsData?.products || [];
  const totalCount = productsData?.totalCount || 0;
  const totalPages = productsData?.totalPages || 1;
  const hasMore = productsData?.hasMore || false;

  // Reset to page 1 when search term, sort field, or sort direction changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, sortField, sortDirection]);

  /**
   * handleSearch — Commits the search input to the server-side query.
   */
  const handleSearch = () => {
    setSearchTerm(searchInput);
  };

  /**
   * handleKeyPress — Triggers search on Enter key.
   * @param e - Keyboard event from the search input
   */
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  // No client-side filtering or sorting needed - server handles it
  const filteredAndSortedProducts = products;

  if (isLoading || productsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400 mx-auto"></div>
          <p className="mt-3 text-[12px] text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="max-w-sm rounded-xl border border-gray-200/60 bg-white p-6 text-center shadow-sm">
          <p className="text-[13px] font-medium text-red-600 mb-3">กรุณาเข้าสู่ระบบ</p>
          <p className="text-[12px] text-gray-500 mb-4">
            คุณต้องเข้าสู่ระบบก่อนเข้าใช้งานหน้านี้
          </p>
          <Button
            onClick={() => router.push("/login")}
            className="h-8 text-[12px] bg-gray-900 hover:bg-gray-800 text-white rounded-lg"
          >
            ไปหน้าเข้าสู่ระบบ
          </Button>
        </div>
      </div>
    );
  }

  if (user.role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="max-w-sm rounded-xl border border-gray-200/60 bg-white p-6 text-center shadow-sm">
          <p className="text-[13px] font-medium text-red-600 mb-3">Access Denied</p>
          <p className="text-[12px] text-gray-500 mb-4">
            Only administrators can access this page.
          </p>
          <Button
            onClick={() => router.push("/ingredients")}
            className="h-8 text-[12px] bg-gray-900 hover:bg-gray-800 text-white rounded-lg"
          >
            ไปที่สารทั้งหมด
          </Button>
        </div>
      </div>
    );
  }

  /**
   * handleFormChange — Updates form field and tracks duplicate-mode changes.
   * @param field - The form field key to update
   * @param value - The new value for the field
   */
  const handleFormChange = (field: string, value: string) => {
    setFormData({ ...formData, [field]: value });
    if (isDuplicateMode && !hasChangedDuplicate) {
      setHasChangedDuplicate(true);
    }
  };

  /**
   * handleEdit — Populates the form with an existing product for editing.
   * @param product - The product object to edit
   */
  const handleEdit = (product: any) => {
    setEditingProduct(product);
    setFormData({
      productName: product.productName,
      inciName: product.inci_name || "",
      description: product.description || "",
      price: product.price?.toString() || "",
      supplier: product.supplier || "",
      benefits: product.benefits || "",
      details: product.details || "",
    });
    setShowAddForm(true);
  };

  /**
   * handleSubmit — Creates or updates a product based on current form state.
   * @param e - Form submit event
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Check if in duplicate mode and no changes made
    if (isDuplicateMode && !hasChangedDuplicate) {
      alert("กรุณาแก้ไขข้อมูลก่อนบันทึก เพื่อหลีกเลี่ยงการสร้างสารที่ซ้ำกัน");
      return;
    }

    try {
      if (editingProduct) {
        await updateProduct.mutateAsync({
          id: editingProduct._id,
          productCode: editingProduct.productCode, // Keep existing code for updates
          productName: formData.productName,
          inciName: formData.inciName,
          description: formData.description,
          price: formData.price ? parseFloat(formData.price) : undefined,
          supplier: formData.supplier,
          benefits: formData.benefits,
          details: formData.details,
        });
        alert("อัปเดตสารเรียบร้อยแล้ว!");
      } else {
        await createProduct.mutateAsync({
          productName: formData.productName,
          inciName: formData.inciName,
          description: formData.description,
          price: formData.price ? parseFloat(formData.price) : undefined,
          supplier: formData.supplier,
          benefits: formData.benefits,
          details: formData.details,
        });
        alert("เพิ่มสารเรียบร้อยแล้ว!");
      }
    } catch (error: any) {
      alert(error.message || (editingProduct ? "ไม่สามารถอัปเดตสารได้" : "ไม่สามารถเพิ่มสารได้"));
    }
  };

  /**
   * handleDelete — Deletes a product after user confirmation.
   * @param id - The product ID to delete
   * @param name - The product name (shown in confirmation dialog)
   */
  const handleDelete = async (id: string, name: string) => {
    if (confirm(`คุณแน่ใจหรือไม่ที่จะลบ "${name}"?`)) {
      try {
        await deleteProduct.mutateAsync({ id });
        alert("ลบสารเรียบร้อยแล้ว!");
      } catch (error: any) {
        alert(error.message || "ไม่สามารถลบสารได้");
      }
    }
  };

  /**
   * handleToggleAddForm — Toggles the add-product form visibility and resets state.
   */
  const handleToggleAddForm = () => {
    setEditingProduct(null);
    setIsDuplicateMode(false);
    setHasChangedDuplicate(false);
    router.replace("/products");
    setFormData({
      productName: "",
      inciName: "",
      description: "",
      price: "",
      supplier: "",
      benefits: "",
      details: "",
    });
    if (!showAddForm) {
      // Opening form - fetch next code
      refetchNextCode();
    }
    setShowAddForm(!showAddForm);
  };

  return (
    <ConsolePageShell
      title="เพิ่มสารใหม่"
      subtitle={`${totalCount.toLocaleString()} สาร`}
      action_label="เพิ่มสารใหม่"
      on_action={handleToggleAddForm}
      show_action={user.role === "admin"}
    >
      {/* Add Product Form */}
      {showAddForm && (
        <ConsoleSection
          title={isDuplicateMode ? "ทำซ้ำสาร" : editingProduct ? "แก้ไขสาร" : "เพิ่มสารใหม่"}
          subtitle={
            isDuplicateMode
              ? "กรุณาแก้ไขข้อมูลก่อนบันทึก เพื่อหลีกเลี่ยงการสร้างสารที่ซ้ำกัน"
              : editingProduct
              ? "อัปเดตรายละเอียดสาร"
              : "กรอกรายละเอียดสารเพื่อเพิ่มเข้าคลัง"
          }
          className="border-b border-gray-100"
        >
          <div className="px-4 py-4">
            {isDuplicateMode && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-orange-200/80 bg-orange-50/50 px-3 py-2.5">
                <AlertCircle className="h-3.5 w-3.5 text-orange-500 mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-orange-700">
                  <span className="font-medium">โหมดทำซ้ำสาร:</span> คุณต้องแก้ไขข้อมูลอย่างน้อย 1 ฟิลด์ก่อนบันทึก
                  {hasChangedDuplicate && (
                    <span className="ml-2 text-green-600 font-medium">&#10003; ตรวจพบการเปลี่ยนแปลง</span>
                  )}
                </p>
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="productCode" className="text-[11px] text-gray-500">รหัสสาร (สร้างอัตโนมัติ)</Label>
                  <Input
                    id="productCode"
                    value={editingProduct ? editingProduct.productCode : nextCodeData?.nextCode || "กำลังโหลด..."}
                    disabled
                    className="border-gray-200/60 bg-gray-50 rounded-lg text-[12px] font-mono font-semibold cursor-not-allowed h-8"
                  />
                  {!editingProduct && (
                    <p className="text-[10px] text-gray-400">
                      รหัสสารนี้จะถูกบันทึกเมื่อกดปุ่ม &quot;เพิ่มสาร&quot;
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="productName" className="text-[11px] text-gray-500">ชื่อสาร *</Label>
                  <Input
                    id="productName"
                    placeholder="กรอกชื่อสาร"
                    value={formData.productName}
                    onChange={(e) => handleFormChange("productName", e.target.value)}
                    required
                    className="border-gray-200/60 bg-white rounded-lg text-[12px] h-8"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="inciName" className="text-[11px] text-gray-500">INCI Name</Label>
                <Textarea
                  id="inciName"
                  placeholder="INCI name (ไม่บังคับ)"
                  value={formData.inciName}
                  onChange={(e) => handleFormChange("inciName", e.target.value)}
                  rows={2}
                  className="border-gray-200/60 bg-white rounded-lg text-[12px]"
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="supplier" className="text-[11px] text-gray-500">Supplier</Label>
                  <Input
                    id="supplier"
                    type="text"
                    placeholder="ชื่อผู้จัดหา"
                    value={formData.supplier}
                    onChange={(e) => handleFormChange("supplier", e.target.value)}
                    className="border-gray-200/60 bg-white rounded-lg text-[12px] h-8"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="price" className="text-[11px] text-gray-500">ราคา (฿)</Label>
                  <Input
                    id="price"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={formData.price}
                    onChange={(e) => handleFormChange("price", e.target.value)}
                    className="border-gray-200/60 bg-white rounded-lg text-[12px] h-8"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="benefits" className="text-[11px] text-gray-500">Benefits (ประโยชน์)</Label>
                <Textarea
                  id="benefits"
                  placeholder="ประโยชน์ของสาร"
                  value={formData.benefits}
                  onChange={(e) => handleFormChange("benefits", e.target.value)}
                  rows={3}
                  className="border-gray-200/60 bg-white rounded-lg text-[12px]"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="details" className="text-[11px] text-gray-500">Details (รายละเอียดเพิ่มเติม)</Label>
                <Textarea
                  id="details"
                  placeholder="รายละเอียดเพิ่มเติม"
                  value={formData.details}
                  onChange={(e) => handleFormChange("details", e.target.value)}
                  rows={3}
                  className="border-gray-200/60 bg-white rounded-lg text-[12px]"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  type="submit"
                  disabled={createProduct.isPending || updateProduct.isPending}
                  className="h-8 text-[12px] px-3 bg-gray-900 hover:bg-gray-800 text-white rounded-lg"
                >
                  {editingProduct
                    ? (updateProduct.isPending ? "กำลังอัปเดต..." : "อัปเดตสาร")
                    : (createProduct.isPending ? "กำลังเพิ่ม..." : "เพิ่มสาร")
                  }
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowAddForm(false);
                    setEditingProduct(null);
                    setIsDuplicateMode(false);
                    setHasChangedDuplicate(false);
                    setFormData({
                      productName: "",
                      inciName: "",
                      description: "",
                      price: "",
                      supplier: "",
                      benefits: "",
                      details: "",
                    });
                    // Clear URL params if in duplicate mode
                    if (isDuplicateMode) {
                      router.replace("/products");
                    }
                  }}
                  className="h-8 text-[12px] px-3 text-gray-500 hover:text-gray-700"
                >
                  ยกเลิก
                </Button>
              </div>
            </form>
          </div>
        </ConsoleSection>
      )}

      {/* Search and Sort Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-[#fafafa] border-b border-gray-100/80">
        <div className="flex-1 flex gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <Input
              placeholder="ค้นหา รหัสสาร, ชื่อสาร, INCI, CAS No., Benefits, Use Cases..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyPress={handleKeyPress}
              className="pl-8 h-8 text-[12px] border-gray-200/60 bg-white rounded-lg"
            />
          </div>
          <Button
            onClick={handleSearch}
            className="h-8 text-[11px] px-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-lg"
          >
            <Search className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sortField}
            onChange={(e) => setSortField(e.target.value)}
            className="h-8 px-2.5 border border-gray-200/60 rounded-lg text-[12px] bg-white text-gray-600"
          >
            <option value="productCode">รหัสสาร</option>
            <option value="productName">ชื่อสาร</option>
            <option value="supplier">Supplier</option>
            <option value="price">ราคา</option>
          </select>
          <Button
            variant="ghost"
            onClick={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")}
            className="h-8 text-[11px] px-2 text-gray-500 hover:text-gray-700"
          >
            <ArrowUpDown className="h-3.5 w-3.5 mr-1" />
            {sortDirection === "asc" ? "A-Z" : "Z-A"}
          </Button>
        </div>
      </div>

      {/* Products Table */}
      {filteredAndSortedProducts && filteredAndSortedProducts.length > 0 ? (
        <>
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-100/80 hover:bg-transparent">
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">รหัสสาร</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">ชื่อสาร (Trade Name)</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">INCI Name</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">CAS No.</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Supplier</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Price (฿)</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider max-w-xs">Benefits</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider max-w-xs">Use Cases</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAndSortedProducts.map((product: any) => (
                <TableRow key={product._id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <TableCell className="font-mono text-[12px] text-gray-600">
                    {product.productCode}
                  </TableCell>
                  <TableCell className="text-[12px] font-medium text-gray-800">
                    {product.productName}
                  </TableCell>
                  <TableCell className="text-[12px] text-gray-500">
                    {product.inci_name || "-"}
                  </TableCell>
                  <TableCell className="text-[12px] font-mono text-gray-500">
                    {product.cas_no || "-"}
                  </TableCell>
                  <TableCell className="text-[12px] text-gray-600">
                    {product.supplier || "-"}
                  </TableCell>
                  <TableCell className="text-[12px] font-mono text-gray-600">
                    {product.price > 0 ? product.price.toLocaleString() : "-"}
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <div className="flex flex-wrap gap-1">
                      {Array.isArray(product.benefits) && product.benefits.length > 0 ? (
                        product.benefits.map((benefit: string, idx: number) => (
                          <Badge
                            key={idx}
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 font-normal text-gray-500 border-gray-200/80 bg-gray-50/50"
                          >
                            {benefit}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-[11px] text-gray-300">-</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <div className="flex flex-wrap gap-1">
                      {Array.isArray(product.usecase) && product.usecase.length > 0 ? (
                        product.usecase.map((usecase: string, idx: number) => (
                          <Badge
                            key={idx}
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 font-normal text-gray-500 border-gray-200/80 bg-gray-50/50"
                          >
                            {usecase}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-[11px] text-gray-300">-</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleEdit(product)}
                        className="h-7 w-7 p-0 text-gray-400 hover:text-gray-600"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          handleDelete(product._id, product.productName)
                        }
                        className="h-7 w-7 p-0 text-gray-400 hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100/80">
              <span className="text-[11px] text-gray-400">
                แสดง {(currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, totalCount)} จากทั้งหมด {totalCount.toLocaleString()} สาร
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="h-7 text-[11px] px-2 text-gray-500 hover:text-gray-700 disabled:text-gray-300"
                >
                  <ChevronLeft className="h-3.5 w-3.5 mr-0.5" />
                  ก่อนหน้า
                </Button>
                <span className="text-[11px] text-gray-400">
                  หน้า {currentPage} / {totalPages}
                </span>
                <Button
                  variant="ghost"
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={!hasMore}
                  className="h-7 text-[11px] px-2 text-gray-500 hover:text-gray-700 disabled:text-gray-300"
                >
                  ถัดไป
                  <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-16">
          <Package className="h-10 w-10 text-gray-200 mx-auto mb-3" />
          <p className="text-[12px] text-gray-400 mb-1">ยังไม่มีวัตถุดิบ</p>
          <p className="text-[11px] text-gray-300">
            คลิก &quot;เพิ่มสารใหม่&quot; เพื่อเพิ่มวัตถุดิบใหม่
          </p>
        </div>
      )}
    </ConsolePageShell>
  );
}

/**
 * ProductsPage — Suspense-wrapped entry point for the products page.
 * @returns JSX.Element - The products page with Suspense boundary
 */
export default function ProductsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400 mx-auto"></div>
          <p className="mt-3 text-[12px] text-gray-400">Loading...</p>
        </div>
      </div>
    }>
      <ProductsContent />
    </Suspense>
  );
}
