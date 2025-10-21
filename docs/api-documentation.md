# API Documentation

This document provides comprehensive documentation for all tRPC API endpoints in the R&D AI Management System.

## Table of Contents

- [API Overview](#api-overview)
- [Authentication](#authentication)
- [Error Handling](#error-handling)
- [API Routers](#api-routers)
  - [Auth Router](#auth-router)
  - [Orders Router](#orders-router)
  - [Users Router](#users-router)
  - [Organizations Router](#organizations-router)
- [tRPC Client Usage](#trpc-client-usage)
- [Type Safety](#type-safety)

---

## API Overview

### Technology

The API is built using **tRPC** (TypeScript Remote Procedure Call), which provides:
- End-to-end type safety
- No API specification needed
- Auto-completion in IDE
- Automatic request/response validation
- Built-in error handling

### Base URL

```
Development: http://localhost:3000/api/trpc
Production: https://yourdomain.com/api/trpc
```

### API Structure

```
/api/trpc/
├── auth.*          # Authentication endpoints
├── orders.*        # Order management
├── users.*         # User management
└── organizations.* # Organization management
```

### Request Format

All requests are made through the tRPC client with automatic serialization:

```typescript
const result = await trpc.router.procedure.query(input);
const result = await trpc.router.procedure.mutate(input);
```

---

## Authentication

### Session-based Authentication

The API uses token-based authentication with sessions stored in MongoDB.

### Authentication Flow

1. User logs in or signs up
2. Server creates session with unique token
3. Token stored in HTTP cookie
4. Client sends token with each request
5. Middleware validates token
6. Server provides user context

### Auth Context

Available in all procedures via `ctx`:

```typescript
{
  userId: string | null;  // Current user ID
}
```

---

## Error Handling

### Error Types

tRPC provides structured error handling:

**TRPCError**: Base error type
```typescript
{
  message: string;
  code: string;
  data?: any;
}
```

### Error Codes

- `BAD_REQUEST`: Invalid input
- `UNAUTHORIZED`: Not authenticated
- `FORBIDDEN`: Not authorized
- `NOT_FOUND`: Resource not found
- `INTERNAL_SERVER_ERROR`: Server error

### Example Error Handling

```typescript
try {
  const result = await trpc.orders.create.mutate(input);
} catch (error) {
  if (error.message === "Insufficient credits") {
    // Handle insufficient credits
  }
}
```

---

## API Routers

## Auth Router

**Location**: `server/routers/auth.ts`

Authentication and session management endpoints.

### `auth.signup`

Create a new account, organization, and user profile.

**Type**: `mutation`

**Input**:
```typescript
{
  email: string;           // Valid email address
  password: string;        // Minimum 6 characters
  name: string;           // User's full name
  organizationName: string; // Organization name
}
```

**Output**:
```typescript
{
  success: boolean;
  token: string;          // Session token
  user: {
    _id: string;
    accountId: string;
    organizationId: string;
    email: string;
    name: string;
    role: "owner";
  };
}
```

**Errors**:
- "An account with this email already exists"

**Example**:
```typescript
const result = await trpc.auth.signup.mutate({
  email: "user@example.com",
  password: "password123",
  name: "John Doe",
  organizationName: "Acme Corp"
});
```

**Process**:
1. Validates email is unique
2. Hashes password with bcrypt
3. Creates account document
4. Creates organization document
5. Creates user profile with "owner" role
6. Generates session token (30 days expiry)
7. Returns token and user data

---

### `auth.login`

Authenticate user and create session.

**Type**: `mutation`

**Input**:
```typescript
{
  email: string;
  password: string;
}
```

**Output**:
```typescript
{
  success: boolean;
  token: string;
  user: {
    _id: string;
    accountId: string;
    organizationId: string;
    email: string;
    name: string;
    role: "owner" | "admin" | "member";
  };
}
```

**Errors**:
- "Invalid email or password"
- "Account is deactivated"
- "User profile not found"

**Example**:
```typescript
const result = await trpc.auth.login.mutate({
  email: "user@example.com",
  password: "password123"
});
```

**Process**:
1. Finds account by email
2. Verifies account is active
3. Compares password with bcrypt
4. Retrieves user profile
5. Creates session token (30 days expiry)
6. Returns token and user data

---

### `auth.logout`

Delete session and log out user.

**Type**: `mutation`

**Input**:
```typescript
{
  token: string;
}
```

**Output**:
```typescript
{
  success: boolean;
}
```

**Example**:
```typescript
await trpc.auth.logout.mutate({ token: sessionToken });
```

---

### `auth.me`

Get current user and organization data.

**Type**: `query`

**Input**:
```typescript
{
  token: string;
}
```

**Output**:
```typescript
{
  user: {
    _id: string;
    accountId: string;
    organizationId: string;
    email: string;
    name: string;
    role: "owner" | "admin" | "member";
  };
  organization: {
    _id: string;
    name: string;
    credits: number;
    ownerId: string;
  } | null;
}
```

**Errors**:
- "Invalid or expired session"
- "User not found"

**Example**:
```typescript
const { user, organization } = await trpc.auth.me.query({ token });
```

**Process**:
1. Validates session token
2. Checks session hasn't expired
3. Retrieves user profile
4. Retrieves organization
5. Returns user and organization data

---

## Orders Router

**Location**: `server/routers/orders.ts`

Order management endpoints.

### `orders.create`

Create a new order.

**Type**: `mutation`

**Input**:
```typescript
{
  organizationId: string;
  productCode?: string;      // Optional SKU
  productName: string;
  price: number;             // Positive number
  quantity: number;          // Positive integer
  channel: "line" | "shopee" | "lazada" | "other";
  customerName: string;
  customerContact: string;
  shippingAddress: string;
  status?: OrderStatus;      // Default: "pending"
  createdBy: string;         // User ID
  orderDate?: string;        // Optional order date
  // Shipping costs (optional, default to 0)
  pickPackCost?: number;
  bubbleCost?: number;
  paperInsideCost?: number;
  cancelOrderCost?: number;
  codCost?: number;
  boxCost?: number;
  deliveryFeeCost?: number;
}
```

**Output**:
```typescript
{
  id: string;  // Created order ID
}
```

**Validation**:
- Price must be positive
- Quantity must be positive integer
- All required fields must be provided

**Example**:
```typescript
const result = await trpc.orders.create.mutate({
  organizationId: "org123",
  productCode: "SUPP-001",
  productName: "Vitamin C 1000mg",
  price: 350,
  quantity: 2,
  channel: "line",
  customerName: "Jane Smith",
  customerContact: "081-234-5678",
  shippingAddress: "123 Main St, Bangkok 10110",
  createdBy: "user123",
  orderDate: "2024-10-07"
});
```

---

### `orders.list`

List all orders for the current user/organization.

**Type**: `query`

**Input** (optional):
```typescript
{
  organizationId?: string;
}
```

**Output**:
```typescript
Array<{
  _id: string;
  organizationId: string;
  productCode?: string;
  productName: string;
  price: number;
  quantity: number;
  channel: "line" | "shopee" | "lazada" | "other";
  customerName: string;
  customerContact: string;
  shippingAddress: string;
  status: OrderStatus;
  createdBy: string;
  orderDate?: string;
  pickPackCost: number;
  bubbleCost: number;
  paperInsideCost: number;
  cancelOrderCost: number;
  codCost: number;
  boxCost: number;
  deliveryFeeCost: number;
  totalShippingCost: number;
  createdAt: Date;
  updatedAt: Date;
  creatorName: string;        // Enriched data
  organizationName: string;   // Enriched data
}>
```

**Filtering**:
- Automatically filters by logged-in user's ID (`ctx.userId`)
- Optional filter by organization ID

**Example**:
```typescript
const orders = await trpc.orders.list.query();
const orgOrders = await trpc.orders.list.query({ organizationId: "org123" });
```

**Process**:
1. Applies user filter from context
2. Applies optional organization filter
3. Sorts by creation date (descending)
4. Enriches with creator and organization names
5. Returns order list

---

### `orders.updateStatus`

Update an order's status.

**Type**: `mutation`

**Input**:
```typescript
{
  id: string;
  status: "pending" | "processing" | "sent_to_logistic" | "delivered" | "cancelled";
}
```

**Output**:
```typescript
{
  success: boolean;
}
```

**Example**:
```typescript
await trpc.orders.updateStatus.mutate({
  id: "order123",
  status: "sent_to_logistic"
});
```

---

### `orders.getStats`

Get order statistics for the current user.

**Type**: `query`

**Input**: None

**Output**:
```typescript
{
  total: number;
  pending: number;
  processing: number;
  sent_to_logistic: number;
  delivered: number;
  cancelled: number;
  totalRevenue: number;
}
```

**Example**:
```typescript
const stats = await trpc.orders.getStats.query();
console.log(`Total Revenue: ${stats.totalRevenue}`);
```

**Filtering**:
- Automatically filters by logged-in user's ID

---

### `orders.updateShippingCost`

Calculate and save shipping costs, deduct credits from organization.

**Type**: `mutation`

**Input**:
```typescript
{
  id: string;              // Order ID
  organizationId: string;
  pickPackCost?: number;
  bubbleCost?: number;
  paperInsideCost?: number;
  cancelOrderCost?: number;
  codCost?: number;
  boxCost?: number;
  deliveryFeeCost?: number;
}
```

**Output**:
```typescript
{
  success: boolean;
  totalShippingCost: number;
  newBalance: number;      // Organization credit balance after deduction
}
```

**Errors**:
- "Order not found"
- "Organization not found"
- "Insufficient credits. Required: ฿X.XX, Available: ฿Y.YY"

**Example**:
```typescript
const result = await trpc.orders.updateShippingCost.mutate({
  id: "order123",
  organizationId: "org123",
  pickPackCost: 20,
  bubbleCost: 5,
  paperInsideCost: 3,
  cancelOrderCost: 0,
  codCost: 21,
  boxCost: 0,
  deliveryFeeCost: 0
});
```

**Process**:
1. Retrieves order
2. Retrieves organization
3. Calculates total shipping cost
4. Validates sufficient credits
5. Deducts credits from organization
6. Logs credit transaction
7. Updates order with shipping costs
8. Returns success and new balance

**Note**: Some costs are per-item and will be multiplied by order quantity internally.

---

## Users Router

**Location**: `server/routers/users.ts`

User and credit management endpoints.

### `users.list`

List all users with their organization data.

**Type**: `query`

**Input**: None

**Output**:
```typescript
Array<{
  _id: string;
  accountId: string;
  organizationId: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "member";
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  credits: number;         // Organization credits (enriched)
  organizationName: string; // Organization name (enriched)
}>
```

**Example**:
```typescript
const users = await trpc.users.list.query();
```

---

### `users.getById`

Get a user by ID.

**Type**: `query`

**Input**:
```typescript
{
  id: string;
}
```

**Output**:
```typescript
{
  _id: string;
  accountId: string;
  organizationId: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "member";
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

**Errors**:
- "User not found"

**Example**:
```typescript
const user = await trpc.users.getById.query({ id: "user123" });
```

---

### `users.create`

Create a new user (not for signup - use auth.signup instead).

**Type**: `mutation`

**Input**:
```typescript
{
  accountId: string;
  organizationId: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "member";
  isActive?: boolean;
}
```

**Output**:
```typescript
{
  id: string;
}
```

**Errors**:
- "User with this email already exists"

---

### `users.addCredits`

Add credits to an organization (via user).

**Type**: `mutation`

**Input**:
```typescript
{
  userId: string;
  amount: number;        // Positive number
  description: string;
  performedBy?: string;
}
```

**Output**:
```typescript
{
  success: boolean;
  newBalance: number;
}
```

**Errors**:
- "User not found"
- "Organization not found"

**Example**:
```typescript
const result = await trpc.users.addCredits.mutate({
  userId: "user123",
  amount: 1000,
  description: "Monthly credit top-up",
  performedBy: "admin"
});
```

**Process**:
1. Retrieves user and organization
2. Calculates new balance
3. Updates organization credits
4. Logs transaction with type "add"
5. Returns new balance

---

### `users.deductCredits`

Deduct credits from a user (deprecated - use orders.updateShippingCost).

**Type**: `mutation`

**Input**:
```typescript
{
  userId: string;
  amount: number;        // Positive number
  description: string;
  orderId?: string;
  performedBy?: string;
}
```

**Output**:
```typescript
{
  success: boolean;
  newBalance: number;
}
```

**Errors**:
- "User not found"
- "Insufficient credits"

---

### `users.adjustCredits`

Adjust organization credits to a specific amount.

**Type**: `mutation`

**Input**:
```typescript
{
  userId: string;
  newAmount: number;     // Non-negative number
  description: string;
  performedBy?: string;
}
```

**Output**:
```typescript
{
  success: boolean;
  newBalance: number;
}
```

**Errors**:
- "User not found"
- "Organization not found"

**Example**:
```typescript
const result = await trpc.users.adjustCredits.mutate({
  userId: "user123",
  newAmount: 500,
  description: "Balance adjustment",
  performedBy: "admin"
});
```

**Process**:
1. Retrieves user and organization
2. Calculates difference (amount = newAmount - currentBalance)
3. Sets organization credits to exact amount
4. Logs transaction with type "adjust" and calculated amount
5. Returns new balance

---

### `users.getTransactions`

Get credit transactions for a specific user.

**Type**: `query`

**Input**:
```typescript
{
  userId: string;
}
```

**Output**:
```typescript
Array<{
  _id: string;
  organizationId: string;
  organizationName: string;
  userId: string;
  userName: string;
  userEmail: string;
  type: "add" | "deduct" | "adjust" | "refund";
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  description: string;
  orderId?: string;
  performedBy?: string;
  createdAt: Date;
}>
```

**Example**:
```typescript
const transactions = await trpc.users.getTransactions.query({ userId: "user123" });
```

---

### `users.getAllTransactions`

Get all credit transactions (admin use - last 100).

**Type**: `query`

**Input**: None

**Output**:
```typescript
Array<CreditTransaction>  // Same as getTransactions, limited to 100 most recent
```

**Example**:
```typescript
const allTransactions = await trpc.users.getAllTransactions.query();
```

---

## Organizations Router

**Location**: `server/routers/organizations.ts`

Organization management endpoints.

### `organizations.list`

List all organizations.

**Type**: `query`

**Input**: None

**Output**:
```typescript
Array<{
  _id: string;
  name: string;
  credits: number;
  ownerId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}>
```

**Example**:
```typescript
const orgs = await trpc.organizations.list.query();
```

---

### `organizations.getById`

Get organization by ID.

**Type**: `query`

**Input**:
```typescript
{
  id: string;
}
```

**Output**:
```typescript
{
  _id: string;
  name: string;
  credits: number;
  ownerId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

**Errors**:
- "Organization not found"

---

### `organizations.addCredits`

Add credits to an organization directly.

**Type**: `mutation`

**Input**:
```typescript
{
  organizationId: string;
  amount: number;         // Positive number
  description: string;
  performedBy?: string;
  performedByName?: string;
}
```

**Output**:
```typescript
{
  success: boolean;
  newBalance: number;
}
```

**Example**:
```typescript
const result = await trpc.organizations.addCredits.mutate({
  organizationId: "org123",
  amount: 1000,
  description: "Monthly credit top-up",
  performedBy: "admin123",
  performedByName: "Admin User"
});
```

---

### `organizations.adjustCredits`

Adjust organization credits to specific amount.

**Type**: `mutation`

**Input**:
```typescript
{
  organizationId: string;
  newAmount: number;      // Non-negative number
  description: string;
  performedBy?: string;
  performedByName?: string;
}
```

**Output**:
```typescript
{
  success: boolean;
  newBalance: number;
}
```

**Example**:
```typescript
const result = await trpc.organizations.adjustCredits.mutate({
  organizationId: "org123",
  newAmount: 500,
  description: "Balance correction",
  performedBy: "admin123",
  performedByName: "Admin User"
});
```

---

### `organizations.getTransactions`

Get credit transactions for a specific organization.

**Type**: `query`

**Input**:
```typescript
{
  organizationId: string;
}
```

**Output**:
```typescript
Array<CreditTransaction>
```

---

### `organizations.getAllTransactions`

Get all credit transactions (admin - last 100).

**Type**: `query`

**Input**: None

**Output**:
```typescript
Array<CreditTransaction>  // Limited to 100 most recent
```

---

## tRPC Client Usage

### Setup

The tRPC client is configured in `lib/trpc-client.ts`:

```typescript
import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@/server';

export const trpc = createTRPCReact<AppRouter>();
```

### Provider Setup

Wrap your app with providers in `app/providers.tsx`:

```typescript
import { trpc } from '@/lib/trpc-client';

const queryClient = new QueryClient();
const trpcClient = trpc.createClient({
  url: '/api/trpc'
});

function App({ children }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
```

### Using in Components

**Queries** (GET data):
```typescript
const { data, isLoading, error } = trpc.orders.list.useQuery();

if (isLoading) return <div>Loading...</div>;
if (error) return <div>Error: {error.message}</div>;

return <div>{data.map(order => <OrderCard order={order} />)}</div>;
```

**Mutations** (POST/PUT/DELETE):
```typescript
const utils = trpc.useUtils();
const createOrder = trpc.orders.create.useMutation({
  onSuccess: () => {
    utils.orders.list.invalidate(); // Refresh order list
  }
});

const handleSubmit = () => {
  createOrder.mutate({
    productName: "Product",
    // ... other fields
  });
};

return (
  <button
    onClick={handleSubmit}
    disabled={createOrder.isPending}
  >
    {createOrder.isPending ? "Creating..." : "Create Order"}
  </button>
);
```

### Optimistic Updates

```typescript
const updateStatus = trpc.orders.updateStatus.useMutation({
  onMutate: async (newStatus) => {
    // Cancel outgoing queries
    await utils.orders.list.cancel();

    // Snapshot previous value
    const previous = utils.orders.list.getData();

    // Optimistically update
    utils.orders.list.setData(undefined, (old) =>
      old?.map(order =>
        order._id === newStatus.id
          ? { ...order, status: newStatus.status }
          : order
      )
    );

    return { previous };
  },
  onError: (err, newStatus, context) => {
    // Rollback on error
    utils.orders.list.setData(undefined, context.previous);
  },
  onSettled: () => {
    // Refetch after mutation
    utils.orders.list.invalidate();
  }
});
```

---

## Type Safety

### Automatic Type Inference

tRPC automatically infers types from your router:

```typescript
// Server-side router
export const ordersRouter = router({
  create: publicProcedure
    .input(OrderSchema)
    .mutation(async ({ input }) => {
      // input is typed as Order
      return { id: "123" };
    })
});

// Client-side usage
const result = await trpc.orders.create.mutate(data);
// result is typed as { id: string }
```

### Zod Validation

All inputs use Zod schemas for validation:

```typescript
import { z } from 'zod';

const CreateOrderInput = z.object({
  productName: z.string().min(1),
  price: z.number().positive(),
  quantity: z.number().int().positive()
});

// Automatically validates input
.input(CreateOrderInput)
```

### Type Exports

Import types from your schemas:

```typescript
import type { Order, OrderStatus, Channel } from '@/lib/types';
```

---

## Rate Limiting

Currently not implemented. Consider adding for production:

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
```

---

## Testing

### Example Test

```typescript
import { appRouter } from '@/server';
import { createInnerTRPCContext } from '@/server/trpc';

describe('Orders Router', () => {
  it('should create an order', async () => {
    const ctx = createInnerTRPCContext({ userId: 'user123' });
    const caller = appRouter.createCaller(ctx);

    const result = await caller.orders.create({
      organizationId: 'org123',
      productName: 'Test Product',
      price: 100,
      quantity: 1,
      channel: 'line',
      customerName: 'Test Customer',
      customerContact: '123456789',
      shippingAddress: 'Test Address',
      createdBy: 'user123'
    });

    expect(result.id).toBeDefined();
  });
});
```

---

## Related Documentation

- [Database Schema](./database-schema.md) - Database structure
- [Features](./features.md) - Feature documentation
- [Getting Started](./getting-started.md) - Setup guide
