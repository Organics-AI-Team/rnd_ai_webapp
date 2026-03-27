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

/**
 * Ingredients list page - Cloudflare-style data table
 *
 * Compact table with search, sort, and pagination controls.
 * Admin users can add, edit, delete, duplicate, and favorite ingredients.
 */
export default function IngredientsPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const utils = trpc.useUtils();

  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [viewingIngredient, setViewingIngredient] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<string>("productCode");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const itemsPerPage = 50;

  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, sortField, sortDirection]);

  /**
   * Triggers search with current input value
   */
  const handleSearch = () => {
    setSearchTerm(searchInput);
  };

  /**
   * Handles Enter key press to trigger search
   *
   * @param e - Keyboard event
   */
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
    },
    onError: (error) => {
      alert(error.message || "Delete failed");
    },
  });

  const toggleFavorite = trpc.products.toggleFavorite.useMutation({
    onSuccess: () => {
      utils.products.list.invalidate();
    },
    onError: (error) => {
      alert(error.message || "Update failed");
    },
  });

  const [duplicatingId, setDuplicatingId] = useState<string>("");
  const { refetch: fetchDuplicate } = trpc.products.duplicate.useQuery(
    { id: duplicatingId },
    { enabled: false }
  );

  if (isLoading || productsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent mx-auto"></div>
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

  /**
   * Handles ingredient deletion with confirmation
   *
   * @param id - Ingredient ID to delete
   * @param name - Ingredient name for confirmation dialog
   */
  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Delete "${name}"?`)) {
      try {
        await deleteProduct.mutateAsync({ id });
      } catch (error: any) {
        console.error("Error deleting product:", error);
      }
    }
  };

  /**
   * Toggles favorite status for an ingredient
   *
   * @param id - Ingredient ID
   * @param e - Mouse event (stopped from propagating)
   */
  const handleToggleFavorite = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await toggleFavorite.mutateAsync({ ingredientId: id });
    } catch (error: any) {
      console.error("Error toggling favorite:", error);
    }
  };

  /**
   * Duplicates an ingredient and navigates to the edit form
   *
   * @param id - Ingredient ID to duplicate
   */
  const handleDuplicate = async (id: string) => {
    try {
      setDuplicatingId(id);
      const result = await fetchDuplicate();
      if (result.data) {
        const params = new URLSearchParams({
          duplicate: "true",
          data: JSON.stringify(result.data),
        });
        router.push(`/products?${params.toString()}`);
      }
    } catch (error: any) {
      console.error("Error duplicating ingredient:", error);
    }
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
            <h1 className="text-lg font-semibold text-gray-900">Ingredients</h1>
            <p className="text-xs text-gray-500">Manage raw materials and ingredients</p>
          </div>
          {user.role === "admin" && (
            <Button onClick={() => router.push("/products")} size="sm">
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
              <CardTitle>Ingredient List</CardTitle>
              <CardDescription>
                Showing {products?.length || 0} of {totalCount.toLocaleString()} items
              </CardDescription>
            </div>
          </div>

          {/* Search and Sort */}
          <div className="flex gap-2 mt-3">
            <div className="flex-1 flex gap-1.5">
              <div className="flex-1 relative">
                <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-gray-400" />
                <Input
                  placeholder="Search code, name, INCI, benefits..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  className="pl-7"
                />
              </div>
              <Button onClick={handleSearch} size="sm" variant="outline">
                <Search className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex gap-1.5">
              <select
                value={sortField}
                onChange={(e) => setSortField(e.target.value)}
                className="h-8 px-2 border border-gray-200 rounded-md text-xs bg-white text-gray-900"
              >
                <option value="productCode">Code</option>
                <option value="productName">Name</option>
                <option value="supplier">Supplier</option>
                <option value="price">Price</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")}
              >
                <ArrowUpDown className="h-3.5 w-3.5 mr-1" />
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
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>INCI</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Benefits</TableHead>
                  <TableHead>Use Cases</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product: any) => (
                  <TableRow key={product._id}>
                    <TableCell className="font-mono text-xs text-gray-500">
                      {product.productCode}
                    </TableCell>
                    <TableCell className="font-medium text-sm text-gray-900 max-w-[180px]">
                      <div className="break-words whitespace-normal">{product.productName}</div>
                    </TableCell>
                    <TableCell className="text-xs text-gray-500 max-w-[160px]">
                      <div className="break-words whitespace-normal">{product.inci_name || "-"}</div>
                    </TableCell>
                    <TableCell className="text-xs max-w-[100px]">
                      <div className="break-words whitespace-normal">{product.supplier || "-"}</div>
                    </TableCell>
                    <TableCell className="max-w-[150px]">
                      <div className="flex flex-wrap gap-0.5">
                        {Array.isArray(product.benefits) && product.benefits.length > 0 ? (
                          product.benefits.slice(0, 2).map((benefit: string, idx: number) => (
                            <Badge key={idx} variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">{benefit}</Badge>
                          ))
                        ) : (
                          <span className="text-2xs text-gray-400">-</span>
                        )}
                        {product.benefits && product.benefits.length > 2 && (
                          <Badge variant="outline">+{product.benefits.length - 2}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[150px]">
                      <div className="flex flex-wrap gap-0.5">
                        {Array.isArray(product.usecase) && product.usecase.length > 0 ? (
                          product.usecase.slice(0, 2).map((usecase: string, idx: number) => (
                            <Badge key={idx} variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200">{usecase}</Badge>
                          ))
                        ) : (
                          <span className="text-2xs text-gray-400">-</span>
                        )}
                        {product.usecase && product.usecase.length > 2 && (
                          <Badge variant="outline">+{product.usecase.length - 2}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                            <MoreVertical className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.preventDefault();
                              handleToggleFavorite(product._id, e as any);
                            }}
                          >
                            <Star className={`h-3.5 w-3.5 mr-2 ${product.isFavorited ? "fill-amber-400 text-amber-400" : "text-gray-400"}`} />
                            {product.isFavorited ? "Remove favorite" : "Add favorite"}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setViewingIngredient(product)}>
                            <Eye className="h-3.5 w-3.5 mr-2 text-blue-600" />
                            View details
                          </DropdownMenuItem>
                          {user.role === "admin" && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleDuplicate(product._id)}>
                                <Copy className="h-3.5 w-3.5 mr-2 text-violet-600" />
                                Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => router.push(`/products?edit=${product._id}`)}>
                                <Edit className="h-3.5 w-3.5 mr-2 text-emerald-600" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleDelete(product._id, product.productName)}
                                className="text-red-600 focus:text-red-600"
                              >
                                <Trash2 className="h-3.5 w-3.5 mr-2" />
                                Delete
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
            <div className="text-center py-8">
              <BoxIcon className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No ingredients found</p>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between border-t border-gray-200 pt-3">
              <span className="text-xs text-gray-500">
                {(currentPage - 1) * itemsPerPage + 1}-{Math.min(currentPage * itemsPerPage, totalCount)} of {totalCount.toLocaleString()}
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="text-xs text-gray-500 px-2">
                  {currentPage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={!hasMore}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!viewingIngredient} onOpenChange={() => setViewingIngredient(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">Ingredient Details</DialogTitle>
          </DialogHeader>
          {viewingIngredient && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Code", value: viewingIngredient.productCode, mono: true },
                  { label: "Name", value: viewingIngredient.productName },
                  { label: "INCI Name", value: viewingIngredient.inci_name || "-" },
                  { label: "Supplier", value: viewingIngredient.supplier || "-" },
                  { label: "Price", value: viewingIngredient.price ? `${viewingIngredient.price.toFixed(2)} THB` : "-" },
                  { label: "Category", value: viewingIngredient.category || "-" },
                ].map((field, i) => (
                  <div key={i}>
                    <p className="text-2xs text-gray-500 mb-0.5">{field.label}</p>
                    <p className={`text-sm font-medium ${field.mono ? 'font-mono' : ''}`}>{field.value}</p>
                  </div>
                ))}
              </div>

              {viewingIngredient.benefits && viewingIngredient.benefits.length > 0 && (
                <div>
                  <p className="text-2xs text-gray-500 mb-1.5">Benefits</p>
                  <div className="flex flex-wrap gap-1">
                    {viewingIngredient.benefits.map((benefit: string, idx: number) => (
                      <Badge key={idx} variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">{benefit}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {viewingIngredient.usecase && viewingIngredient.usecase.length > 0 && (
                <div>
                  <p className="text-2xs text-gray-500 mb-1.5">Use Cases</p>
                  <div className="flex flex-wrap gap-1">
                    {viewingIngredient.usecase.map((usecase: string, idx: number) => (
                      <Badge key={idx} variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200">{usecase}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {viewingIngredient.description && (
                <div>
                  <p className="text-2xs text-gray-500 mb-1">Description</p>
                  <p className="text-xs bg-gray-50 p-2.5 rounded-md text-gray-700">{viewingIngredient.description}</p>
                </div>
              )}

              {viewingIngredient.function && (
                <div>
                  <p className="text-2xs text-gray-500 mb-1">Function</p>
                  <p className="text-xs bg-gray-50 p-2.5 rounded-md text-gray-700">{viewingIngredient.function}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
