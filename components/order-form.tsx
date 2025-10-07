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

  const getCurrentDate = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const [ordersList, setOrdersList] = useState<OrderItem[]>([]);
  const [formData, setFormData] = useState({
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

  const handleAddToList = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate channel is selected
    if (!formData.channel) {
      alert("กรุณาเลือกช่องทางการขาย");
      return;
    }

    const newOrder: OrderItem = {
      id: Date.now().toString(),
      ...formData,
    };
    setOrdersList([...ordersList, newOrder]);
    setFormData({
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
          productName: order.productName,
          price: parseFloat(order.price),
          quantity: parseInt(order.quantity),
          channel: order.channel as "line" | "shopee" | "lazada" | "other",
          customerName: order.customerName,
          customerContact: order.customerContact,
          shippingAddress: order.shippingAddress,
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
    <div>
      <h2 className="text-2xl font-bold text-line mb-6">รับออเดอร์ใหม่</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Side - Input Form */}
        <div>
          <div className="bg-white rounded-xl border border-gray-200 p-6 sticky top-6">
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="productCode">รหัสสินค้า</Label>
              <Input
                id="productCode"
                value={formData.productCode}
                onChange={(e) =>
                  setFormData({ ...formData, productCode: e.target.value })
                }
                placeholder="กรอกรหัสสินค้า"
                required
              />
            </div>

            <div>
              <Label htmlFor="productName">ชื่อสินค้า</Label>
              <Input
                id="productName"
                value={formData.productName}
                onChange={(e) =>
                  setFormData({ ...formData, productName: e.target.value })
                }
                placeholder="กรอกชื่อสินค้า"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="price">ราคา (฿)</Label>
              <Input
                id="price"
                type="number"
                step="0.01"
                value={formData.price}
                onChange={(e) =>
                  setFormData({ ...formData, price: e.target.value })
                }
                placeholder="0.00"
                required
              />
            </div>

            <div>
              <Label htmlFor="quantity">จำนวน</Label>
              <Input
                id="quantity"
                type="number"
                value={formData.quantity}
                onChange={(e) =>
                  setFormData({ ...formData, quantity: e.target.value })
                }
                placeholder="0"
                required
              />
            </div>
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

          <div className="grid grid-cols-2 gap-4">
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
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <div className="text-gray-400 mb-4">
                <Plus size={64} className="mx-auto mb-4 opacity-50" />
                <p className="text-lg">ยังไม่มีรายการออเดอร์</p>
                <p className="text-sm mt-2">
                  กรอกข้อมูลทางซ้ายแล้วกด "เพิ่มในรายการ"
                </p>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-900">
                  รายการออเดอร์ ({ordersList.length})
                </h3>
                <Button
                  onClick={handleSubmitAll}
                  disabled={isSubmitting}
                  className="bg-line hover:bg-line-dark rounded-lg"
                >
                  {isSubmitting ? "กำลังบันทึก..." : "บันทึกทั้งหมด"}
                </Button>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>วันที่</TableHead>
                  <TableHead>รหัสสินค้า</TableHead>
                  <TableHead>ชื่อสินค้า</TableHead>
                  <TableHead>ราคา</TableHead>
                  <TableHead>จำนวน</TableHead>
                  <TableHead>ช่องทาง</TableHead>
                  <TableHead>ลูกค้า</TableHead>
                  <TableHead>เบอร์ติดต่อ</TableHead>
                  <TableHead>ที่อยู่</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordersList.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>{order.orderDate}</TableCell>
                    <TableCell className="font-medium text-gray-600">
                      {order.productCode}
                    </TableCell>
                    <TableCell className="font-medium">
                      {order.productName}
                    </TableCell>
                    <TableCell>฿{parseFloat(order.price).toLocaleString()}</TableCell>
                    <TableCell>{order.quantity}</TableCell>
                    <TableCell>
                      <Badge variant={order.channel as any}>
                        {order.channel.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>{order.customerName}</TableCell>
                    <TableCell>{order.customerContact}</TableCell>
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
        )}
      </div>
    </div>
    </div>
  );
}
