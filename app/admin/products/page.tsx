"use client";

import { useAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc-client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "next/navigation";
import { BoxIcon, ArrowLeft, Plus, Package, Edit, Trash2, Search, ArrowUpDown } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";

export default function AdminProductsPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const utils = trpc.useUtils();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<string>("rm_code");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 100;

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

  const createProduct = trpc.products.create.useMutation({
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

  const { data: products, isLoading: productsLoading } = trpc.products.list.useQuery();

  // Filter, sort, and paginate products
  const filteredAndSortedProducts = React.useMemo(() => {
    if (!products) return [];

    // Filter
    let filtered = products.filter((product: any) => {
      const searchLower = searchTerm.toLowerCase();
      return (
        product.productCode?.toLowerCase().includes(searchLower) ||
        product.productName?.toLowerCase().includes(searchLower) ||
        product.inci_name?.toLowerCase().includes(searchLower) ||
        product.benefits?.toLowerCase().includes(searchLower)
      );
    });

    // Sort - prioritize items with INCI name first
    filtered.sort((a: any, b: any) => {
      // First priority: items with INCI name come first
      const aHasInci = a.inci_name && a.inci_name.trim() !== "" && a.inci_name !== "-";
      const bHasInci = b.inci_name && b.inci_name.trim() !== "" && b.inci_name !== "-";

      if (aHasInci && !bHasInci) return -1;
      if (!aHasInci && bHasInci) return 1;

      // Second priority: sort by selected field
      let aVal = a[sortField] || "";
      let bVal = b[sortField] || "";

      // Handle numeric fields
      if (sortField === "price") {
        aVal = parseFloat(aVal) || 0;
        bVal = parseFloat(bVal) || 0;
      } else {
        aVal = aVal.toString().toLowerCase();
        bVal = bVal.toString().toLowerCase();
      }

      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [products, searchTerm, sortField, sortDirection]);

  // Paginate
  const paginatedProducts = React.useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredAndSortedProducts.slice(startIndex, endIndex);
  }, [filteredAndSortedProducts, currentPage]);

  const totalPages = Math.ceil(filteredAndSortedProducts.length / itemsPerPage);

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
              <Button onClick={() => router.push("/dashboard")}>
                Go to Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleEdit = (product: any) => {
    setEditingProduct(product);
    setFormData({
      productCode: product.productCode,
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

    try {
      if (editingProduct) {
        await updateProduct.mutateAsync({
          id: editingProduct._id,
          productCode: formData.productCode,
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
          productCode: formData.productCode,
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
            onClick={() => router.push("/dashboard")}
            className="mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
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
                setFormData({
                  productCode: "",
                  productName: "",
                  description: "",
                  price: "",
                  supplier: "",
                  benefits: "",
                  details: "",
                });
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
              <CardTitle>{editingProduct ? "แก้ไขสาร" : "เพิ่มสารใหม่"}</CardTitle>
              <CardDescription>
                {editingProduct ? "อัปเดตรายละเอียดสาร" : "กรอกรายละเอียดสารเพื่อเพิ่มเข้าคลัง"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="productCode">รหัสสาร *</Label>
                    <Input
                      id="productCode"
                      placeholder="เช่น CHEM-001"
                      value={formData.productCode}
                      onChange={(e) =>
                        setFormData({ ...formData, productCode: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="productName">ชื่อสาร *</Label>
                    <Input
                      id="productName"
                      placeholder="กรอกชื่อสาร"
                      value={formData.productName}
                      onChange={(e) =>
                        setFormData({ ...formData, productName: e.target.value })
                      }
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
                    onChange={(e) =>
                      setFormData({ ...formData, inciName: e.target.value })
                    }
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
                      onChange={(e) =>
                        setFormData({ ...formData, supplier: e.target.value })
                      }
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
                      onChange={(e) =>
                        setFormData({ ...formData, price: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="benefits">Benefits (ประโยชน์)</Label>
                  <Textarea
                    id="benefits"
                    placeholder="ประโยชน์ของสาร"
                    value={formData.benefits}
                    onChange={(e) =>
                      setFormData({ ...formData, benefits: e.target.value })
                    }
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="details">Details (รายละเอียดเพิ่มเติม)</Label>
                  <Textarea
                    id="details"
                    placeholder="รายละเอียดเพิ่มเติม"
                    value={formData.details}
                    onChange={(e) =>
                      setFormData({ ...formData, details: e.target.value })
                    }
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
                      setFormData({
                        productCode: "",
                        productName: "",
                        description: "",
                        price: "",
                        supplier: "",
                        benefits: "",
                        details: "",
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
                  แสดง {paginatedProducts.length} จาก {filteredAndSortedProducts.length} รายการ (ทั้งหมด {products?.length || 0})
                </CardDescription>
              </div>
            </div>

            {/* Search and Sort Controls */}
            <div className="flex gap-4 mt-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="ค้นหา รหัสสาร, ชื่อสาร, INCI Name, Benefits..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCurrentPage(1); // Reset to first page on search
                  }}
                  className="pl-9"
                />
              </div>
              <div className="flex gap-2">
                <select
                  value={sortField}
                  onChange={(e) => setSortField(e.target.value)}
                  className="px-3 py-2 border rounded-md text-sm"
                >
                  <option value="productCode">รหัสสาร</option>
                  <option value="productName">ชื่อสาร</option>
                  <option value="inci_name">INCI Name</option>
                  <option value="benefits">Benefits</option>
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
            {paginatedProducts && paginatedProducts.length > 0 ? (
              <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>รหัสสาร</TableHead>
                    <TableHead>ชื่อสาร (Trade Name)</TableHead>
                    <TableHead>INCI Name</TableHead>
                    <TableHead className="max-w-md">Benefits</TableHead>
                    <TableHead>จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedProducts.map((product: any) => (
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
                      <TableCell className="max-w-md">
                        <div className="text-sm text-gray-600 truncate" title={product.benefits || ""}>
                          {product.benefits || "-"}
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
                    หน้า {currentPage} จาก {totalPages}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                      disabled={currentPage === 1}
                    >
                      ก่อนหน้า
                    </Button>
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum;
                      if (totalPages <= 5) {
                        pageNum = i + 1;
                      } else if (currentPage <= 3) {
                        pageNum = i + 1;
                      } else if (currentPage >= totalPages - 2) {
                        pageNum = totalPages - 4 + i;
                      } else {
                        pageNum = currentPage - 2 + i;
                      }
                      return (
                        <Button
                          key={pageNum}
                          variant={currentPage === pageNum ? "default" : "outline"}
                          size="sm"
                          onClick={() => setCurrentPage(pageNum)}
                        >
                          {pageNum}
                        </Button>
                      );
                    })}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                      disabled={currentPage === totalPages}
                    >
                      ถัดไป
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
