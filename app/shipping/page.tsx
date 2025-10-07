"use client";

import { trpc } from "@/lib/trpc-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OrderStatusType } from "@/lib/types";
import { useState } from "react";
import React from "react";
import { useAuth } from "@/lib/auth-context";

export default function ShippingPage() {
  const { user, organization } = useAuth();
  const { data: orders = [], isLoading, error } = trpc.orders.list.useQuery();
  const utils = trpc.useUtils();
  const updateStatus = trpc.orders.updateStatus.useMutation({
    onSuccess: () => {
      utils.orders.list.invalidate();
    },
  });

  const updateShippingCost = trpc.orders.updateShippingCost.useMutation({
    onSuccess: () => {
      // After saving shipping cost, update status to sent_to_logistic
      if (confirmingOrderId) {
        updateStatus.mutate({
          id: confirmingOrderId,
          status: "sent_to_logistic",
        });
      }
      utils.orders.list.invalidate();
      utils.auth.me.invalidate();
      setEditingOrderId(null);
      setConfirmingOrderId(null);
    },
    onError: (error) => {
      alert(`เกิดข้อผิดพลาด: ${error.message}`);
      setConfirmingOrderId(null);
    },
  });

  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [confirmingOrderId, setConfirmingOrderId] = useState<string | null>(null);
  const [showRateSettings, setShowRateSettings] = useState(true);

  // Global rates that apply to all orders
  const [rates, setRates] = useState({
    pickPack: 20, // per order
    bubble: 5,    // per item
    paperInside: 3, // per item
    cancelOrder: 10, // per order
    codPercent: 3, // 3% of order total
    box: 0,       // TBC per item
    deliveryFee: 0, // TBC per item
  });

  const handleShipOrder = (orderId: string) => {
    updateStatus.mutate({
      id: orderId,
      status: "sent_to_logistic",
    });
  };

  const handleDeliverOrder = (orderId: string) => {
    updateStatus.mutate({
      id: orderId,
      status: "delivered",
    });
  };

  const calculateOrderCosts = (order: any) => {
    const quantity = order.quantity;
    const orderTotal = order.price * quantity;

    // Only apply cancel cost if order status is cancelled
    const isCancelled = order.status === "cancelled";

    return {
      pickPackCost: rates.pickPack,
      bubbleCost: rates.bubble * quantity,
      paperInsideCost: rates.paperInside * quantity,
      cancelOrderCost: isCancelled ? rates.cancelOrder : 0, // Only charge if cancelled
      codCost: orderTotal * (rates.codPercent / 100),
      boxCost: rates.box * quantity,
      deliveryFeeCost: rates.deliveryFee * quantity,
    };
  };

  const getTotalCost = (order: any) => {
    const costs = calculateOrderCosts(order);
    return (
      costs.pickPackCost +
      costs.bubbleCost +
      costs.paperInsideCost +
      costs.cancelOrderCost +
      costs.codCost +
      costs.boxCost +
      costs.deliveryFeeCost
    );
  };

  const handleCalculateShippingCost = (orderId: string) => {
    setConfirmingOrderId(orderId);
  };

  const confirmShippingCost = () => {
    if (!confirmingOrderId) return;

    const order = orders.find((o: any) => o._id === confirmingOrderId);

    if (!organization) {
      alert("กรุณาเข้าสู่ระบบก่อนทำรายการ");
      return;
    }

    if (!order) return;

    const costs = calculateOrderCosts(order);
    const total = getTotalCost(order);

    // Check if organization has enough credits
    if (organization.credits < total) {
      alert(`Credits ไม่เพียงพอ! ต้องการ ฿${total.toFixed(2)} แต่มีเพียง ฿${organization.credits.toFixed(2)}`);
      setConfirmingOrderId(null);
      return;
    }

    updateShippingCost.mutate({
      id: confirmingOrderId,
      organizationId: organization._id,
      pickPackCost: costs.pickPackCost,
      bubbleCost: costs.bubbleCost,
      paperInsideCost: costs.paperInsideCost,
      cancelOrderCost: costs.cancelOrderCost,
      codCost: costs.codCost,
      boxCost: costs.boxCost,
      deliveryFeeCost: costs.deliveryFeeCost,
    });
  };

  const updateRate = (field: keyof typeof rates, value: string) => {
    setRates((prev) => ({
      ...prev,
      [field]: parseFloat(value) || 0,
    }));
  };

  if (error) {
    return (
      <Card className="border-red-500 rounded-xl overflow-hidden">
        <CardHeader className="bg-red-500 text-white rounded-t-xl">
          <CardTitle>เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล</CardTitle>
        </CardHeader>
        <CardContent className="mt-6">
          <p className="text-red-600">
            ไม่สามารถเชื่อมต่อกับ MongoDB กรุณาตรวจสอบว่า MongoDB กำลังทำงานอยู่
          </p>
          <p className="mt-2 text-sm text-gray-600">Error: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return <div className="text-center p-8">กำลังโหลด...</div>;
  }

  // Filter orders that need shipping
  const pendingOrders = orders.filter(
    (order: any) => order.status === "pending" || order.status === "processing"
  );

  const shippedOrders = orders.filter(
    (order: any) => order.status === "sent_to_logistic"
  );

  const deliveredOrders = orders.filter(
    (order: any) => order.status === "delivered"
  );

  return (
    <div className="space-y-4 md:space-y-6 p-4 md:p-6">
      {/* Global Rate Settings */}
      <Card className="rounded-xl overflow-hidden bg-white">
        <CardHeader
          className="border-b bg-line cursor-pointer hover:bg-line-dark transition-colors p-4 md:p-6"
          onClick={() => setShowRateSettings(!showRateSettings)}
        >
          <div className="flex justify-between items-center">
            <CardTitle className="text-white text-base md:text-lg">
              ตั้งค่าอัตราค่าจัดส่ง (ใช้กับทุกออเดอร์)
            </CardTitle>
            <button className="text-white hover:text-gray-200 transition-colors flex-shrink-0">
              {showRateSettings ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              )}
            </button>
          </div>
        </CardHeader>
        {showRateSettings && (
          <CardContent className="p-4 md:p-6 md:mt-0 bg-white">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="text-xs text-gray-700 font-medium block mb-2">
                  Pick & Pack (฿/คำสั่ง)
                </label>
                <Input
                  type="number"
                  value={rates.pickPack}
                  onChange={(e) => updateRate("pickPack", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-700 font-medium block mb-2">
                  Bubble (฿/ชิ้น)
                </label>
                <Input
                  type="number"
                  value={rates.bubble}
                  onChange={(e) => updateRate("bubble", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-700 font-medium block mb-2">
                  Paper inside (฿/ชิ้น)
                </label>
                <Input
                  type="number"
                  value={rates.paperInside}
                  onChange={(e) => updateRate("paperInside", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-700 font-medium block mb-2">
                  Cancel order (฿/คำสั่ง)
                </label>
                <Input
                  type="number"
                  value={rates.cancelOrder}
                  onChange={(e) => updateRate("cancelOrder", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-700 font-medium block mb-2">
                  COD (% ของยอด)
                </label>
                <Input
                  type="number"
                  value={rates.codPercent}
                  onChange={(e) => updateRate("codPercent", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-700 font-medium block mb-2">
                  Box (฿/ชิ้น)
                </label>
                <Input
                  type="number"
                  value={rates.box}
                  onChange={(e) => updateRate("box", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-700 font-medium block mb-2">
                  Delivery fee (฿/ชิ้น)
                </label>
                <Input
                  type="number"
                  value={rates.deliveryFee}
                  onChange={(e) => updateRate("deliveryFee", e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Pending Orders */}
      <Card className="rounded-xl overflow-hidden bg-white">
        <CardHeader className="border-b p-4 md:p-6">
          <CardTitle className="text-line text-lg md:text-xl">รายการรอจัดส่ง</CardTitle>
        </CardHeader>
        <CardContent className="p-0 md:p-6 md:mt-0">
          {pendingOrders.length === 0 ? (
            <p className="text-center text-gray-500 py-8">ไม่มีรายการรอจัดส่ง</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">สินค้า</TableHead>
                  <TableHead className="whitespace-nowrap">ลูกค้า</TableHead>
                  <TableHead className="whitespace-nowrap">ช่องทาง</TableHead>
                  <TableHead className="whitespace-nowrap">ที่อยู่จัดส่ง</TableHead>
                  <TableHead className="whitespace-nowrap">จำนวน</TableHead>
                  <TableHead className="whitespace-nowrap">ยอดรวม</TableHead>
                  <TableHead className="whitespace-nowrap">สถานะ</TableHead>
                  <TableHead className="whitespace-nowrap">ค่าจัดส่งที่คำนวณ</TableHead>
                  <TableHead className="whitespace-nowrap">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingOrders.map((order: any) => (
                  <React.Fragment key={order._id}>
                    <TableRow>
                      <TableCell className="font-medium">
                        {order.productName}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <div>{order.customerName}</div>
                          <div className="text-gray-500">{order.customerContact}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={order.channel as any}>
                          {order.channel.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-xs truncate">
                        {order.shippingAddress}
                      </TableCell>
                      <TableCell>{order.quantity} ชิ้น</TableCell>
                      <TableCell className="font-medium">
                        ฿{(order.price * order.quantity).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={order.status as any}>
                          {order.status === "pending" ? "รอดำเนินการ" : "กำลังจัดเตรียม"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <div className="font-bold text-green-600">
                            ฿{getTotalCost(order).toFixed(2)}
                          </div>
                          <button
                            className="text-xs text-blue-600 hover:underline"
                            onClick={() =>
                              setEditingOrderId(
                                editingOrderId === order._id ? null : order._id
                              )
                            }
                          >
                            {editingOrderId === order._id ? "ซ่อนรายละเอียด" : "ดูรายละเอียด"}
                          </button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          className="bg-line hover:bg-line-dark"
                          onClick={() => handleCalculateShippingCost(order._id)}
                          disabled={updateShippingCost.isPending}
                        >
                          บันทึกค่าส่ง
                        </Button>
                      </TableCell>
                    </TableRow>
                    {editingOrderId === order._id && (
                      <TableRow>
                        <TableCell colSpan={9} className="bg-gray-50">
                          <div className="p-4">
                            <h4 className="font-semibold text-sm mb-4">
                              รายละเอียดค่าจัดส่ง
                            </h4>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                              {(() => {
                                const costs = calculateOrderCosts(order);
                                return (
                                  <>
                                    <div className="bg-white p-3 rounded border">
                                      <div className="text-xs text-gray-600">Pick & Pack</div>
                                      <div className="font-semibold text-green-600">
                                        ฿{costs.pickPackCost.toFixed(2)}
                                      </div>
                                      <div className="text-xs text-gray-500">
                                        ฿{rates.pickPack}/คำสั่ง
                                      </div>
                                    </div>
                                    <div className="bg-white p-3 rounded border">
                                      <div className="text-xs text-gray-600">Bubble</div>
                                      <div className="font-semibold text-green-600">
                                        ฿{costs.bubbleCost.toFixed(2)}
                                      </div>
                                      <div className="text-xs text-gray-500">
                                        ฿{rates.bubble}/ชิ้น × {order.quantity}
                                      </div>
                                    </div>
                                    <div className="bg-white p-3 rounded border">
                                      <div className="text-xs text-gray-600">Paper inside</div>
                                      <div className="font-semibold text-green-600">
                                        ฿{costs.paperInsideCost.toFixed(2)}
                                      </div>
                                      <div className="text-xs text-gray-500">
                                        ฿{rates.paperInside}/ชิ้น × {order.quantity}
                                      </div>
                                    </div>
                                    <div className="bg-white p-3 rounded border">
                                      <div className="text-xs text-gray-600">Cancel order</div>
                                      <div className="font-semibold text-green-600">
                                        ฿{costs.cancelOrderCost.toFixed(2)}
                                      </div>
                                      <div className="text-xs text-gray-500">
                                        ฿{rates.cancelOrder}/คำสั่ง
                                      </div>
                                    </div>
                                    <div className="bg-white p-3 rounded border">
                                      <div className="text-xs text-gray-600">COD</div>
                                      <div className="font-semibold text-green-600">
                                        ฿{costs.codCost.toFixed(2)}
                                      </div>
                                      <div className="text-xs text-gray-500">
                                        {rates.codPercent}% ของ ฿{(order.price * order.quantity).toFixed(2)}
                                      </div>
                                    </div>
                                    <div className="bg-white p-3 rounded border">
                                      <div className="text-xs text-gray-600">Box</div>
                                      <div className="font-semibold text-green-600">
                                        ฿{costs.boxCost.toFixed(2)}
                                      </div>
                                      <div className="text-xs text-gray-500">
                                        ฿{rates.box}/ชิ้น × {order.quantity}
                                      </div>
                                    </div>
                                    <div className="bg-white p-3 rounded border">
                                      <div className="text-xs text-gray-600">Delivery fee</div>
                                      <div className="font-semibold text-green-600">
                                        ฿{costs.deliveryFeeCost.toFixed(2)}
                                      </div>
                                      <div className="text-xs text-gray-500">
                                        ฿{rates.deliveryFee}/ชิ้น × {order.quantity}
                                      </div>
                                    </div>
                                    <div className="bg-green-100 p-3 rounded border-2 border-green-600">
                                      <div className="text-xs text-gray-700 font-medium">รวมทั้งหมด</div>
                                      <div className="font-bold text-lg text-green-700">
                                        ฿{getTotalCost(order).toFixed(2)}
                                      </div>
                                    </div>
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Shipped Orders */}
      <Card className="rounded-xl overflow-hidden bg-white">
        <CardHeader className="border-b p-4 md:p-6">
          <CardTitle className="text-line text-lg md:text-xl">รายการส่งไปรษณีย์แล้ว</CardTitle>
        </CardHeader>
        <CardContent className="p-0 md:p-6 md:mt-0">
          {shippedOrders.length === 0 ? (
            <p className="text-center text-gray-500 py-8">
              ไม่มีรายการที่ส่งไปรษณีย์แล้ว
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">สินค้า</TableHead>
                  <TableHead className="whitespace-nowrap">ลูกค้า</TableHead>
                  <TableHead className="whitespace-nowrap">ช่องทาง</TableHead>
                  <TableHead className="whitespace-nowrap">ที่อยู่จัดส่ง</TableHead>
                  <TableHead className="whitespace-nowrap">จำนวน</TableHead>
                  <TableHead className="whitespace-nowrap">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shippedOrders.map((order: any) => (
                  <TableRow key={order._id}>
                    <TableCell className="font-medium">
                      {order.productName}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <div>{order.customerName}</div>
                        <div className="text-gray-500">{order.customerContact}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={order.channel as any}>
                        {order.channel.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">
                      {order.shippingAddress}
                    </TableCell>
                    <TableCell>{order.quantity}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        className="bg-line hover:bg-line-dark text-white"
                        onClick={() => handleDeliverOrder(order._id)}
                        disabled={updateStatus.isPending}
                      >
                        ส่งสำเร็จ
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Modal */}
      {confirmingOrderId && (() => {
        const order = orders.find((o: any) => o._id === confirmingOrderId) as any;
        if (!order) return null;
        const total = getTotalCost(order);

        return (
          <div
            className="fixed inset-0 flex items-center justify-center z-50"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
          >
            <Card className="w-full max-w-md mx-4 rounded-xl bg-white border-2">
              <CardHeader className="border-b bg-yellow-50">
                <CardTitle className="text-yellow-900">ยืนยันการบันทึกค่าจัดส่ง</CardTitle>
              </CardHeader>
              <CardContent className="mt-6 space-y-4">
                <div className="text-sm space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600">สินค้า:</span>
                    <span className="font-medium">{order.productName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">ลูกค้า:</span>
                    <span className="font-medium">{order.customerName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">จำนวน:</span>
                    <span className="font-medium">{order.quantity} ชิ้น</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t">
                    <span className="text-gray-600">ค่าจัดส่งรวม:</span>
                    <span className="font-bold text-green-600 text-lg">฿{total.toFixed(2)}</span>
                  </div>
                  {organization && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Credits คงเหลือ:</span>
                        <span className="font-medium">฿{organization.credits.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Credits หลังหัก:</span>
                        <span className={`font-medium ${organization.credits - total < 0 ? 'text-red-600' : 'text-green-600'}`}>
                          ฿{(organization.credits - total).toFixed(2)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
                <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-900">
                  <p className="font-medium mb-1">การดำเนินการ:</p>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    <li>หัก Credits จากระบบ ฿{total.toFixed(2)}</li>
                    <li>บันทึกค่าจัดส่งลงในออเดอร์</li>
                    <li>เปลี่ยนสถานะเป็น &quot;ส่งไปรษณีย์แล้ว&quot;</li>
                  </ul>
                </div>
                <div className="flex gap-3 pt-4">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setConfirmingOrderId(null)}
                    disabled={updateShippingCost.isPending}
                  >
                    ยกเลิก
                  </Button>
                  <Button
                    className="flex-1 bg-green-600 hover:bg-green-700"
                    onClick={confirmShippingCost}
                    disabled={updateShippingCost.isPending}
                  >
                    {updateShippingCost.isPending ? "กำลังบันทึก..." : "ยืนยัน"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      })()}
    </div>
  );
}
