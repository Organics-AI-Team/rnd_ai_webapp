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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OrderStatusType } from "@/lib/types";

export function Dashboard() {
  const { data: orders = [], isLoading, error } = trpc.orders.list.useQuery();
  const { data: stats, error: statsError } = trpc.orders.getStats.useQuery();
  const utils = trpc.useUtils();
  const updateStatus = trpc.orders.updateStatus.useMutation({
    onSuccess: () => {
      utils.orders.list.invalidate();
      utils.orders.getStats.invalidate();
    },
  });


  if (error || statsError) {
    return (
      <Card className="border-red-500 rounded-xl overflow-hidden shadow-lg">
        <CardHeader className="bg-red-500 text-white rounded-t-xl">
          <CardTitle>Database Connection Error</CardTitle>
        </CardHeader>
        <CardContent className="mt-6">
          <p className="text-red-600">
            Unable to connect to MongoDB. Please ensure MongoDB is running.
          </p>
          <p className="mt-2 text-sm text-gray-600">
            Connection string: {process.env.MONGODB_URI || 'mongodb://localhost:27017/supplement_management'}
          </p>
          <p className="mt-2 text-sm text-gray-600">
            Error: {error?.message || statsError?.message}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return <div className="text-center p-8">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="rounded-xl shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total || 0}</div>
          </CardContent>
        </Card>

        <Card className="rounded-xl shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {stats?.pending || 0}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-xl shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Sent to Logistic
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {stats?.sent_to_logistic || 0}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-xl shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-line">
              ฿{stats?.totalRevenue.toLocaleString() || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Orders Table */}
      <Card className="rounded-xl overflow-hidden shadow-lg">
        <CardHeader className="border-b">
          <CardTitle className="text-line">Orders Management</CardTitle>
        </CardHeader>
        <CardContent className="mt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order: any) => (
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
                  <TableCell>฿{order.price.toLocaleString()}</TableCell>
                  <TableCell>{order.quantity}</TableCell>
                  <TableCell className="font-semibold">
                    ฿{(order.price * order.quantity).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={order.status}
                      onValueChange={(value) =>
                        updateStatus.mutate({
                          id: order._id,
                          status: value as OrderStatusType,
                        })
                      }
                    >
                      <SelectTrigger className="w-[160px]">
                        <Badge variant={order.status as any}>
                          {order.status.replace(/_/g, " ").toUpperCase()}
                        </Badge>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">
                          <Badge variant="pending">PENDING</Badge>
                        </SelectItem>
                        <SelectItem value="processing">
                          <Badge variant="processing">PROCESSING</Badge>
                        </SelectItem>
                        <SelectItem value="sent_to_logistic">
                          <Badge variant="sent_to_logistic">SENT TO LOGISTIC</Badge>
                        </SelectItem>
                        <SelectItem value="delivered">
                          <Badge variant="delivered">DELIVERED</Badge>
                        </SelectItem>
                        <SelectItem value="cancelled">
                          <Badge variant="cancelled">CANCELLED</Badge>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {new Date(order.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
