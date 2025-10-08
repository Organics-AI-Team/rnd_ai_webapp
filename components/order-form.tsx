"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus } from "lucide-react";

type OrderItem = {
  id: string;
  orderDate: string;
  productCode: string;
  productName: string;
  price: string;
  quantity: string;
  channel: string;
  customerName: string;
  customerContact: string;
  shippingAddress: string;
};

export function OrderForm() {
  const { user, organization, isLoading: authLoading } = useAuth();
  const utils = trpc.useUtils();
  const createOrder = trpc.orders.create.useMutation();

  // Fetch products list
  const { data: products, isLoading: productsLoading } = trpc.products.list.useQuery();

  const getCurrentDate = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const [ordersList, setOrdersList] = useState<OrderItem[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [formData, setFormData] = useState({
    productId: "",
    productCode: "",
    productName: "",
    price: "",
    quantity: "",
    channel: "",
    customerName: "",
    customerContact: "",
    shippingAddress: "",
    orderDate: getCurrentDate(),
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Handle product selection
  const handleProductSelect = (productId: string) => {
    setSelectedProductId(productId);
    const selectedProduct = products?.find((p: any) => p._id === productId);

    if (selectedProduct) {
      setFormData({
        ...formData,
        productId: selectedProduct._id,
        productCode: selectedProduct.productCode,
        productName: selectedProduct.productName,
        price: selectedProduct.price.toString(),
      });
    }
  };

  const handleAddToList = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate product is selected
    if (!selectedProductId) {
      alert("กรุณาเลือกสินค้า");
      return;
    }

    // Validate channel is selected
    if (!formData.channel) {
      alert("กรุณาเลือกช่องทางการขาย");
      return;
    }

    // Validate stock quantity
    const selectedProduct = products?.find((p: any) => p._id === selectedProductId);
    if (selectedProduct && parseInt(formData.quantity) > selectedProduct.stockQuantity) {
      alert(`สต็อกไม่เพียงพอ มีสต็อกคงเหลือ ${selectedProduct.stockQuantity} ชิ้น`);
      return;
    }

    const newOrder: OrderItem = {
      id: Date.now().toString(),
      orderDate: formData.orderDate,
      productCode: formData.productCode,
      productName: formData.productName,
      price: formData.price,
      quantity: formData.quantity,
      channel: formData.channel,
      customerName: formData.customerName,
      customerContact: formData.customerContact,
      shippingAddress: formData.shippingAddress,
    };
    setOrdersList([...ordersList, newOrder]);
    setSelectedProductId("");
    setFormData({
      productId: "",
      productCode: "",
      productName: "",
      price: "",
      quantity: "",
      channel: "",
      customerName: "",
      customerContact: "",
      shippingAddress: "",
      orderDate: getCurrentDate(),
    });
  };

  const handleRemoveFromList = (id: string) => {
    setOrdersList(ordersList.filter((order) => order.id !== id));
  };

  const handleSubmitAll = async () => {
    if (ordersList.length === 0) return;

    if (authLoading) {
      alert("กำลังโหลดข้อมูล กรุณารอสักครู่");
      return;
    }

    if (!user || !organization) {
      alert("กรุณาเข้าสู่ระบบก่อนทำรายการ");
      console.log("User:", user, "Organization:", organization);
      return;
    }

    // Validate all orders have required fields
    const invalidOrders = ordersList.filter(order => !order.channel || !order.productName);
    if (invalidOrders.length > 0) {
      alert("พบออเดอร์ที่ไม่มีข้อมูลครบถ้วน กรุณาตรวจสอบและลองใหม่");
      console.log("Invalid orders:", invalidOrders);
      return;
    }

    setIsSubmitting(true);
    try {
      for (const order of ordersList) {
        console.log("Submitting order:", {
          channel: order.channel,
          productName: order.productName,
        });
        await createOrder.mutateAsync({
          organizationId: organization._id,
          createdBy: user._id,
          productCode: order.productCode,
          productName: order.productName,
          price: parseFloat(order.price),
          quantity: parseInt(order.quantity),
          channel: order.channel as "line" | "shopee" | "lazada" | "other",
          customerName: order.customerName,
          customerContact: order.customerContact,
          shippingAddress: order.shippingAddress,
          orderDate: order.orderDate,
          orderSource: "admin",
          status: "pending",
        });
      }
      utils.orders.list.invalidate();
      utils.orders.getStats.invalidate();
      setOrdersList([]);
      alert(`บันทึกออเดอร์สำเร็จ ${ordersList.length} รายการ`);
    } catch (error: any) {
      console.error("Error submitting orders:", error);
      alert(`เกิดข้อผิดพลาด: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };


  return (
    <div className="p-4 md:p-6">
      <h2 className="text-xl md:text-2xl font-bold text-line mb-4 md:mb-6">รับออเดอร์ใหม่</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        {/* Left Side - Input Form */}
        <div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-6 lg:sticky lg:top-6">
            <form onSubmit={handleAddToList} className="space-y-4">
          <div>
            <Label htmlFor="orderDate">วันที่</Label>
            <Input
              id="orderDate"
              type="date"
              value={formData.orderDate}
              onChange={(e) =>
                setFormData({ ...formData, orderDate: e.target.value })
              }
              required
            />
          </div>

          <div>
            <Label htmlFor="product">เลือกสินค้า</Label>
            {productsLoading ? (
              <div className="text-sm text-gray-500">กำลังโหลดรายการสินค้า...</div>
            ) : products && products.length > 0 ? (
              <Select
                value={selectedProductId}
                onValueChange={handleProductSelect}
              >
                <SelectTrigger>
                  <SelectValue placeholder="เลือกสินค้าจากคลัง" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((product: any) => (
                    <SelectItem key={product._id} value={product._id}>
                      {product.productCode} - {product.productName} (฿{product.price}) - สต็อก: {product.stockQuantity}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="text-sm text-red-600">
                ไม่มีสินค้าในคลัง กรุณาเพิ่มสินค้าที่ ADD STOCK ก่อน
              </div>
            )}
          </div>

          {selectedProductId && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-600">รหัสสินค้า:</span>
                  <span className="ml-2 font-medium">{formData.productCode}</span>
                </div>
                <div>
                  <span className="text-gray-600">ชื่อสินค้า:</span>
                  <span className="ml-2 font-medium">{formData.productName}</span>
                </div>
                <div>
                  <span className="text-gray-600">ราคา:</span>
                  <span className="ml-2 font-medium">฿{formData.price}</span>
                </div>
                <div>
                  <span className="text-gray-600">สต็อกคงเหลือ:</span>
                  <span className="ml-2 font-medium">
                    {products?.find((p: any) => p._id === selectedProductId)?.stockQuantity || 0} ชิ้น
                  </span>
                </div>
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="quantity">จำนวน</Label>
            <Input
              id="quantity"
              type="number"
              min="1"
              max={products?.find((p: any) => p._id === selectedProductId)?.stockQuantity || 999999}
              value={formData.quantity}
              onChange={(e) =>
                setFormData({ ...formData, quantity: e.target.value })
              }
              placeholder="0"
              required
              disabled={!selectedProductId}
            />
            {selectedProductId && (
              <p className="text-xs text-gray-500 mt-1">
                สต็อกคงเหลือ: {products?.find((p: any) => p._id === selectedProductId)?.stockQuantity || 0} ชิ้น
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="channel">ช่องทางการขาย <span className="text-red-500">*</span></Label>
            <Select
              value={formData.channel}
              onValueChange={(value) =>
                setFormData({ ...formData, channel: value })
              }
              required
            >
              <SelectTrigger>
                <SelectValue placeholder="เลือกช่องทางการขาย" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="line">LINE</SelectItem>
                <SelectItem value="shopee">Shopee</SelectItem>
                <SelectItem value="lazada">Lazada</SelectItem>
                <SelectItem value="other">อื่นๆ</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="customerName">ชื่อลูกค้า</Label>
              <Input
                id="customerName"
                value={formData.customerName}
                onChange={(e) =>
                  setFormData({ ...formData, customerName: e.target.value })
                }
                placeholder="กรอกชื่อลูกค้า"
                required
              />
            </div>

            <div>
              <Label htmlFor="customerContact">เบอร์ติดต่อ</Label>
              <Input
                id="customerContact"
                value={formData.customerContact}
                onChange={(e) =>
                  setFormData({ ...formData, customerContact: e.target.value })
                }
                placeholder="เบอร์โทรศัพท์หรือ LINE ID"
                required
              />
            </div>
          </div>

          <div>
            <Label htmlFor="shippingAddress">ที่อยู่จัดส่ง</Label>
            <Input
              id="shippingAddress"
              value={formData.shippingAddress}
              onChange={(e) =>
                setFormData({ ...formData, shippingAddress: e.target.value })
              }
              placeholder="ที่อยู่สำหรับจัดส่งสินค้า"
              required
            />
          </div>

              <Button
                type="submit"
                className="w-full bg-line hover:bg-line-dark text-white rounded-lg"
              >
                <Plus size={18} className="mr-2" />
                เพิ่มในรายการ
              </Button>
            </form>
          </div>
        </div>

        {/* Right Side - Orders List */}
        <div>
          {ordersList.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 md:p-12 text-center">
              <div className="text-gray-400 mb-4">
                <Plus size={48} className="mx-auto mb-4 opacity-50 md:w-16 md:h-16" />
                <p className="text-base md:text-lg">ยังไม่มีรายการออเดอร์</p>
                <p className="text-sm mt-2">
                  กรอกข้อมูลทางซ้ายแล้วกด &quot;เพิ่มในรายการ&quot;
                </p>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
                <h3 className="text-lg md:text-xl font-bold text-gray-900">
                  รายการออเดอร์ ({ordersList.length})
                </h3>
                <Button
                  onClick={handleSubmitAll}
                  disabled={isSubmitting}
                  className="bg-line hover:bg-line-dark rounded-lg w-full sm:w-auto"
                >
                  {isSubmitting ? "กำลังบันทึก..." : "บันทึกทั้งหมด"}
                </Button>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="whitespace-nowrap">วันที่</TableHead>
                        <TableHead className="whitespace-nowrap">รหัสสินค้า</TableHead>
                        <TableHead className="whitespace-nowrap">ชื่อสินค้า</TableHead>
                        <TableHead className="whitespace-nowrap">ราคา</TableHead>
                        <TableHead className="whitespace-nowrap">จำนวน</TableHead>
                        <TableHead className="whitespace-nowrap">ช่องทาง</TableHead>
                        <TableHead className="whitespace-nowrap">ลูกค้า</TableHead>
                        <TableHead className="whitespace-nowrap">เบอร์ติดต่อ</TableHead>
                        <TableHead className="whitespace-nowrap">ที่อยู่</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ordersList.map((order) => (
                        <TableRow key={order.id}>
                          <TableCell className="whitespace-nowrap">{order.orderDate}</TableCell>
                          <TableCell className="font-medium text-gray-600 whitespace-nowrap">
                            {order.productCode}
                          </TableCell>
                          <TableCell className="font-medium whitespace-nowrap">
                            {order.productName}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">฿{parseFloat(order.price).toLocaleString()}</TableCell>
                          <TableCell>{order.quantity}</TableCell>
                          <TableCell>
                            <Badge variant={order.channel as any}>
                              {order.channel.toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{order.customerName}</TableCell>
                          <TableCell className="whitespace-nowrap">{order.customerContact}</TableCell>
                          <TableCell className="max-w-xs truncate">
                            {order.shippingAddress}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveFromList(order.id)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 size={16} />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
