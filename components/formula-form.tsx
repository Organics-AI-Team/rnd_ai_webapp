"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Search, Beaker } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";

interface FormulaIngredient {
  materialId: string;
  rm_code: string;
  productName: string;
  inci_name?: string;
  amount: number;
  percentage?: number;
  notes?: string;
}

export function FormulaForm() {
  const utils = trpc.useUtils();

  const [formulaName, setFormulaName] = useState("");
  const [version, setVersion] = useState(1);
  const [client, setClient] = useState("");
  const [targetBenefits, setTargetBenefits] = useState<string[]>([]);
  const [benefitInput, setBenefitInput] = useState("");
  const [ingredients, setIngredients] = useState<FormulaIngredient[]>([]);
  const [totalAmount, setTotalAmount] = useState(100);
  const [remarks, setRemarks] = useState("");
  const [status, setStatus] = useState<"draft" | "testing" | "approved" | "rejected">("draft");

  const [showIngredientPicker, setShowIngredientPicker] = useState(false);
  const [ingredientSearch, setIngredientSearch] = useState("");
  const [filterByBenefit, setFilterByBenefit] = useState("");
  const [filterByUseCase, setFilterByUseCase] = useState("");

  const { data: productsData } = trpc.products.list.useQuery({
    limit: 1000, // Get more products for formula creation
    offset: 0,
  });
  const products = productsData?.products || [];

  const createFormula = trpc.formulas.create.useMutation({
    onSuccess: () => {
      utils.formulas.list.invalidate();
      // Reset form
      setFormulaName("");
      setVersion(1);
      setClient("");
      setTargetBenefits([]);
      setIngredients([]);
      setTotalAmount(100);
      setRemarks("");
      setStatus("draft");
      alert("สร้างสูตรเรียบร้อยแล้ว!");
    },
    onError: (error) => {
      alert(error.message || "ไม่สามารถสร้างสูตรได้");
    },
  });

  const handleAddBenefit = () => {
    if (benefitInput.trim()) {
      setTargetBenefits([...targetBenefits, benefitInput.trim()]);
      setBenefitInput("");
    }
  };

  const handleRemoveBenefit = (index: number) => {
    setTargetBenefits(targetBenefits.filter((_, i) => i !== index));
  };

  const handleAddIngredient = (product: any) => {
    const newIngredient: FormulaIngredient = {
      materialId: product._id,
      rm_code: product.productCode,
      productName: product.productName,
      inci_name: product.inci_name,
      amount: 0,
      percentage: 0,
      notes: "",
    };
    setIngredients([...ingredients, newIngredient]);
    setShowIngredientPicker(false);
    setIngredientSearch("");
  };

  const handleRemoveIngredient = (index: number) => {
    setIngredients(ingredients.filter((_, i) => i !== index));
  };

  const handleUpdateIngredient = (index: number, field: string, value: any) => {
    const updated = [...ingredients];
    updated[index] = { ...updated[index], [field]: value };

    // Auto-calculate percentage when amount changes
    if (field === "amount" && totalAmount > 0) {
      updated[index].percentage = (value / totalAmount) * 100;
    }

    setIngredients(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (ingredients.length === 0) {
      alert("กรุณาเพิ่มสารอย่างน้อย 1 ชนิด");
      return;
    }

    try {
      await createFormula.mutateAsync({
        formulaName,
        version,
        client,
        targetBenefits,
        ingredients: ingredients.map((ing) => ({
          ...ing,
          amount: Number(ing.amount),
          percentage: ing.percentage ? Number(ing.percentage) : undefined,
        })),
        totalAmount,
        remarks,
        status,
      });
    } catch (error) {
      console.error("Error creating formula:", error);
    }
  };

  const filteredProducts = products.filter((p: any) => {
    const searchLower = ingredientSearch.toLowerCase();

    // Text search filter
    const matchesSearch = !searchLower || (
      p.productCode?.toLowerCase().includes(searchLower) ||
      p.productName?.toLowerCase().includes(searchLower) ||
      p.inci_name?.toLowerCase().includes(searchLower)
    );

    // Benefit filter
    const matchesBenefit = !filterByBenefit || (
      Array.isArray(p.benefits) && p.benefits.some((b: string) =>
        b.toLowerCase().includes(filterByBenefit.toLowerCase())
      )
    );

    // Use case filter
    const matchesUseCase = !filterByUseCase || (
      Array.isArray(p.usecase) && p.usecase.some((u: string) =>
        u.toLowerCase().includes(filterByUseCase.toLowerCase())
      )
    );

    return matchesSearch && matchesBenefit && matchesUseCase;
  });

  // Get unique benefits and use cases for filter dropdowns
  const allBenefits = Array.from(new Set(
    products?.flatMap((p: any) => Array.isArray(p.benefits) ? p.benefits : []) || []
  )).sort();

  const allUseCases = Array.from(new Set(
    products?.flatMap((p: any) => Array.isArray(p.usecase) ? p.usecase : []) || []
  )).sort();

  const totalUsedAmount = ingredients.reduce((sum, ing) => sum + Number(ing.amount || 0), 0);
  const totalPercentage = ingredients.reduce((sum, ing) => sum + Number(ing.percentage || 0), 0);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Formula Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Beaker className="h-5 w-5" />
            ข้อมูลสูตร
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="formulaName">ชื่อสูตร *</Label>
              <Input
                id="formulaName"
                placeholder="เช่น Vitamin C Serum"
                value={formulaName}
                onChange={(e) => setFormulaName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="version">Attempt/Version *</Label>
              <Input
                id="version"
                type="number"
                min="1"
                value={version}
                onChange={(e) => setVersion(parseInt(e.target.value) || 1)}
                required
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="client">Client</Label>
              <Input
                id="client"
                placeholder="ชื่อลูกค้า"
                value={client}
                onChange={(e) => setClient(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="totalAmount">Total Batch Size (g/ml)</Label>
              <Input
                id="totalAmount"
                type="number"
                min="0"
                step="0.01"
                value={totalAmount}
                onChange={(e) => setTotalAmount(parseFloat(e.target.value) || 100)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
              className="w-full px-3 py-2 border rounded-md"
            >
              <option value="draft">Draft</option>
              <option value="testing">Testing</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label>Target Benefits (เป้าหมายประโยชน์)</Label>
            <div className="flex gap-2">
              <Input
                placeholder="เช่น ผิวขาวกระจ่างใส"
                value={benefitInput}
                onChange={(e) => setBenefitInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddBenefit();
                  }
                }}
              />
              <Button type="button" onClick={handleAddBenefit}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {targetBenefits.map((benefit, idx) => (
                <Badge
                  key={idx}
                  variant="secondary"
                  className="cursor-pointer"
                  onClick={() => handleRemoveBenefit(idx)}
                >
                  {benefit} ×
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="remarks">Remarks (หมายเหตุ)</Label>
            <Textarea
              id="remarks"
              placeholder="รายละเอียดเพิ่มเติม..."
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* Ingredients */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>สารในสูตร ({ingredients.length} ชนิด)</CardTitle>
            <Dialog open={showIngredientPicker} onOpenChange={setShowIngredientPicker}>
              <DialogTrigger asChild>
                <Button type="button">
                  <Plus className="h-4 w-4 mr-2" />
                  เพิ่มสาร
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-[90vw] w-full max-h-[90vh] overflow-hidden flex flex-col">
                <DialogHeader>
                  <DialogTitle>เลือกสาร ({filteredProducts?.length || 0} รายการ)</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
                  {/* Search and Filters */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <Input
                        placeholder="ค้นหา รหัสสาร, ชื่อสาร, INCI Name..."
                        value={ingredientSearch}
                        onChange={(e) => setIngredientSearch(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                    <div>
                      <select
                        value={filterByBenefit}
                        onChange={(e) => setFilterByBenefit(e.target.value)}
                        className="w-full px-3 py-2 border rounded-md text-sm"
                      >
                        <option value="">ทุก Benefits</option>
                        {allBenefits.map((benefit: any) => (
                          <option key={benefit} value={benefit}>
                            {benefit}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <select
                        value={filterByUseCase}
                        onChange={(e) => setFilterByUseCase(e.target.value)}
                        className="w-full px-3 py-2 border rounded-md text-sm"
                      >
                        <option value="">ทุก Use Cases</option>
                        {allUseCases.map((usecase: any) => (
                          <option key={usecase} value={usecase}>
                            {usecase}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Results Table */}
                  <div className="flex-1 overflow-auto border rounded-lg">
                    <Table>
                      <TableHeader className="sticky top-0 bg-white z-10">
                        <TableRow>
                          <TableHead className="w-32">รหัสสาร</TableHead>
                          <TableHead className="min-w-[200px]">ชื่อสาร</TableHead>
                          <TableHead className="min-w-[150px]">INCI Name</TableHead>
                          <TableHead className="min-w-[200px]">Benefits</TableHead>
                          <TableHead className="min-w-[150px]">Use Cases</TableHead>
                          <TableHead className="w-24 sticky right-0 bg-white">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredProducts?.length > 0 ? (
                          filteredProducts.slice(0, 100).map((product: any) => (
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
                              <TableCell>
                                <div className="flex flex-wrap gap-1">
                                  {Array.isArray(product.benefits) && product.benefits.length > 0 ? (
                                    product.benefits.slice(0, 3).map((benefit: string, idx: number) => (
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
                                  {Array.isArray(product.benefits) && product.benefits.length > 3 && (
                                    <Badge variant="outline" className="text-xs">
                                      +{product.benefits.length - 3}
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-1">
                                  {Array.isArray(product.usecase) && product.usecase.length > 0 ? (
                                    product.usecase.slice(0, 2).map((usecase: string, idx: number) => (
                                      <Badge
                                        key={idx}
                                        variant="outline"
                                        className="text-xs bg-green-50 text-green-700"
                                      >
                                        {usecase}
                                      </Badge>
                                    ))
                                  ) : (
                                    <span className="text-xs text-gray-400">-</span>
                                  )}
                                  {Array.isArray(product.usecase) && product.usecase.length > 2 && (
                                    <Badge variant="outline" className="text-xs">
                                      +{product.usecase.length - 2}
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="sticky right-0 bg-white">
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => handleAddIngredient(product)}
                                >
                                  เลือก
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                              ไม่พบสารที่ตรงกับเงื่อนไข
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {ingredients.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>รหัสสาร</TableHead>
                    <TableHead>ชื่อสาร</TableHead>
                    <TableHead>Amount (g/ml)</TableHead>
                    <TableHead>%</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ingredients.map((ingredient, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-mono text-sm">
                        {ingredient.rm_code}
                      </TableCell>
                      <TableCell>{ingredient.productName}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={ingredient.amount}
                          onChange={(e) =>
                            handleUpdateIngredient(idx, "amount", parseFloat(e.target.value) || 0)
                          }
                          className="w-24"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={ingredient.percentage?.toFixed(2) || 0}
                          onChange={(e) =>
                            handleUpdateIngredient(idx, "percentage", parseFloat(e.target.value) || 0)
                          }
                          className="w-24"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          placeholder="หมายเหตุ"
                          value={ingredient.notes || ""}
                          onChange={(e) => handleUpdateIngredient(idx, "notes", e.target.value)}
                          className="w-32"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRemoveIngredient(idx)}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold bg-gray-50">
                    <TableCell colSpan={2}>Total</TableCell>
                    <TableCell>{totalUsedAmount.toFixed(2)}</TableCell>
                    <TableCell>{totalPercentage.toFixed(2)}%</TableCell>
                    <TableCell colSpan={2}></TableCell>
                  </TableRow>
                </TableBody>
              </Table>

              {totalPercentage > 100 && (
                <p className="text-red-600 text-sm mt-2">
                  ⚠️ Warning: Total percentage exceeds 100%
                </p>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-gray-500">
              ยังไม่มีสารในสูตร กรุณาเพิ่มสาร
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={createFormula.isPending}
          className="bg-green-600 hover:bg-green-700"
        >
          {createFormula.isPending ? "กำลังบันทึก..." : "บันทึกสูตร"}
        </Button>
      </div>
    </form>
  );
}
