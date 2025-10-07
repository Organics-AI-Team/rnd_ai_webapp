import { z } from "zod";

export const OrderStatus = z.enum([
  "pending",
  "processing",
  "sent_to_logistic",
  "delivered",
  "cancelled",
]);

export const Channel = z.enum(["line", "shopee", "lazada", "other"]);

export const OrderSchema = z.object({
  _id: z.string().optional(),
  productName: z.string().min(1, "Product name is required"),
  price: z.number().positive("Price must be positive"),
  quantity: z.number().int().positive("Quantity must be positive"),
  channel: Channel,
  customerName: z.string().min(1, "Customer name is required"),
  customerContact: z.string().min(1, "Customer contact is required"),
  shippingAddress: z.string().min(1, "Shipping address is required"),
  status: OrderStatus.default("pending"),
  userId: z.string().optional(),
  // Shipping cost fields
  pickPackCost: z.number().default(0),
  bubbleCost: z.number().default(0),
  paperInsideCost: z.number().default(0),
  cancelOrderCost: z.number().default(0),
  codCost: z.number().default(0),
  boxCost: z.number().default(0),
  deliveryFeeCost: z.number().default(0),
  totalShippingCost: z.number().default(0),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

export type Order = z.infer<typeof OrderSchema>;
export type OrderStatusType = z.infer<typeof OrderStatus>;
export type ChannelType = z.infer<typeof Channel>;

// User Credits Schema
export const UserSchema = z.object({
  _id: z.string().optional(),
  email: z.string().email(),
  name: z.string().min(1, "Name is required"),
  credits: z.number().default(0),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

// Credit Transaction Types
export const CreditTransactionType = z.enum([
  "add",
  "deduct",
  "adjust",
  "refund",
]);

// Credit Transaction Schema
export const CreditTransactionSchema = z.object({
  _id: z.string().optional(),
  userId: z.string(),
  userName: z.string(),
  userEmail: z.string(),
  type: CreditTransactionType,
  amount: z.number(),
  balanceBefore: z.number(),
  balanceAfter: z.number(),
  description: z.string(),
  orderId: z.string().optional(),
  performedBy: z.string().optional(),
  createdAt: z.date().default(() => new Date()),
});

export type User = z.infer<typeof UserSchema>;
export type CreditTransaction = z.infer<typeof CreditTransactionSchema>;
export type CreditTransactionTypeEnum = z.infer<typeof CreditTransactionType>;
