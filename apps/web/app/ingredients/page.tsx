"use client";

import { useAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc-client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import { BoxIcon, ArrowLeft, Search, Plus, Edit, Trash2, Eye, Star, Copy, ChevronLeft, ChevronRight, ArrowUpDown, MoreVertical } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function IngredientsPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const utils = trpc.useUtils();

  const [searchInput, setSearchInput] = useState(""); // What user types
  const [searchTerm, setSearchTerm] = useState(""); // What's sent to server
  const [viewingIngredient, setViewingIngredient] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<string>("productCode");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const itemsPerPage = 50;

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

  const deleteProduct = trpc.products.delete.useMutation({
    onSuccess: () => {
      utils.products.list.invalidate();
      alert("ลบสารเรียบร้อยแล้ว!");
    },
    onError: (error) => {
      alert(error.message || "ไม่สามารถลบสารได้");
    },
  });

  const toggleFavorite = trpc.products.toggleFavorite.useMutation({
    onSuccess: () => {
      utils.products.list.invalidate();
    },
    onError: (error) => {
      alert(error.message || "ไม่สามารถอัพเดทรายการโปรดได้");
    },
  });

  const [duplicatingId, setDuplicatingId] = useState<string>("");
  const { data: duplicateData, refetch: fetchDuplicate } = trpc.products.duplicate.useQuery(
    { id: duplicatingId },
    { enabled: false }
  );

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

  // No client-side filtering needed - server handles it

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`คุณแน่ใจหรือไม่ที่จะลบสาร "${name}"?`)) {
      try {
        await deleteProduct.mutateAsync({ id });
      } catch (error: any) {
        console.error("Error deleting product:", error);
      }
    }
  };

  const handleToggleFavorite = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await toggleFavorite.mutateAsync({ ingredientId: id });
    } catch (error: any) {
      console.error("Error toggling favorite:", error);
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      setDuplicatingId(id);
      const result = await fetchDuplicate();
      if (result.data) {
        // Navigate to admin/products with duplicate data
        const params = new URLSearchParams({
          duplicate: "true",
          data: JSON.stringify(result.data),
        });
        router.push(`/products?${params.toString()}`);
      }
    } catch (error: any) {
      console.error("Error duplicating ingredient:", error);
      alert("ไม่สามารถทำซ้ำสารได้");
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
              <div className="p-2 bg-blue-600 rounded-lg">
                <BoxIcon className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">
                  สารทั้งหมด
                </h1>
                <p className="text-gray-600">
                  จัดการและดูวัตถุดิบทั้งหมด
                </p>
              </div>
            </div>

            {user.role === "admin" && (
              <Button
                onClick={() => router.push("/products")}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Plus className="h-4 w-4 mr-2" />
                เพิ่มสารใหม่
              </Button>
            )}
          </div>
        </div>

        {/* Ingredients List */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>รายการสาร</CardTitle>
                <CardDescription>
                  แสดง {products?.length || 0} รายการในหน้านี้ (ทั้งหมด {totalCount.toLocaleString()} สาร)
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
                  className="bg-blue-600 hover:bg-blue-700"
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
                  className="flex items-center gap-1"
                >
                  <ArrowUpDown className="h-4 w-4" />
                  {sortDirection === "asc" ? "A-Z" : "Z-A"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {products && products.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>รหัสสาร</TableHead>
                    <TableHead>ชื่อสาร</TableHead>
                    <TableHead>INCI Name</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Benefits</TableHead>
                    <TableHead>Use Cases</TableHead>
                    <TableHead>จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((product: any) => (
                    <TableRow key={product._id}>
                      <TableCell className="font-mono text-sm">
                        {product.productCode}
                      </TableCell>
                      <TableCell className="font-medium max-w-[200px]">
                        <div className="break-words whitespace-normal">
                          {product.productName}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-gray-600 max-w-[200px]">
                        <div className="break-words whitespace-normal">
                          {product.inci_name || "-"}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm max-w-[120px]">
                        <div className="break-words whitespace-normal">
                          {product.supplier || "-"}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[180px]">
                        <div className="flex flex-wrap gap-1">
                          {Array.isArray(product.benefits) && product.benefits.length > 0 ? (
                            product.benefits.slice(0, 2).map((benefit: string, idx: number) => (
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
                          {product.benefits && product.benefits.length > 2 && (
                            <Badge variant="outline" className="text-xs">
                              +{product.benefits.length - 2}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[180px]">
                        <div className="flex flex-wrap gap-1">
                          {Array.isArray(product.usecase) && product.usecase.length > 0 ? (
                            product.usecase.slice(0, 2).map((usecase: string, idx: number) => (
                              <Badge
                                key={idx}
                                variant="secondary"
                                className="text-xs bg-green-100 text-green-800"
                              >
                                {usecase}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                          {product.usecase && product.usecase.length > 2 && (
                            <Badge variant="outline" className="text-xs">
                              +{product.usecase.length - 2}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.preventDefault();
                                handleToggleFavorite(product._id, e as any);
                              }}
                            >
                              <Star
                                className={`h-4 w-4 mr-2 ${
                                  product.isFavorited
                                    ? "fill-yellow-400 text-yellow-400"
                                    : "text-gray-400"
                                }`}
                              />
                              {product.isFavorited ? "ลบออกจากรายการโปรด" : "เพิ่มในรายการโปรด"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setViewingIngredient(product)}
                            >
                              <Eye className="h-4 w-4 mr-2 text-blue-600" />
                              ดูรายละเอียด
                            </DropdownMenuItem>
                            {user.role === "admin" && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => handleDuplicate(product._id)}
                                >
                                  <Copy className="h-4 w-4 mr-2 text-purple-600" />
                                  ทำซ้ำ
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => router.push(`/products?edit=${product._id}`)}
                                >
                                  <Edit className="h-4 w-4 mr-2 text-green-600" />
                                  แก้ไข
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleDelete(product._id, product.productName)}
                                  className="text-red-600 focus:text-red-600"
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  ลบ
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-12">
                <BoxIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 mb-2">ยังไม่มีสาร</p>
                {user.role === "admin" && (
                  <p className="text-sm text-gray-500">
                    คลิก &quot;เพิ่มสารใหม่&quot; เพื่อเพิ่มสาร
                  </p>
                )}
              </div>
            )}

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between border-t pt-4">
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
          </CardContent>
        </Card>

        {/* View Ingredient Dialog */}
        <Dialog open={!!viewingIngredient} onOpenChange={() => setViewingIngredient(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>รายละเอียดสาร</DialogTitle>
            </DialogHeader>
            {viewingIngredient && (
              <div className="space-y-6">
                {/* Product Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">รหัสสาร</p>
                    <p className="font-mono font-semibold">{viewingIngredient.productCode}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">ชื่อสาร</p>
                    <p className="font-semibold">{viewingIngredient.productName}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">INCI Name</p>
                    <p className="font-semibold">{viewingIngredient.inci_name || "-"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Supplier</p>
                    <p className="font-semibold">{viewingIngredient.supplier || "-"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Price</p>
                    <p className="font-semibold">
                      {viewingIngredient.price ? `฿${viewingIngredient.price.toFixed(2)}` : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Category</p>
                    <p className="font-semibold">{viewingIngredient.category || "-"}</p>
                  </div>
                </div>

                {/* Benefits */}
                {viewingIngredient.benefits && viewingIngredient.benefits.length > 0 && (
                  <div>
                    <p className="text-sm text-gray-600 mb-2">Benefits</p>
                    <div className="flex flex-wrap gap-2">
                      {viewingIngredient.benefits.map((benefit: string, idx: number) => (
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

                {/* Use Cases */}
                {viewingIngredient.usecase && viewingIngredient.usecase.length > 0 && (
                  <div>
                    <p className="text-sm text-gray-600 mb-2">Use Cases</p>
                    <div className="flex flex-wrap gap-2">
                      {viewingIngredient.usecase.map((usecase: string, idx: number) => (
                        <Badge
                          key={idx}
                          variant="secondary"
                          className="bg-green-100 text-green-800"
                        >
                          {usecase}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Description */}
                {viewingIngredient.description && (
                  <div>
                    <p className="text-sm text-gray-600 mb-2">Description</p>
                    <p className="text-sm bg-gray-50 p-3 rounded-lg">{viewingIngredient.description}</p>
                  </div>
                )}

                {/* Function */}
                {viewingIngredient.function && (
                  <div>
                    <p className="text-sm text-gray-600 mb-2">Function</p>
                    <p className="text-sm bg-gray-50 p-3 rounded-lg">{viewingIngredient.function}</p>
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
