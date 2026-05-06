"use client";

import { useAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import { BoxIcon, Search, Edit, Trash2, Eye, Star, Copy, ChevronLeft, ChevronRight, ArrowUpDown, MoreVertical } from "lucide-react";
import { useState } from "react";
import React from "react";
import { ConsolePageShell } from "@/components/console_page_shell";
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
 * Ingredients list page — Cloudflare-style data table
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
   * Triggers search with current input value.
   */
  const handleSearch = () => {
    setSearchTerm(searchInput);
  };

  /**
   * Handles Enter key press to trigger search.
   *
   * @param e - Keyboard event
   */
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
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
    onSuccess: () => utils.products.list.invalidate(),
    onError: (error) => alert(error.message || "Delete failed"),
  });

  const toggleFavorite = trpc.products.toggleFavorite.useMutation({
    onSuccess: () => utils.products.list.invalidate(),
    onError: (error) => alert(error.message || "Update failed"),
  });

  const [duplicatingId, setDuplicatingId] = useState<string>("");
  const { refetch: fetchDuplicate } = trpc.products.duplicate.useQuery(
    { id: duplicatingId },
    { enabled: false }
  );

  if (isLoading || productsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-gray-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-sm text-gray-500 mb-3">Sign in required</p>
          <Button onClick={() => router.push("/login")} size="sm">Sign in</Button>
        </div>
      </div>
    );
  }

  /**
   * Handles ingredient deletion with confirmation.
   *
   * @param id   - Ingredient ID to delete
   * @param name - Ingredient name for confirmation dialog
   */
  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Delete "${name}"?`)) {
      try { await deleteProduct.mutateAsync({ id }); }
      catch (error: any) { console.error("[ingredients] handleDelete — error", error); }
    }
  };

  /**
   * Toggles favorite status for an ingredient.
   *
   * @param id - Ingredient ID
   * @param e  - Mouse event
   */
  const handleToggleFavorite = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try { await toggleFavorite.mutateAsync({ ingredientId: id }); }
    catch (error: any) { console.error("[ingredients] handleToggleFavorite — error", error); }
  };

  /**
   * Duplicates an ingredient and navigates to the edit form.
   *
   * @param id - Ingredient ID to duplicate
   */
  const handleDuplicate = async (id: string) => {
    try {
      setDuplicatingId(id);
      const result = await fetchDuplicate();
      if (result.data) {
        const params = new URLSearchParams({ duplicate: "true", data: JSON.stringify(result.data) });
        router.push(`/products?${params.toString()}`);
      }
    } catch (error: any) { console.error("[ingredients] handleDuplicate — error", error); }
  };

  return (
    <ConsolePageShell
      title="Ingredients"
      subtitle={`${totalCount.toLocaleString()} items`}
      action_label="Add"
      on_action={() => router.push("/products")}
      show_action={user.role === "admin"}
    >
      {/* Search + Sort toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-50 bg-[#fafafa]">
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-300" />
          <Input
            placeholder="Search code, name, INCI, CAS, benefits..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyPress={handleKeyPress}
            className="pl-8 h-8 text-[12px] border-gray-200/60 bg-white rounded-lg"
          />
        </div>
        <Button onClick={handleSearch} size="sm" variant="ghost" className="h-8 px-2 text-gray-400 hover:text-gray-600">
          <Search className="h-3.5 w-3.5" />
        </Button>
        <div className="h-4 w-px bg-gray-200/60" />
        <select
          value={sortField}
          onChange={(e) => setSortField(e.target.value)}
          className="h-8 px-2 border border-gray-200/60 rounded-lg text-[11px] bg-white text-gray-600"
        >
          <option value="productCode">Code</option>
          <option value="productName">Name</option>
          <option value="supplier">Supplier</option>
          <option value="price">Price</option>
        </select>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")}
          className="h-8 px-2 text-gray-400 hover:text-gray-600"
        >
          <ArrowUpDown className="h-3.5 w-3.5 mr-1" />
          <span className="text-[11px]">{sortDirection === "asc" ? "A-Z" : "Z-A"}</span>
        </Button>
      </div>

      {/* Table */}
      {products && products.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow className="border-b border-gray-100/80 bg-white">
              <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Code</TableHead>
              <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Name</TableHead>
              <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">INCI</TableHead>
              <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">CAS No.</TableHead>
              <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Supplier</TableHead>
              <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Benefits</TableHead>
              <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Use Cases</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product: any) => (
              <TableRow key={product._id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <TableCell className="font-mono text-[11px] text-gray-400">
                  {product.productCode}
                </TableCell>
                <TableCell className="text-[12px] font-medium text-gray-800 max-w-[180px]">
                  <div className="break-words whitespace-normal">{product.productName}</div>
                </TableCell>
                <TableCell className="text-[11px] text-gray-500 max-w-[160px]">
                  <div className="break-words whitespace-normal">{product.inci_name || "–"}</div>
                </TableCell>
                <TableCell className="text-[11px] font-mono text-gray-400">
                  {product.cas_no || "–"}
                </TableCell>
                <TableCell className="text-[11px] text-gray-500 max-w-[100px]">
                  <div className="break-words whitespace-normal">{product.supplier || "–"}</div>
                </TableCell>
                <TableCell className="max-w-[150px]">
                  <div className="flex flex-wrap gap-0.5">
                    {Array.isArray(product.benefits) && product.benefits.length > 0 ? (
                      product.benefits.slice(0, 2).map((benefit: string, idx: number) => (
                        <Badge key={idx} variant="outline" className="text-[10px] px-1.5 py-0 font-normal text-gray-500 border-gray-200/80 bg-gray-50/50">{benefit}</Badge>
                      ))
                    ) : (
                      <span className="text-[10px] text-gray-300">–</span>
                    )}
                    {product.benefits && product.benefits.length > 2 && (
                      <span className="text-[10px] text-gray-300">+{product.benefits.length - 2}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="max-w-[150px]">
                  <div className="flex flex-wrap gap-0.5">
                    {Array.isArray(product.usecase) && product.usecase.length > 0 ? (
                      product.usecase.slice(0, 2).map((usecase: string, idx: number) => (
                        <Badge key={idx} variant="outline" className="text-[10px] px-1.5 py-0 font-normal text-gray-500 border-gray-200/80 bg-gray-50/50">{usecase}</Badge>
                      ))
                    ) : (
                      <span className="text-[10px] text-gray-300">–</span>
                    )}
                    {product.usecase && product.usecase.length > 2 && (
                      <span className="text-[10px] text-gray-300">+{product.usecase.length - 2}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-gray-300 hover:text-gray-500">
                        <MoreVertical className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={(e) => { e.preventDefault(); handleToggleFavorite(product._id, e as any); }}>
                        <Star className={`h-3.5 w-3.5 mr-2 ${product.isFavorited ? "fill-amber-400 text-amber-400" : "text-gray-400"}`} />
                        {product.isFavorited ? "Unfavorite" : "Favorite"}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setViewingIngredient(product)}>
                        <Eye className="h-3.5 w-3.5 mr-2 text-gray-400" />
                        View
                      </DropdownMenuItem>
                      {user.role === "admin" && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleDuplicate(product._id)}>
                            <Copy className="h-3.5 w-3.5 mr-2 text-gray-400" />
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => router.push(`/products?edit=${product._id}`)}>
                            <Edit className="h-3.5 w-3.5 mr-2 text-gray-400" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDelete(product._id, product.productName)} className="text-red-600 focus:text-red-600">
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
        <div className="text-center py-16">
          <BoxIcon className="h-8 w-8 text-gray-200 mx-auto mb-2" />
          <p className="text-[12px] text-gray-400">No ingredients found</p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100/80">
          <span className="text-[11px] text-gray-400 tabular-nums">
            {(currentPage - 1) * itemsPerPage + 1}–{Math.min(currentPage * itemsPerPage, totalCount)} of {totalCount.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1} className="h-7 w-7 p-0 text-gray-400">
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-[11px] text-gray-400 px-2 tabular-nums">{currentPage} / {totalPages}</span>
            <Button variant="ghost" size="sm" onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={!hasMore} className="h-7 w-7 p-0 text-gray-400">
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!viewingIngredient} onOpenChange={() => setViewingIngredient(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-[13px] font-medium">Ingredient Details</DialogTitle>
          </DialogHeader>
          {viewingIngredient && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Code", value: viewingIngredient.productCode, mono: true },
                  { label: "Name", value: viewingIngredient.productName },
                  { label: "INCI Name", value: viewingIngredient.inci_name || "–" },
                  { label: "CAS No.", value: viewingIngredient.cas_no || "–", mono: true },
                  { label: "Supplier", value: viewingIngredient.supplier || "–" },
                  { label: "Price", value: viewingIngredient.price ? `${viewingIngredient.price.toFixed(2)} THB` : "–" },
                  { label: "Category", value: viewingIngredient.category || "–" },
                ].map((field, i) => (
                  <div key={i}>
                    <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wider">{field.label}</p>
                    <p className={`text-[13px] text-gray-800 ${field.mono ? 'font-mono' : ''}`}>{field.value}</p>
                  </div>
                ))}
              </div>

              {viewingIngredient.benefits?.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-400 mb-1.5 uppercase tracking-wider">Benefits</p>
                  <div className="flex flex-wrap gap-1">
                    {viewingIngredient.benefits.map((b: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-[11px] font-normal text-gray-600 border-gray-200/80">{b}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {viewingIngredient.usecase?.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-400 mb-1.5 uppercase tracking-wider">Use Cases</p>
                  <div className="flex flex-wrap gap-1">
                    {viewingIngredient.usecase.map((u: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-[11px] font-normal text-gray-600 border-gray-200/80">{u}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {viewingIngredient.description && (
                <div>
                  <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wider">Description</p>
                  <p className="text-[12px] text-gray-600 bg-gray-50 p-3 rounded-lg">{viewingIngredient.description}</p>
                </div>
              )}

              {viewingIngredient.function && (
                <div>
                  <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wider">Function</p>
                  <p className="text-[12px] text-gray-600 bg-gray-50 p-3 rounded-lg">{viewingIngredient.function}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </ConsolePageShell>
  );
}
