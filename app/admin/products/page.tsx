"use client";

import { useAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc-client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "next/navigation";
import { BoxIcon, ArrowLeft, Plus, Package, Edit, Trash2 } from "lucide-react";
import { useState } from "react";
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
  const [formData, setFormData] = useState({
    productCode: "",
    productName: "",
    description: "",
    price: "",
    stockQuantity: "",
    lowStockThreshold: "10",
  });

  const createProduct = trpc.products.create.useMutation({
    onSuccess: () => {
      utils.products.list.invalidate();
      setShowAddForm(false);
      setEditingProduct(null);
      setFormData({
        productCode: "",
        productName: "",
        description: "",
        price: "",
        stockQuantity: "",
        lowStockThreshold: "10",
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
        description: "",
        price: "",
        stockQuantity: "",
        lowStockThreshold: "10",
      });
    },
  });

  const deleteProduct = trpc.products.delete.useMutation({
    onSuccess: () => {
      utils.products.list.invalidate();
    },
  });

  const { data: products, isLoading: productsLoading } = trpc.products.list.useQuery();

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
      description: product.description || "",
      price: product.price.toString(),
      stockQuantity: product.stockQuantity.toString(),
      lowStockThreshold: product.lowStockThreshold.toString(),
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
          description: formData.description,
          price: parseFloat(formData.price),
          stockQuantity: parseInt(formData.stockQuantity),
          lowStockThreshold: parseInt(formData.lowStockThreshold),
        });
        alert("อัปเดตสินค้าเรียบร้อยแล้ว!");
      } else {
        await createProduct.mutateAsync({
          productCode: formData.productCode,
          productName: formData.productName,
          description: formData.description,
          price: parseFloat(formData.price),
          stockQuantity: parseInt(formData.stockQuantity),
          lowStockThreshold: parseInt(formData.lowStockThreshold),
        });
        alert("เพิ่มสินค้าเรียบร้อยแล้ว!");
      }
    } catch (error: any) {
      alert(error.message || (editingProduct ? "ไม่สามารถอัปเดตสินค้าได้" : "ไม่สามารถเพิ่มสินค้าได้"));
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`คุณแน่ใจหรือไม่ที่จะลบ "${name}"?`)) {
      try {
        await deleteProduct.mutateAsync({ id });
        alert("ลบสินค้าเรียบร้อยแล้ว!");
      } catch (error: any) {
        alert(error.message || "ไม่สามารถลบสินค้าได้");
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
                  เพิ่มสินค้า
                </h1>
                <p className="text-gray-600">
                  จัดการสินค้าคงคลังและสต็อกสินค้า
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
                  stockQuantity: "",
                  lowStockThreshold: "10",
                });
                setShowAddForm(!showAddForm);
              }}
              className="bg-green-600 hover:bg-green-700"
            >
              <Plus className="h-4 w-4 mr-2" />
              เพิ่มสินค้า
            </Button>
          </div>
        </div>

        {/* Add Product Form */}
        {showAddForm && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>{editingProduct ? "แก้ไขสินค้า" : "เพิ่มสินค้าใหม่"}</CardTitle>
              <CardDescription>
                {editingProduct ? "อัปเดตรายละเอียดสินค้า" : "กรอกรายละเอียดสินค้าเพื่อเพิ่มเข้าคลัง"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="productCode">รหัสสินค้า *</Label>
                    <Input
                      id="productCode"
                      placeholder="เช่น PROD-001"
                      value={formData.productCode}
                      onChange={(e) =>
                        setFormData({ ...formData, productCode: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="productName">ชื่อสินค้า *</Label>
                    <Input
                      id="productName"
                      placeholder="กรอกชื่อสินค้า"
                      value={formData.productName}
                      onChange={(e) =>
                        setFormData({ ...formData, productName: e.target.value })
                      }
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">รายละเอียด</Label>
                  <Textarea
                    id="description"
                    placeholder="รายละเอียดสินค้า (ไม่บังคับ)"
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    rows={2}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="price">ราคา (฿) *</Label>
                    <Input
                      id="price"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={formData.price}
                      onChange={(e) =>
                        setFormData({ ...formData, price: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="stockQuantity">สต็อกเริ่มต้น *</Label>
                    <Input
                      id="stockQuantity"
                      type="number"
                      min="0"
                      placeholder="0"
                      value={formData.stockQuantity}
                      onChange={(e) =>
                        setFormData({ ...formData, stockQuantity: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="lowStockThreshold">แจ้งเตือนสต็อกต่ำ</Label>
                    <Input
                      id="lowStockThreshold"
                      type="number"
                      min="0"
                      value={formData.lowStockThreshold}
                      onChange={(e) =>
                        setFormData({ ...formData, lowStockThreshold: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button type="submit" disabled={createProduct.isPending || updateProduct.isPending}>
                    {editingProduct
                      ? (updateProduct.isPending ? "กำลังอัปเดต..." : "อัปเดตสินค้า")
                      : (createProduct.isPending ? "กำลังเพิ่ม..." : "เพิ่มสินค้า")
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
                        stockQuantity: "",
                        lowStockThreshold: "10",
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
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              สินค้าในคลัง
            </CardTitle>
            <CardDescription>
              มีสินค้าทั้งหมด {products?.length || 0} รายการ
            </CardDescription>
          </CardHeader>
          <CardContent>
            {products && products.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>รหัสสินค้า</TableHead>
                    <TableHead>ชื่อสินค้า</TableHead>
                    <TableHead>ราคา</TableHead>
                    <TableHead>สต็อก</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead>จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((product: any) => (
                    <TableRow key={product._id}>
                      <TableCell className="font-mono text-sm">
                        {product.productCode}
                      </TableCell>
                      <TableCell className="font-medium">
                        {product.productName}
                      </TableCell>
                      <TableCell>฿{product.price.toFixed(2)}</TableCell>
                      <TableCell>
                        <span
                          className={
                            product.stockQuantity <= product.lowStockThreshold
                              ? "text-red-600 font-semibold"
                              : "text-gray-900"
                          }
                        >
                          {product.stockQuantity}
                        </span>
                      </TableCell>
                      <TableCell>
                        {product.stockQuantity <= product.lowStockThreshold ? (
                          <Badge variant="destructive">สต็อกต่ำ</Badge>
                        ) : product.isActive ? (
                          <Badge className="bg-green-600">ใช้งาน</Badge>
                        ) : (
                          <Badge variant="secondary">ไม่ใช้งาน</Badge>
                        )}
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
            ) : (
              <div className="text-center py-12">
                <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 mb-2">ยังไม่มีสินค้า</p>
                <p className="text-sm text-gray-500">
                  คลิก "เพิ่มสินค้า" เพื่อเริ่มต้น
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
