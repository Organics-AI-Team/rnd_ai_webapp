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
import { useState } from "react";
import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export default function AdminCreditsPage() {
  const { data: users = [], isLoading, error } = trpc.users.list.useQuery();
  const { data: transactions = [] } = trpc.users.getAllTransactions.useQuery();
  const utils = trpc.useUtils();

  const addCredits = trpc.users.addCredits.useMutation({
    onSuccess: () => {
      utils.users.list.invalidate();
      utils.users.getAllTransactions.invalidate();
      setAddCreditsDialog(null);
      setAmount("");
      setDescription("");
    },
  });

  const adjustCredits = trpc.users.adjustCredits.useMutation({
    onSuccess: () => {
      utils.users.list.invalidate();
      utils.users.getAllTransactions.invalidate();
      setAdjustCreditsDialog(null);
      setNewAmount("");
      setDescription("");
    },
  });

  const [addCreditsDialog, setAddCreditsDialog] = useState<string | null>(null);
  const [adjustCreditsDialog, setAdjustCreditsDialog] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [description, setDescription] = useState("");

  const handleAddCredits = (userId: string) => {
    addCredits.mutate({
      userId,
      amount: parseFloat(amount),
      description,
      performedBy: "admin",
    });
  };

  const handleAdjustCredits = (userId: string) => {
    adjustCredits.mutate({
      userId,
      newAmount: parseFloat(newAmount),
      description,
      performedBy: "admin",
    });
  };

  if (error) {
    return (
      <Card className="border-red-500 rounded-xl overflow-hidden ">
        <CardHeader className="bg-red-500 text-white rounded-t-xl">
          <CardTitle>เกิดข้อผิดพลาด</CardTitle>
        </CardHeader>
        <CardContent className="mt-6">
          <p className="text-red-600">Error: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return <div className="text-center p-8">กำลังโหลด...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">จัดการ Credits ผู้ใช้</h1>
      </div>

      {/* Users List */}
      <Card className="rounded-xl overflow-hidden bg-white">
        <CardHeader className="border-b">
          <CardTitle className="text-line">รายชื่อผู้ใช้</CardTitle>
        </CardHeader>
        <CardContent className="mt-6">
          {users.length === 0 ? (
            <p className="text-center text-gray-500 py-8">ยังไม่มีผู้ใช้</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ชื่อ</TableHead>
                  <TableHead>อีเมล</TableHead>
                  <TableHead>Credits คงเหลือ</TableHead>
                  <TableHead>จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user: any) => (
                  <TableRow key={user._id}>
                    <TableCell className="font-medium">{user.name}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge
                        variant={user.credits > 0 ? "default" : "destructive"}
                        className="text-lg px-3 py-1"
                      >
                        ฿{user.credits.toFixed(2)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Dialog
                          open={addCreditsDialog === user._id}
                          onOpenChange={(open) =>
                            setAddCreditsDialog(open ? user._id : null)
                          }
                        >
                          <DialogTrigger asChild>
                            <Button size="sm" variant="outline">
                              เพิ่ม Credits
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>เพิ่ม Credits</DialogTitle>
                              <DialogDescription>
                                เพิ่ม credits ให้กับ {user.name}
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 mt-4">
                              <div>
                                <Label htmlFor="amount">จำนวน (บาท)</Label>
                                <Input
                                  id="amount"
                                  type="number"
                                  value={amount}
                                  onChange={(e) => setAmount(e.target.value)}
                                  placeholder="100"
                                />
                              </div>
                              <div>
                                <Label htmlFor="description">รายละเอียด</Label>
                                <Input
                                  id="description"
                                  value={description}
                                  onChange={(e) => setDescription(e.target.value)}
                                  placeholder="เติม credits"
                                />
                              </div>
                              <Button
                                className="w-full"
                                onClick={() => handleAddCredits(user._id)}
                                disabled={
                                  addCredits.isPending ||
                                  !amount ||
                                  !description
                                }
                              >
                                เพิ่ม Credits
                              </Button>
                            </div>
                          </DialogContent>
                        </Dialog>

                        <Dialog
                          open={adjustCreditsDialog === user._id}
                          onOpenChange={(open) =>
                            setAdjustCreditsDialog(open ? user._id : null)
                          }
                        >
                          <DialogTrigger asChild>
                            <Button size="sm" variant="outline">
                              ปรับ Credits
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>ปรับ Credits</DialogTitle>
                              <DialogDescription>
                                ปรับยอด credits ของ {user.name} (ปัจจุบัน:{" "}
                                ฿{user.credits.toFixed(2)})
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 mt-4">
                              <div>
                                <Label htmlFor="newAmount">ยอดใหม่ (บาท)</Label>
                                <Input
                                  id="newAmount"
                                  type="number"
                                  value={newAmount}
                                  onChange={(e) => setNewAmount(e.target.value)}
                                  placeholder={user.credits.toString()}
                                />
                              </div>
                              <div>
                                <Label htmlFor="description">รายละเอียด</Label>
                                <Input
                                  id="description"
                                  value={description}
                                  onChange={(e) => setDescription(e.target.value)}
                                  placeholder="ปรับยอด credits"
                                />
                              </div>
                              <Button
                                className="w-full"
                                onClick={() => handleAdjustCredits(user._id)}
                                disabled={
                                  adjustCredits.isPending ||
                                  !newAmount ||
                                  !description
                                }
                              >
                                ปรับ Credits
                              </Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Transaction History */}
      <Card className="rounded-xl overflow-hidden bg-white">
        <CardHeader className="border-b">
          <CardTitle className="text-line">ประวัติการทำรายการ (100 รายการล่าสุด)</CardTitle>
        </CardHeader>
        <CardContent className="mt-6">
          {transactions.length === 0 ? (
            <p className="text-center text-gray-500 py-8">
              ยังไม่มีประวัติการทำรายการ
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>วันที่</TableHead>
                  <TableHead>ผู้ใช้</TableHead>
                  <TableHead>ประเภท</TableHead>
                  <TableHead>จำนวน</TableHead>
                  <TableHead>ยอดก่อน</TableHead>
                  <TableHead>ยอดหลัง</TableHead>
                  <TableHead>รายละเอียด</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx: any) => (
                  <TableRow key={tx._id}>
                    <TableCell className="text-sm">
                      {new Date(tx.createdAt).toLocaleDateString("th-TH", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <div className="font-medium">{tx.userName}</div>
                        <div className="text-gray-500 text-xs">{tx.userEmail}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          tx.type === "add"
                            ? "default"
                            : tx.type === "deduct"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {tx.type === "add"
                          ? "เพิ่ม"
                          : tx.type === "deduct"
                          ? "หัก"
                          : tx.type === "adjust"
                          ? "ปรับ"
                          : "คืน"}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className={
                        tx.type === "add" || (tx.type === "adjust" && tx.amount > 0)
                          ? "text-green-600 font-medium"
                          : "text-red-600 font-medium"
                      }
                    >
                      {tx.amount > 0 ? "+" : ""}฿{tx.amount.toFixed(2)}
                    </TableCell>
                    <TableCell>฿{tx.balanceBefore.toFixed(2)}</TableCell>
                    <TableCell>฿{tx.balanceAfter.toFixed(2)}</TableCell>
                    <TableCell className="max-w-xs truncate text-sm">
                      {tx.description}
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
