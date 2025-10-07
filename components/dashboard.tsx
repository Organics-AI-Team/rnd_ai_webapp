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
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

type TabType = "active" | "delivered" | "cancelled" | "all";

export function Dashboard() {
  const { user, organization } = useAuth();
  const { data: orders = [], isLoading, error } = trpc.orders.list.useQuery();
  const { data: stats, error: statsError } = trpc.orders.getStats.useQuery();
  const utils = trpc.useUtils();
  const updateStatus = trpc.orders.updateStatus.useMutation({
    onSuccess: () => {
      utils.orders.list.invalidate();
      utils.orders.getStats.invalidate();
    },
  });

  const [activeTab, setActiveTab] = useState<TabType>("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [timeFrame, setTimeFrame] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("date-desc");
  const [reportMonth, setReportMonth] = useState<string>(
    new Date().toISOString().slice(0, 7)
  );

  const generateMonthlyReport = async () => {
    const jsPDF = (await import("jspdf")).default;
    const autoTable = (await import("jspdf-autotable")).default;

    const doc = new jsPDF() as any;

    const [year, month] = reportMonth.split("-");
    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    const monthYear = `${monthNames[parseInt(month) - 1]} ${year}`;

    // Filter orders for the selected month
    const monthOrders = orders.filter((order: any) => {
      const orderDate = new Date(order.createdAt);
      return (
        orderDate.getMonth() === parseInt(month) - 1 &&
        orderDate.getFullYear() === parseInt(year)
      );
    });

    // Helper function to format currency
    const formatCurrency = (amount: number) => {
      return `THB ${amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    };

    // Title
    doc.setFontSize(20);
    doc.text("Monthly Report", 14, 20);
    doc.setFontSize(12);
    doc.text(monthYear, 14, 28);
    doc.text(`Organization: ${organization?.name || "N/A"}`, 14, 35);

    // Orders Summary
    let yPos = 45;
    doc.setFontSize(16);
    doc.text("Orders Summary", 14, yPos);
    yPos += 5;

    const totalRevenue = monthOrders.reduce(
      (sum: number, o: any) => sum + o.price * o.quantity,
      0
    );
    const totalShippingCost = monthOrders.reduce(
      (sum: number, o: any) => sum + (o.totalShippingCost || 0),
      0
    );

    doc.setFontSize(10);
    doc.text(`Total Orders: ${monthOrders.length}`, 14, yPos + 5);
    doc.text(`Total Revenue: ${formatCurrency(totalRevenue)}`, 14, yPos + 12);
    doc.text(`Total Shipping Cost: ${formatCurrency(totalShippingCost)}`, 14, yPos + 19);
    doc.text(
      `Net Revenue: ${formatCurrency(totalRevenue - totalShippingCost)}`,
      14,
      yPos + 26
    );

    // Orders Details Table
    yPos += 35;

    if (monthOrders.length > 0) {
      autoTable(doc, {
        startY: yPos,
        head: [["Date", "Product", "Customer", "Channel", "Status", "Qty", "Price", "Revenue", "Shipping"]],
        body: monthOrders.map((order: any) => [
          new Date(order.createdAt).toLocaleDateString("en-GB"),
          order.productName,
          order.customerName,
          order.channel.toUpperCase(),
          order.status.replace(/_/g, " ").toUpperCase(),
          order.quantity,
          formatCurrency(order.price),
          formatCurrency(order.price * order.quantity),
          formatCurrency(order.totalShippingCost || 0),
        ]),
        theme: "grid",
        headStyles: { fillColor: [6, 199, 85], textColor: [255, 255, 255] },
        styles: { fontSize: 8, font: "helvetica" },
      });
    } else {
      doc.setFontSize(10);
      doc.text("No orders found for this month", 14, yPos);
    }

    // Footer
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(128);
      doc.text(
        `Generated on ${new Date().toLocaleDateString("en-GB")} | Page ${i} of ${pageCount}`,
        doc.internal.pageSize.width / 2,
        doc.internal.pageSize.height - 10,
        { align: "center" }
      );
    }

    // Save PDF
    doc.save(`monthly-report-${reportMonth}.pdf`);
  };

  if (error || statsError) {
    return (
      <Card className="border-red-500 rounded-xl overflow-hidden">
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

  // Filter orders based on active tab, search, and timeframe
  const getFilteredOrders = () => {
    let filtered = orders;

    // Filter by tab (status)
    switch (activeTab) {
      case "active":
        filtered = filtered.filter((order: any) =>
          order.status === "pending" ||
          order.status === "processing" ||
          order.status === "sent_to_logistic"
        );
        break;
      case "delivered":
        filtered = filtered.filter((order: any) => order.status === "delivered");
        break;
      case "cancelled":
        filtered = filtered.filter((order: any) => order.status === "cancelled");
        break;
      case "all":
      default:
        break;
    }

    // Filter by search query (product name or customer name)
    if (searchQuery.trim()) {
      filtered = filtered.filter((order: any) =>
        order.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.customerName.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Filter by timeframe
    if (timeFrame !== "all") {
      const now = new Date();
      const filterDate = new Date();

      switch (timeFrame) {
        case "today":
          filterDate.setHours(0, 0, 0, 0);
          break;
        case "week":
          filterDate.setDate(now.getDate() - 7);
          break;
        case "month":
          filterDate.setMonth(now.getMonth() - 1);
          break;
      }

      filtered = filtered.filter((order: any) =>
        new Date(order.createdAt) >= filterDate
      );
    }

    // Sort orders
    const sorted = [...filtered].sort((a: any, b: any) => {
      switch (sortBy) {
        case "date-desc":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "date-asc":
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "size-desc":
          return (b.price * b.quantity) - (a.price * a.quantity);
        case "size-asc":
          return (a.price * a.quantity) - (b.price * b.quantity);
        default:
          return 0;
      }
    });

    return sorted;
  };

  const filteredOrders = getFilteredOrders();

  // Calculate stats based on filtered orders
  const filteredStats = {
    total: filteredOrders.length,
    pending: filteredOrders.filter((o: any) => o.status === "pending").length,
    sentToLogistic: filteredOrders.filter((o: any) => o.status === "sent_to_logistic").length,
    totalRevenue: filteredOrders.reduce((sum: number, o: any) => sum + (o.price * o.quantity), 0),
  };

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="rounded-xl bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{filteredStats.total}</div>
            {filteredStats.total !== orders.length && (
              <div className="text-xs text-gray-500 mt-1">
                of {orders.length} total
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-xl bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {filteredStats.pending}
            </div>
            {filteredStats.total !== orders.length && (
              <div className="text-xs text-gray-500 mt-1">
                of {stats?.pending || 0} total
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-xl bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Sent to Logistic
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {filteredStats.sentToLogistic}
            </div>
            {filteredStats.total !== orders.length && (
              <div className="text-xs text-gray-500 mt-1">
                of {stats?.sent_to_logistic || 0} total
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-xl bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-line">
              ฿{filteredStats.totalRevenue.toLocaleString()}
            </div>
            {filteredStats.total !== orders.length && (
              <div className="text-xs text-gray-500 mt-1">
                of ฿{stats?.totalRevenue.toLocaleString() || 0} total
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Orders Table */}
      <Card className="rounded-xl overflow-hidden bg-white">
        <CardHeader className="border-b">
          <div className="flex justify-between items-center">
            <CardTitle className="text-line">Orders Management</CardTitle>
            <div className="flex gap-3 items-center">
              <Input
                type="month"
                value={reportMonth}
                onChange={(e) => setReportMonth(e.target.value)}
                max={new Date().toISOString().slice(0, 7)}
                className="w-40"
              />
              <Button
                onClick={generateMonthlyReport}
                className="bg-line hover:bg-line-dark text-white whitespace-nowrap"
                size="sm"
              >
                Download PDF Report
              </Button>
            </div>
          </div>
        </CardHeader>

        {/* Tabs */}
        <div className="border-b">
          <div className="flex gap-2 px-6 pt-4">
            <button
              onClick={() => setActiveTab("active")}
              className={`px-4 py-2 font-medium rounded-t-lg transition-colors ${
                activeTab === "active"
                  ? "bg-line text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              Active ({orders.filter((o: any) =>
                o.status === "pending" || o.status === "processing" || o.status === "sent_to_logistic"
              ).length})
            </button>
            <button
              onClick={() => setActiveTab("delivered")}
              className={`px-4 py-2 font-medium rounded-t-lg transition-colors ${
                activeTab === "delivered"
                  ? "bg-line text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              Delivered ({orders.filter((o: any) => o.status === "delivered").length})
            </button>
            <button
              onClick={() => setActiveTab("cancelled")}
              className={`px-4 py-2 font-medium rounded-t-lg transition-colors ${
                activeTab === "cancelled"
                  ? "bg-line text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              Cancelled ({orders.filter((o: any) => o.status === "cancelled").length})
            </button>
            <button
              onClick={() => setActiveTab("all")}
              className={`px-4 py-2 font-medium rounded-t-lg transition-colors ${
                activeTab === "all"
                  ? "bg-line text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              All ({orders.length})
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="p-6 bg-gray-50 border-b">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-gray-600 font-medium block mb-2">
                Search (Product/Customer)
              </label>
              <Input
                placeholder="ค้นหาสินค้าหรือลูกค้า..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-600 font-medium block mb-2">
                Time Frame
              </label>
              <Select value={timeFrame} onValueChange={setTimeFrame}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="week">Last 7 Days</SelectItem>
                  <SelectItem value="month">Last 30 Days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-gray-600 font-medium block mb-2">
                Sort By
              </label>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date-desc">Date (Newest First)</SelectItem>
                  <SelectItem value="date-asc">Date (Oldest First)</SelectItem>
                  <SelectItem value="size-desc">Order Size (Highest First)</SelectItem>
                  <SelectItem value="size-asc">Order Size (Lowest First)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-600">
            Showing {filteredOrders.length} of {orders.length} orders
          </div>
        </div>

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
              {filteredOrders.map((order: any) => (
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
