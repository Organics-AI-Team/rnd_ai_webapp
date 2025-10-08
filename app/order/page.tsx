"use client";

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ShoppingCart, Package, CheckCircle } from "lucide-react";

export default function ClientOrderPage() {
  const [organizationId, setOrganizationId] = useState("");
  const [formData, setFormData] = useState({
    productName: "",
    price: "",
    quantity: "1",
    channel: "",
    customerName: "",
    customerContact: "",
    shippingAddress: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const submitOrder = trpc.orders.submitClientOrder.useMutation();

  // Get organization ID from URL or use default
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get('org') || '';
    setOrganizationId(orgId);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!organizationId) {
      alert("Organization ID is required");
      return;
    }

    setIsSubmitting(true);
    setSubmitSuccess(false);

    try {
      await submitOrder.mutateAsync({
        organizationId,
        productName: formData.productName,
        price: parseFloat(formData.price),
        quantity: parseInt(formData.quantity),
        channel: formData.channel as "line" | "shopee" | "lazada" | "other",
        customerName: formData.customerName,
        customerContact: formData.customerContact,
        shippingAddress: formData.shippingAddress,
        orderDate: new Date().toISOString().split('T')[0],
      });

      setSubmitSuccess(true);

      // Reset form
      setFormData({
        productName: "",
        price: "",
        quantity: "1",
        channel: "",
        customerName: "",
        customerContact: "",
        shippingAddress: "",
      });

      // Hide success message after 5 seconds
      setTimeout(() => setSubmitSuccess(false), 5000);
    } catch (error: any) {
      alert(error.message || "Failed to submit order");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-600 text-white mb-4">
            <ShoppingCart className="h-8 w-8" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Submit Your Order
          </h1>
          <p className="text-gray-600">
            Fill in the form below to place your order
          </p>
        </div>

        {submitSuccess && (
          <Card className="mb-6 border-green-200 bg-green-50">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 text-green-800">
                <CheckCircle className="h-6 w-6" />
                <div>
                  <p className="font-semibold">Order submitted successfully!</p>
                  <p className="text-sm">We&apos;ll process your order shortly.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Order Details
            </CardTitle>
            <CardDescription>
              Please provide accurate information for your order
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Product Information */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900 border-b pb-2">
                  Product Information
                </h3>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="productName">Product Name *</Label>
                    <Input
                      id="productName"
                      placeholder="Enter product name"
                      value={formData.productName}
                      onChange={(e) =>
                        setFormData({ ...formData, productName: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="price">Price (฿) *</Label>
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
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="quantity">Quantity *</Label>
                    <Input
                      id="quantity"
                      type="number"
                      min="1"
                      value={formData.quantity}
                      onChange={(e) =>
                        setFormData({ ...formData, quantity: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="channel">Sales Channel *</Label>
                    <Select
                      value={formData.channel}
                      onValueChange={(value) =>
                        setFormData({ ...formData, channel: value })
                      }
                    >
                      <SelectTrigger id="channel">
                        <SelectValue placeholder="Select channel" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="line">LINE</SelectItem>
                        <SelectItem value="shopee">Shopee</SelectItem>
                        <SelectItem value="lazada">Lazada</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Customer Information */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900 border-b pb-2">
                  Customer Information
                </h3>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="customerName">Full Name *</Label>
                    <Input
                      id="customerName"
                      placeholder="Enter your name"
                      value={formData.customerName}
                      onChange={(e) =>
                        setFormData({ ...formData, customerName: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="customerContact">Contact Number *</Label>
                    <Input
                      id="customerContact"
                      placeholder="Phone or LINE ID"
                      value={formData.customerContact}
                      onChange={(e) =>
                        setFormData({ ...formData, customerContact: e.target.value })
                      }
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="shippingAddress">Shipping Address *</Label>
                  <Textarea
                    id="shippingAddress"
                    placeholder="Enter complete shipping address"
                    value={formData.shippingAddress}
                    onChange={(e) =>
                      setFormData({ ...formData, shippingAddress: e.target.value })
                    }
                    rows={3}
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700"
                size="lg"
                disabled={isSubmitting || !organizationId}
              >
                {isSubmitting ? "Submitting..." : "Submit Order"}
              </Button>

              {!organizationId && (
                <p className="text-sm text-red-600 text-center">
                  Invalid organization link. Please contact the seller.
                </p>
              )}
            </form>
          </CardContent>
        </Card>

        <div className="mt-6 text-center text-sm text-gray-600">
          <p>
            By submitting this order, you agree to our terms and conditions.
          </p>
        </div>
      </div>
    </div>
  );
}
