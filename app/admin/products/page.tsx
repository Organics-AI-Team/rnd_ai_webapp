"use client";

import { useAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc-client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRouter, useSearchParams } from "next/navigation";
import { BoxIcon, ArrowLeft, Plus, Package, Edit, Trash2, Search, ArrowUpDown, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useEffect, Suspense } from "react";
import React from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

function AdminProductsPageContent() {
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
    productCode: "",
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
          productCode: "",
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
      router.replace("/admin/products");
      setFormData({
        productCode: "",
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
        productCode: "",
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

  const handleSearch = () => {
    setSearchTerm(searchInput);
  };

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

  if (user.role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Card className="max-w-md">
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-red-600 font-semibold mb-4">Access Denied</p>
              <p className="text-gray-600 mb-4">
                Only administrators can access this page.
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
    if (isDuplicateMode && !hasChangedDuplicate) {
      setHasChangedDuplicate(true);
    }
  };

  const handleEdit = (product: any) => {
    setEditingProduct(product);
    setFormData({
      productCode: product.productCode || "",
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
              <div className="p-2 bg-green-600 rounded-lg">
                <BoxIcon className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">
                  เพิ่มสารใหม่
                </h1>
                <p className="text-gray-600">
                  จัดการข้อมูลวัตถุดิบและสารเคมี
                </p>
              </div>
            </div>

            <Button
              onClick={() => {
                setEditingProduct(null);
                setIsDuplicateMode(false);
                setHasChangedDuplicate(false);
                router.replace("/admin/products");
                setFormData({
                  productCode: "",
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
              }}
              className="bg-green-600 hover:bg-green-700"
            >
              <Plus className="h-4 w-4 mr-2" />
              เพิ่มสารใหม่
            </Button>
          </div>
        </div>

        {/* Add Product Form */}
        {showAddForm && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>
                {isDuplicateMode ? "ทำซ้ำสาร" : editingProduct ? "แก้ไขสาร" : "เพิ่มสารใหม่"}
              </CardTitle>
              <CardDescription>
                {isDuplicateMode
                  ? "กรุณาแก้ไขข้อมูลก่อนบันทึก เพื่อหลีกเลี่ยงการสร้างสารที่ซ้ำกัน"
                  : editingProduct
                  ? "อัปเดตรายละเอียดสาร"
                  : "กรอกรายละเอียดสารเพื่อเพิ่มเข้าคลัง"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isDuplicateMode && (
                <Alert className="mb-4 border-orange-200 bg-orange-50">
                  <AlertCircle className="h-4 w-4 text-orange-600" />
                  <AlertDescription className="text-orange-800">
                    <strong>โหมดทำซ้ำสาร:</strong> คุณต้องแก้ไขข้อมูลอย่างน้อย 1 ฟิลด์ก่อนบันทึก
                    {hasChangedDuplicate && (
                      <span className="ml-2 text-green-600">✓ ตรวจพบการเปลี่ยนแปลง</span>
                    )}
                  </AlertDescription>
                </Alert>
              )}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="productCode">รหัสสาร (สร้างอัตโนมัติ)</Label>
                    <Input
                      id="productCode"
                      value={editingProduct ? editingProduct.productCode : nextCodeData?.nextCode || "กำลังโหลด..."}
                      disabled
                      className="bg-gray-100 cursor-not-allowed font-mono font-semibold"
                    />
                    {!editingProduct && (
                      <p className="text-xs text-gray-500">
                        รหัสสารนี้จะถูกบันทึกเมื่อกดปุ่ม &quot;เพิ่มสาร&quot;
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="productName">ชื่อสาร *</Label>
                    <Input
                      id="productName"
                      placeholder="กรอกชื่อสาร"
                      value={formData.productName}
                      onChange={(e) => handleFormChange("productName", e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="inciName">INCI Name</Label>
                  <Textarea
                    id="inciName"
                    placeholder="INCI name (ไม่บังคับ)"
                    value={formData.inciName}
                    onChange={(e) => handleFormChange("inciName", e.target.value)}
                    rows={2}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="supplier">Supplier</Label>
                    <Input
                      id="supplier"
                      type="text"
                      placeholder="ชื่อผู้จัดหา"
                      value={formData.supplier}
                      onChange={(e) => handleFormChange("supplier", e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="price">ราคา (฿)</Label>
                    <Input
                      id="price"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={formData.price}
                      onChange={(e) => handleFormChange("price", e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="benefits">Benefits (ประโยชน์)</Label>
                  <Textarea
                    id="benefits"
                    placeholder="ประโยชน์ของสาร"
                    value={formData.benefits}
                    onChange={(e) => handleFormChange("benefits", e.target.value)}
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="details">Details (รายละเอียดเพิ่มเติม)</Label>
                  <Textarea
                    id="details"
                    placeholder="รายละเอียดเพิ่มเติม"
                    value={formData.details}
                    onChange={(e) => handleFormChange("details", e.target.value)}
                    rows={3}
                  />
                </div>

                <div className="flex gap-2">
                  <Button type="submit" disabled={createProduct.isPending || updateProduct.isPending}>
                    {editingProduct
                      ? (updateProduct.isPending ? "กำลังอัปเดต..." : "อัปเดตสาร")
                      : (createProduct.isPending ? "กำลังเพิ่ม..." : "เพิ่มสาร")
                    }
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowAddForm(false);
                      setEditingProduct(null);
                      setIsDuplicateMode(false);
                      setHasChangedDuplicate(false);
                      setFormData({
                        productCode: "",
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
                        router.replace("/admin/products");
                      }
                    }}
                  >
                    ยกเลิก
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Products List */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  รายการวัตถุดิบ
                </CardTitle>
                <CardDescription>
                  แสดง {filteredAndSortedProducts.length} รายการในหน้านี้ (ทั้งหมด {totalCount.toLocaleString()} สาร)
                </CardDescription>
              </div>
            </div>

            {/* Search and Sort Controls */}
            <div className="flex gap-4 mt-4">
              <div className="flex-1 flex gap-2">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="ค้นหา รหัสสาร, ชื่อสาร, INCI, Benefits, Use Cases..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    className="pl-9"
                  />
                </div>
                <Button
                  onClick={handleSearch}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Search className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex gap-2">
                <select
                  value={sortField}
                  onChange={(e) => setSortField(e.target.value)}
                  className="px-3 py-2 border rounded-md text-sm bg-white"
                >
                  <option value="productCode">รหัสสาร</option>
                  <option value="productName">ชื่อสาร</option>
                  <option value="supplier">Supplier</option>
                  <option value="price">ราคา</option>
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")}
                >
                  <ArrowUpDown className="h-4 w-4 mr-1" />
                  {sortDirection === "asc" ? "A-Z" : "Z-A"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filteredAndSortedProducts && filteredAndSortedProducts.length > 0 ? (
              <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>รหัสสาร</TableHead>
                    <TableHead>ชื่อสาร (Trade Name)</TableHead>
                    <TableHead>INCI Name</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Price (฿)</TableHead>
                    <TableHead className="max-w-xs">Benefits</TableHead>
                    <TableHead className="max-w-xs">Use Cases</TableHead>
                    <TableHead>จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedProducts.map((product: any) => (
                    <TableRow key={product._id}>
                      <TableCell className="font-mono text-sm">
                        {product.productCode}
                      </TableCell>
                      <TableCell className="font-medium">
                        {product.productName}
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {product.inci_name || "-"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {product.supplier || "-"}
                      </TableCell>
                      <TableCell className="text-sm font-mono">
                        {product.price > 0 ? product.price.toLocaleString() : "-"}
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <div className="flex flex-wrap gap-1">
                          {Array.isArray(product.benefits) && product.benefits.length > 0 ? (
                            product.benefits.map((benefit: string, idx: number) => (
                              <Badge
                                key={idx}
                                variant="secondary"
                                className="text-xs bg-blue-100 text-blue-800 hover:bg-blue-200"
                              >
                                {benefit}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-sm text-gray-400">-</span>
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
                                className="text-xs bg-green-50 text-green-700 border-green-300 hover:bg-green-100"
                              >
                                {usecase}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-sm text-gray-400">-</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEdit(product)}
                          >
                            <Edit className="h-4 w-4 text-blue-600" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleDelete(product._id, product.productName)
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
                    แสดง {(currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, totalCount)} จากทั้งหมด {totalCount.toLocaleString()} สาร
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
                <p className="text-gray-600 mb-2">ยังไม่มีวัตถุดิบ</p>
                <p className="text-sm text-gray-500">
                  คลิก &quot;เพิ่มสารใหม่&quot; เพื่อเพิ่มวัตถุดิบใหม่
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function AdminProductsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
      <AdminProductsPageContent />
    </Suspense>
  );
}
