import { z } from "zod";

// ============================================
// PRODUCT/INVENTORY SCHEMAS
// ============================================

// Raw Materials Schema (from rnd_ai.raw_materials collection)
export const RawMaterialSchema = z.object({
  _id: z.string().optional(),
  id: z.number().optional(),
  rm_code: z.string().min(1, "Material code is required"),
  trade_name: z.string().min(1, "Trade name is required"),
  inci_name: z.string().optional(),
  supplier: z.string().optional(),
  rm_cost: z.number().optional(),
  company_name: z.string().optional(),
  companies_id: z.number().optional(),
  benefits: z.string().optional(),
  details: z.string().optional(),
  usecase: z.string().optional(),
});

export type RawMaterial = z.infer<typeof RawMaterialSchema>;

export const ProductSchema = z.object({
  _id: z.string().optional(),
  organizationId: z.string(),
  productCode: z.string().min(1, "Product code is required"),
  productName: z.string().min(1, "Product name is required"),
  description: z.string().optional(),
  price: z.number().positive("Price must be positive"),
  stockQuantity: z.number().int().min(0, "Stock quantity cannot be negative"),
  lowStockThreshold: z.number().int().min(0).default(10),
  isActive: z.boolean().default(true),
  createdBy: z.string(),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

export type Product = z.infer<typeof ProductSchema>;

export const ProductLogSchema = z.object({
  _id: z.string().optional(),
  date: z.string(), // Format: DD/MM/YYYY
  time: z.string(), // Format: HH:mm
  productId: z.string(),
  productCode: z.string(),
  productName: z.string(),
  action: z.enum(["create", "update", "add_stock", "reduce_stock", "delete"]),
  quantityChange: z.number().optional(), // Positive for add, negative for reduce
  previousStock: z.number().optional(),
  newStock: z.number().optional(),
  userId: z.string(),
  userName: z.string().optional(),
  organizationId: z.string(),
  refId: z.string().optional(), // Order ID if stock reduced by order
  notes: z.string().optional(),
  createdAt: z.date().default(() => new Date()),
});

export type ProductLog = z.infer<typeof ProductLogSchema>;

// ============================================
// FORMULA SCHEMAS
// ============================================

// Formula Ingredient Schema
export const FormulaIngredientSchema = z.object({
  materialId: z.string(), // Reference to raw_materials_console
  rm_code: z.string(),
  productName: z.string(),
  inci_name: z.string().optional(),
  amount: z.number().positive("Amount must be positive"), // Amount in grams/ml
  percentage: z.number().min(0).max(100, "Percentage must be 0-100").optional(), // % in formula
  notes: z.string().optional(),
});

export type FormulaIngredient = z.infer<typeof FormulaIngredientSchema>;

// Formula Schema
export const FormulaSchema = z.object({
  _id: z.string().optional(),
  organizationId: z.string(),
  formulaCode: z.string().optional(), // Auto-generated: F000001, F000002, etc
  formulaName: z.string().min(1, "Formula name is required"),
  version: z.number().int().positive().default(1), // Attempt/version number
  client: z.string().optional(), // Client name
  targetBenefits: z.array(z.string()).optional(), // Benefits goal
  ingredients: z.array(FormulaIngredientSchema).min(1, "At least one ingredient is required"),
  totalAmount: z.number().positive("Total amount must be positive").optional(), // Total batch size
  remarks: z.string().optional(),
  status: z.enum(["draft", "testing", "approved", "rejected"]).default("draft"),
  createdBy: z.string(),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

export type Formula = z.infer<typeof FormulaSchema>;
export type FormulaStatusType = "draft" | "testing" | "approved" | "rejected";

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

export const OrderSource = z.enum(["admin", "client"]);

export const OrderSchema = z.object({
  _id: z.string().optional(),
  organizationId: z.string(),
  productId: z.string().optional(), // Link to Product
  productCode: z.string().optional(),
  productName: z.string().min(1, "Product name is required"),
  price: z.number().positive("Price must be positive"),
  quantity: z.number().int().positive("Quantity must be positive"),
  channel: Channel,
  customerName: z.string().min(1, "Customer name is required"),
  customerContact: z.string().min(1, "Customer contact is required"),
  shippingAddress: z.string().min(1, "Shipping address is required"),
  status: OrderStatus.default("pending"),
  createdBy: z.string(),
  orderSource: OrderSource.default("admin"), // Track if order is from admin or client
  orderDate: z.string().optional(), // Date when order was placed (from form)
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
export type OrderSourceType = z.infer<typeof OrderSource>;

// ============================================
// AUTH & USER SCHEMAS
// ============================================

export const UserRole = z.enum(["admin", "shipper", "shopper"]);

export const UserStatus = z.enum(["active", "suspend"]);

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
  role: UserRole.default("admin"),
  status: UserStatus.default("active"),
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
  favoriteIngredients: z.array(z.string()).optional().default([]), // Array of ingredient IDs
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
export type UserStatusType = z.infer<typeof UserStatus>;
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

// ============================================
// USER LOG SCHEMAS
// ============================================

export const UserLogSchema = z.object({
  _id: z.string().optional(),
  date: z.string(), // Format: DD/MM/YYYY
  time: z.string(), // Format: HH:mm
  userId: z.string(), // Reference to user
  userName: z.string().optional(), // User's name for display
  activity: z.string(), // e.g., "create order", "add stock", "log-in"
  refId: z.string().optional(), // Reference ID (order ID, product ID, etc.)
  organizationId: z.string().optional(),
  createdAt: z.date().default(() => new Date()),
});

export type UserLog = z.infer<typeof UserLogSchema>;
