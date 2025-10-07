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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function ShippingPage() {
  const { data: orders = [], isLoading, error } = trpc.orders.list.useQuery();
  const { data: users = [] } = trpc.users.list.useQuery();
  const utils = trpc.useUtils();
  const updateStatus = trpc.orders.updateStatus.useMutation({
    onSuccess: () => {
      utils.orders.list.invalidate();
    },
  });

  const updateShippingCost = trpc.orders.updateShippingCost.useMutation({
    onSuccess: () => {
      utils.orders.list.invalidate();
      utils.users.list.invalidate();
      setEditingOrderId(null);
      setShippingCosts({});
      setSelectedUserId({});
    },
    onError: (error) => {
      alert(`เกิดข้อผิดพลาด: ${error.message}`);
    },
  });

  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [shippingCosts, setShippingCosts] = useState<Record<string, any>>({});
  const [selectedUserId, setSelectedUserId] = useState<Record<string, string>>({});

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

  const handleCalculateShippingCost = (orderId: string) => {
    const costs = shippingCosts[orderId] || {};
    const userId = selectedUserId[orderId];

    if (!userId) {
      alert("กรุณาเลือกผู้ใช้");
      return;
    }

    updateShippingCost.mutate({
      id: orderId,
      userId,
      pickPackCost: costs.pickPackCost || 0,
      bubbleCost: costs.bubbleCost || 0,
      paperInsideCost: costs.paperInsideCost || 0,
      cancelOrderCost: costs.cancelOrderCost || 0,
      codCost: costs.codCost || 0,
      boxCost: costs.boxCost || 0,
      deliveryFeeCost: costs.deliveryFeeCost || 0,
    });
  };

  const updateCost = (orderId: string, field: string, value: string) => {
    setShippingCosts((prev) => ({
      ...prev,
      [orderId]: {
        ...(prev[orderId] || {}),
        [field]: parseFloat(value) || 0,
      },
    }));
  };

  if (error) {
    return (
      <Card className="border-red-500 rounded-xl overflow-hidden shadow-lg">
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
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="rounded-xl shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">รอจัดส่ง</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {pendingOrders.length}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-xl shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              ส่งไปรษณีย์แล้ว
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {shippedOrders.length}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-xl shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              ส่งสำเร็จแล้ว
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-line">
              {deliveredOrders.length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pending Orders */}
      <Card className="rounded-xl overflow-hidden shadow-lg">
        <CardHeader className="border-b">
          <CardTitle className="text-line">รายการรอจัดส่ง</CardTitle>
        </CardHeader>
        <CardContent className="mt-6">
          {pendingOrders.length === 0 ? (
            <p className="text-center text-gray-500 py-8">ไม่มีรายการรอจัดส่ง</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>สินค้า</TableHead>
                  <TableHead>ลูกค้า</TableHead>
                  <TableHead>ช่องทาง</TableHead>
                  <TableHead>ที่อยู่จัดส่ง</TableHead>
                  <TableHead>จำนวน</TableHead>
                  <TableHead>สถานะ</TableHead>
                  <TableHead>ค่าจัดส่ง</TableHead>
                  <TableHead>จัดการ</TableHead>
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
                      <TableCell>{order.quantity}</TableCell>
                      <TableCell>
                        <Badge variant={order.status as any}>
                          {order.status === "pending" ? "รอดำเนินการ" : "กำลังจัดเตรียม"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {order.totalShippingCost > 0 ? (
                          <div className="text-sm font-medium text-green-600">
                            ฿{order.totalShippingCost.toFixed(2)}
                          </div>
                        ) : (
                          <span className="text-gray-400 text-sm">ยังไม่คำนวณ</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setEditingOrderId(
                                editingOrderId === order._id ? null : order._id
                              )
                            }
                          >
                            {editingOrderId === order._id ? "ปิด" : "คำนวณค่าส่ง"}
                          </Button>
                          <Button
                            size="sm"
                            className="bg-line hover:bg-line-dark"
                            onClick={() => handleShipOrder(order._id)}
                            disabled={updateStatus.isPending || order.totalShippingCost === 0}
                          >
                            ส่งไปรษณีย์
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {editingOrderId === order._id && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-gray-50">
                          <div className="p-4 space-y-4">
                            <h4 className="font-semibold text-sm mb-3">
                              คำนวณค่าจัดส่ง (จำนวนสินค้า: {order.quantity} ชิ้น)
                            </h4>

                            {/* User Selection */}
                            <div className="mb-4">
                              <label className="text-sm font-medium mb-2 block">
                                เลือกผู้ใช้ (เพื่อหัก credits)
                              </label>
                              <Select
                                value={selectedUserId[order._id] || ""}
                                onValueChange={(value) =>
                                  setSelectedUserId((prev) => ({
                                    ...prev,
                                    [order._id]: value,
                                  }))
                                }
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="เลือกผู้ใช้..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {users.map((user: any) => (
                                    <SelectItem key={user._id} value={user._id}>
                                      {user.name} ({user.email}) - Credits:{" "}
                                      ฿{user.credits.toFixed(2)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                              <div>
                                <label className="text-xs text-gray-600">
                                  Pick & Pack (฿20/คำสั่ง)
                                </label>
                                <Input
                                  type="number"
                                  placeholder="20"
                                  value={
                                    shippingCosts[order._id]?.pickPackCost || ""
                                  }
                                  onChange={(e) =>
                                    updateCost(
                                      order._id,
                                      "pickPackCost",
                                      e.target.value
                                    )
                                  }
                                />
                              </div>
                              <div>
                                <label className="text-xs text-gray-600">
                                  Bubble (฿5/ชิ้น)
                                </label>
                                <Input
                                  type="number"
                                  placeholder="5"
                                  value={shippingCosts[order._id]?.bubbleCost || ""}
                                  onChange={(e) =>
                                    updateCost(
                                      order._id,
                                      "bubbleCost",
                                      e.target.value
                                    )
                                  }
                                />
                              </div>
                              <div>
                                <label className="text-xs text-gray-600">
                                  Paper inside (฿3/ชิ้น)
                                </label>
                                <Input
                                  type="number"
                                  placeholder="3"
                                  value={
                                    shippingCosts[order._id]?.paperInsideCost || ""
                                  }
                                  onChange={(e) =>
                                    updateCost(
                                      order._id,
                                      "paperInsideCost",
                                      e.target.value
                                    )
                                  }
                                />
                              </div>
                              <div>
                                <label className="text-xs text-gray-600">
                                  Cancel order (฿10/คำสั่ง)
                                </label>
                                <Input
                                  type="number"
                                  placeholder="0"
                                  value={
                                    shippingCosts[order._id]?.cancelOrderCost || ""
                                  }
                                  onChange={(e) =>
                                    updateCost(
                                      order._id,
                                      "cancelOrderCost",
                                      e.target.value
                                    )
                                  }
                                />
                              </div>
                              <div>
                                <label className="text-xs text-gray-600">
                                  COD (3% ของยอด)
                                </label>
                                <Input
                                  type="number"
                                  placeholder="0"
                                  value={shippingCosts[order._id]?.codCost || ""}
                                  onChange={(e) =>
                                    updateCost(order._id, "codCost", e.target.value)
                                  }
                                />
                              </div>
                              <div>
                                <label className="text-xs text-gray-600">
                                  Box (TBC/ชิ้น)
                                </label>
                                <Input
                                  type="number"
                                  placeholder="0"
                                  value={shippingCosts[order._id]?.boxCost || ""}
                                  onChange={(e) =>
                                    updateCost(order._id, "boxCost", e.target.value)
                                  }
                                />
                              </div>
                              <div>
                                <label className="text-xs text-gray-600">
                                  Delivery fee (TBC/ชิ้น)
                                </label>
                                <Input
                                  type="number"
                                  placeholder="0"
                                  value={
                                    shippingCosts[order._id]?.deliveryFeeCost || ""
                                  }
                                  onChange={(e) =>
                                    updateCost(
                                      order._id,
                                      "deliveryFeeCost",
                                      e.target.value
                                    )
                                  }
                                />
                              </div>
                            </div>
                            <div className="flex justify-end gap-2 mt-4">
                              <Button
                                variant="outline"
                                onClick={() => setEditingOrderId(null)}
                              >
                                ยกเลิก
                              </Button>
                              <Button
                                className="bg-green-600 hover:bg-green-700"
                                onClick={() =>
                                  handleCalculateShippingCost(order._id)
                                }
                                disabled={updateShippingCost.isPending}
                              >
                                บันทึกและคำนวณ
                              </Button>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Shipped Orders */}
      <Card className="rounded-xl overflow-hidden shadow-lg">
        <CardHeader className="border-b">
          <CardTitle className="text-line">รายการส่งไปรษณีย์แล้ว</CardTitle>
        </CardHeader>
        <CardContent className="mt-6">
          {shippedOrders.length === 0 ? (
            <p className="text-center text-gray-500 py-8">
              ไม่มีรายการที่ส่งไปรษณีย์แล้ว
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>สินค้า</TableHead>
                  <TableHead>ลูกค้า</TableHead>
                  <TableHead>ช่องทาง</TableHead>
                  <TableHead>ที่อยู่จัดส่ง</TableHead>
                  <TableHead>จำนวน</TableHead>
                  <TableHead>จัดการ</TableHead>
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
                        className="bg-green-600 hover:bg-green-700"
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
