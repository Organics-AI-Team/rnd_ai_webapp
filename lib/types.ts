import { z } from "zod";

// ============================================
// ORDER SCHEMAS
// ============================================

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
  organizationId: z.string(),
  productName: z.string().min(1, "Product name is required"),
  price: z.number().positive("Price must be positive"),
  quantity: z.number().int().positive("Quantity must be positive"),
  channel: Channel,
  customerName: z.string().min(1, "Customer name is required"),
  customerContact: z.string().min(1, "Customer contact is required"),
  shippingAddress: z.string().min(1, "Shipping address is required"),
  status: OrderStatus.default("pending"),
  createdBy: z.string(),
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

// ============================================
// AUTH & USER SCHEMAS
// ============================================

export const UserRole = z.enum(["owner", "admin", "member"]);

// Account Schema (for authentication)
export const AccountSchema = z.object({
  _id: z.string().optional(),
  email: z.string().email(),
  passwordHash: z.string(),
  isVerified: z.boolean().default(false),
  isActive: z.boolean().default(true),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

// User Schema (profile information)
export const UserSchema = z.object({
  _id: z.string().optional(),
  accountId: z.string(),
  organizationId: z.string(),
  email: z.string().email(),
  name: z.string().min(1, "Name is required"),
  role: UserRole.default("member"),
  isActive: z.boolean().default(true),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

// Organization Schema
export const OrganizationSchema = z.object({
  _id: z.string().optional(),
  name: z.string().min(1, "Organization name is required"),
  credits: z.number().default(0),
  ownerId: z.string(),
  isActive: z.boolean().default(true),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

// Session Schema
export const SessionSchema = z.object({
  _id: z.string().optional(),
  accountId: z.string(),
  token: z.string(),
  expiresAt: z.date(),
  createdAt: z.date().default(() => new Date()),
});

export type Account = z.infer<typeof AccountSchema>;
export type User = z.infer<typeof UserSchema>;
export type UserRoleType = z.infer<typeof UserRole>;
export type Organization = z.infer<typeof OrganizationSchema>;
export type Session = z.infer<typeof SessionSchema>;

// ============================================
// CREDIT TRANSACTION SCHEMAS
// ============================================

export const CreditTransactionType = z.enum([
  "add",
  "deduct",
  "adjust",
  "refund",
]);

export const CreditTransactionSchema = z.object({
  _id: z.string().optional(),
  organizationId: z.string(),
  organizationName: z.string(),
  type: CreditTransactionType,
  amount: z.number(),
  balanceBefore: z.number(),
  balanceAfter: z.number(),
  description: z.string(),
  orderId: z.string().optional(),
  performedBy: z.string().optional(),
  performedByName: z.string().optional(),
  createdAt: z.date().default(() => new Date()),
});

export type CreditTransaction = z.infer<typeof CreditTransactionSchema>;
export type CreditTransactionTypeEnum = z.infer<typeof CreditTransactionType>;

// ============================================
// AUTH INPUT SCHEMAS
// ============================================

export const SignupInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6, "Password must be at least 6 characters"),
  name: z.string().min(1, "Name is required"),
  organizationName: z.string().min(1, "Organization name is required"),
});

export const LoginInputSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export type SignupInput = z.infer<typeof SignupInputSchema>;
export type LoginInput = z.infer<typeof LoginInputSchema>;
