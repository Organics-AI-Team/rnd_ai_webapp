# Database Schema Documentation

This document provides comprehensive information about the MongoDB database schema used in the Supplement Management System.

## Table of Contents

- [Database Overview](#database-overview)
- [Collections](#collections)
  - [Accounts](#accounts-collection)
  - [Users](#users-collection)
  - [Organizations](#organizations-collection)
  - [Orders](#orders-collection)
  - [Credit Transactions](#credit-transactions-collection)
  - [Sessions](#sessions-collection)
- [Relationships](#relationships)
- [Indexes](#indexes)
- [Data Types](#data-types)
- [Sample Data](#sample-data)

---

## Database Overview

**Database Name**: `supplement_management`

**Type**: MongoDB (NoSQL)

**Total Collections**: 6
- accounts
- users
- organizations
- orders
- credit_transactions
- sessions

**Key Characteristics**:
- Multi-tenant architecture
- Organization-based data isolation
- Referential relationships via IDs
- Audit trail for credit transactions

---

## Collections

### Accounts Collection

**Purpose**: Stores authentication credentials for user accounts.

**Collection Name**: `accounts`

**Schema**:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId | Auto | Auto-generated | Unique account identifier |
| `email` | string | Yes | - | User's email address (unique) |
| `passwordHash` | string | Yes | - | Bcrypt hashed password |
| `isVerified` | boolean | Yes | false | Email verification status |
| `isActive` | boolean | Yes | true | Account active status |
| `createdAt` | Date | Yes | Now | Account creation timestamp |
| `updatedAt` | Date | Yes | Now | Last update timestamp |

**TypeScript Interface**:
```typescript
interface Account {
  _id: string;
  email: string;
  passwordHash: string;
  isVerified: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

**Validation Rules**:
- `email` must be valid email format
- `email` must be unique
- `passwordHash` must be bcrypt hash (never plain text)

**Indexes**:
- `email` (unique)
- `isActive`

**Example Document**:
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "email": "user@example.com",
  "passwordHash": "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy",
  "isVerified": false,
  "isActive": true,
  "createdAt": "2024-10-07T10:00:00.000Z",
  "updatedAt": "2024-10-07T10:00:00.000Z"
}
```

---

### Users Collection

**Purpose**: Stores user profile information and organization relationships.

**Collection Name**: `users`

**Schema**:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId | Auto | Auto-generated | Unique user identifier |
| `accountId` | string | Yes | - | Reference to accounts._id |
| `organizationId` | string | Yes | - | Reference to organizations._id |
| `email` | string | Yes | - | User's email (denormalized) |
| `name` | string | Yes | - | User's full name |
| `role` | enum | Yes | "member" | User role: "owner", "admin", "member" |
| `isActive` | boolean | Yes | true | User active status |
| `createdAt` | Date | Yes | Now | User creation timestamp |
| `updatedAt` | Date | Yes | Now | Last update timestamp |

**TypeScript Interface**:
```typescript
type UserRole = "owner" | "admin" | "member";

interface User {
  _id: string;
  accountId: string;
  organizationId: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

**Validation Rules**:
- `accountId` must reference existing account
- `organizationId` must reference existing organization
- `email` must be valid email format
- `name` cannot be empty
- `role` must be one of: "owner", "admin", "member"

**Indexes**:
- `accountId` (unique)
- `organizationId`
- `email`

**Example Document**:
```json
{
  "_id": "507f1f77bcf86cd799439012",
  "accountId": "507f1f77bcf86cd799439011",
  "organizationId": "507f1f77bcf86cd799439013",
  "email": "user@example.com",
  "name": "John Doe",
  "role": "owner",
  "isActive": true,
  "createdAt": "2024-10-07T10:00:00.000Z",
  "updatedAt": "2024-10-07T10:00:00.000Z"
}
```

---

### Organizations Collection

**Purpose**: Stores organization information and credit balances.

**Collection Name**: `organizations`

**Schema**:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId | Auto | Auto-generated | Unique organization identifier |
| `name` | string | Yes | - | Organization name |
| `credits` | number | Yes | 0 | Current credit balance (THB) |
| `ownerId` | string | Yes | - | Reference to users._id (owner) |
| `isActive` | boolean | Yes | true | Organization active status |
| `createdAt` | Date | Yes | Now | Organization creation timestamp |
| `updatedAt` | Date | Yes | Now | Last update timestamp |

**TypeScript Interface**:
```typescript
interface Organization {
  _id: string;
  name: string;
  credits: number;
  ownerId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

**Validation Rules**:
- `name` cannot be empty
- `credits` must be a number (can be negative for overdraft)
- `ownerId` must reference existing user

**Indexes**:
- `ownerId`
- `isActive`

**Example Document**:
```json
{
  "_id": "507f1f77bcf86cd799439013",
  "name": "Acme Supplements",
  "credits": 1500.50,
  "ownerId": "507f1f77bcf86cd799439012",
  "isActive": true,
  "createdAt": "2024-10-07T10:00:00.000Z",
  "updatedAt": "2024-10-07T10:05:00.000Z"
}
```

---

### Orders Collection

**Purpose**: Stores order information including product details, customer information, and shipping costs.

**Collection Name**: `orders`

**Schema**:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId | Auto | Auto-generated | Unique order identifier |
| `organizationId` | string | Yes | - | Reference to organizations._id |
| `productCode` | string | No | - | Product SKU or code |
| `productName` | string | Yes | - | Product name |
| `price` | number | Yes | - | Unit price (THB) |
| `quantity` | number | Yes | - | Number of items |
| `channel` | enum | Yes | - | Sales channel: "line", "shopee", "lazada", "other" |
| `customerName` | string | Yes | - | Customer full name |
| `customerContact` | string | Yes | - | Phone or email |
| `shippingAddress` | string | Yes | - | Full delivery address |
| `status` | enum | Yes | "pending" | Order status |
| `createdBy` | string | Yes | - | Reference to users._id |
| `orderDate` | string | No | - | Date when order was placed (from form) |
| `pickPackCost` | number | Yes | 0 | Pick and pack cost (THB) |
| `bubbleCost` | number | Yes | 0 | Bubble wrap cost (THB) |
| `paperInsideCost` | number | Yes | 0 | Paper inside cost (THB) |
| `cancelOrderCost` | number | Yes | 0 | Cancellation fee (THB) |
| `codCost` | number | Yes | 0 | Cash on delivery cost (THB) |
| `boxCost` | number | Yes | 0 | Box cost (THB) |
| `deliveryFeeCost` | number | Yes | 0 | Delivery fee (THB) |
| `totalShippingCost` | number | Yes | 0 | Total shipping cost (THB) |
| `createdAt` | Date | Yes | Now | Order creation timestamp |
| `updatedAt` | Date | Yes | Now | Last update timestamp |

**TypeScript Interface**:
```typescript
type Channel = "line" | "shopee" | "lazada" | "other";
type OrderStatus = "pending" | "processing" | "sent_to_logistic" | "delivered" | "cancelled";

interface Order {
  _id: string;
  organizationId: string;
  productCode?: string;
  productName: string;
  price: number;
  quantity: number;
  channel: Channel;
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
}
```

**Validation Rules**:
- `price` must be positive
- `quantity` must be positive integer
- `channel` must be one of: "line", "shopee", "lazada", "other"
- `status` must be one of: "pending", "processing", "sent_to_logistic", "delivered", "cancelled"
- All cost fields must be non-negative numbers
- `organizationId` must reference existing organization
- `createdBy` must reference existing user

**Indexes**:
- `organizationId`
- `createdBy`
- `status`
- `channel`
- `createdAt` (descending)

**Example Document**:
```json
{
  "_id": "507f1f77bcf86cd799439014",
  "organizationId": "507f1f77bcf86cd799439013",
  "productCode": "SUPP-001",
  "productName": "Vitamin C 1000mg",
  "price": 350.00,
  "quantity": 2,
  "channel": "line",
  "customerName": "Jane Smith",
  "customerContact": "081-234-5678",
  "shippingAddress": "123 Main St, Bangkok 10110",
  "status": "sent_to_logistic",
  "createdBy": "507f1f77bcf86cd799439012",
  "orderDate": "2024-10-07",
  "pickPackCost": 20.00,
  "bubbleCost": 10.00,
  "paperInsideCost": 6.00,
  "cancelOrderCost": 0.00,
  "codCost": 21.00,
  "boxCost": 0.00,
  "deliveryFeeCost": 0.00,
  "totalShippingCost": 57.00,
  "createdAt": "2024-10-07T10:00:00.000Z",
  "updatedAt": "2024-10-07T10:15:00.000Z"
}
```

**Calculated Fields**:
- Order Total = `price × quantity`
- Total Shipping Cost = sum of all cost fields

---

### Credit Transactions Collection

**Purpose**: Audit trail for all credit-related transactions.

**Collection Name**: `credit_transactions`

**Schema**:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId | Auto | Auto-generated | Unique transaction identifier |
| `organizationId` | string | Yes | - | Reference to organizations._id |
| `organizationName` | string | Yes | - | Organization name (denormalized) |
| `type` | enum | Yes | - | Transaction type |
| `amount` | number | Yes | - | Transaction amount (positive or negative) |
| `balanceBefore` | number | Yes | - | Balance before transaction |
| `balanceAfter` | number | Yes | - | Balance after transaction |
| `description` | string | Yes | - | Transaction description |
| `orderId` | string | No | - | Reference to orders._id (if applicable) |
| `performedBy` | string | No | - | User ID who performed action |
| `performedByName` | string | No | - | User name (denormalized) |
| `createdAt` | Date | Yes | Now | Transaction timestamp |

**TypeScript Interface**:
```typescript
type CreditTransactionType = "add" | "deduct" | "adjust" | "refund";

interface CreditTransaction {
  _id: string;
  organizationId: string;
  organizationName: string;
  type: CreditTransactionType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  description: string;
  orderId?: string;
  performedBy?: string;
  performedByName?: string;
  createdAt: Date;
}
```

**Validation Rules**:
- `type` must be one of: "add", "deduct", "adjust", "refund"
- `amount` can be positive or negative
- `balanceAfter` should equal `balanceBefore + amount` (for add/deduct)
- `description` cannot be empty

**Transaction Types**:
- **add**: Credits added to organization
- **deduct**: Credits removed (e.g., for shipping)
- **adjust**: Balance adjusted to specific amount
- **refund**: Credits refunded (e.g., cancelled order)

**Indexes**:
- `organizationId`
- `type`
- `createdAt` (descending)
- `orderId`

**Example Documents**:

**Add Transaction**:
```json
{
  "_id": "507f1f77bcf86cd799439015",
  "organizationId": "507f1f77bcf86cd799439013",
  "organizationName": "Acme Supplements",
  "type": "add",
  "amount": 1000.00,
  "balanceBefore": 500.00,
  "balanceAfter": 1500.00,
  "description": "Monthly credit top-up",
  "performedBy": "admin",
  "performedByName": "Admin User",
  "createdAt": "2024-10-07T10:00:00.000Z"
}
```

**Deduct Transaction**:
```json
{
  "_id": "507f1f77bcf86cd799439016",
  "organizationId": "507f1f77bcf86cd799439013",
  "organizationName": "Acme Supplements",
  "type": "deduct",
  "amount": -57.00,
  "balanceBefore": 1500.00,
  "balanceAfter": 1443.00,
  "description": "Shipping cost for order 507f1f77bcf86cd799439014",
  "orderId": "507f1f77bcf86cd799439014",
  "performedBy": "507f1f77bcf86cd799439012",
  "performedByName": "John Doe",
  "createdAt": "2024-10-07T10:15:00.000Z"
}
```

---

### Sessions Collection

**Purpose**: Stores active user sessions for authentication.

**Collection Name**: `sessions`

**Schema**:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId | Auto | Auto-generated | Unique session identifier |
| `accountId` | string | Yes | - | Reference to accounts._id |
| `token` | string | Yes | - | Session token (random string) |
| `expiresAt` | Date | Yes | - | Session expiration timestamp |
| `createdAt` | Date | Yes | Now | Session creation timestamp |

**TypeScript Interface**:
```typescript
interface Session {
  _id: string;
  accountId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
}
```

**Validation Rules**:
- `accountId` must reference existing account
- `token` must be unique
- `expiresAt` must be in the future

**Indexes**:
- `token` (unique)
- `accountId`
- `expiresAt` (TTL index for automatic cleanup)

**Example Document**:
```json
{
  "_id": "507f1f77bcf86cd799439017",
  "accountId": "507f1f77bcf86cd799439011",
  "token": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "expiresAt": "2024-10-14T10:00:00.000Z",
  "createdAt": "2024-10-07T10:00:00.000Z"
}
```

**TTL Index**:
- MongoDB automatically deletes expired sessions
- Index on `expiresAt` field
- Sessions are removed when `expiresAt` is reached

---

## Relationships

### Entity Relationship Diagram

```
┌─────────────┐
│  Accounts   │
│  ─────────  │
│  _id        │◄────┐
│  email      │     │
│  password   │     │
└─────────────┘     │
                    │
                    │ accountId
                    │
                    │
┌─────────────┐     │      ┌──────────────┐
│ Sessions    │     │      │ Users        │
│ ──────────  │     │      │ ──────────── │
│ _id         │     └──────┤ _id          │
│ accountId   ├────────────┤ accountId    │◄───────┐
│ token       │            │ organization │        │
│ expiresAt   │            │ Id           ├────┐   │
└─────────────┘            │ email        │    │   │
                           │ name         │    │   │
                           │ role         │    │   │
                           └──────────────┘    │   │ createdBy
                                               │   │
                                               │   │
                           ┌──────────────┐    │   │
                           │Organizations │    │   │
                           │──────────────│    │   │
                           │ _id          │◄───┘   │
                           │ name         │        │
                           │ credits      │        │
                           │ ownerId      ├────────┘
                           └──────┬───────┘
                                  │
                                  │ organizationId
                                  │
                                  ▼
                           ┌──────────────┐
                           │ Orders       │
                           │──────────────│
                           │ _id          │
                           │ organization │◄───┐
                           │ Id           │    │
                           │ productName  │    │
                           │ price        │    │ orderId
                           │ ...          │    │ (optional)
                           └──────────────┘    │
                                               │
                                               │
                           ┌──────────────┐    │
                           │ Credit       │    │
                           │ Transactions │    │
                           │──────────────│    │
                           │ _id          │    │
                           │ organization │    │
                           │ Id           │    │
                           │ type         │    │
                           │ amount       │    │
                           │ orderId      ├────┘
                           └──────────────┘
```

### Relationship Details

**1. Account → User**
- Relationship: One-to-One
- Foreign Key: `users.accountId → accounts._id`
- Constraint: Each account has exactly one user profile

**2. User → Organization**
- Relationship: Many-to-One
- Foreign Key: `users.organizationId → organizations._id`
- Constraint: Multiple users can belong to one organization

**3. Organization → Users (Owner)**
- Relationship: One-to-One
- Foreign Key: `organizations.ownerId → users._id`
- Constraint: Each organization has one owner

**4. User → Orders**
- Relationship: One-to-Many
- Foreign Key: `orders.createdBy → users._id`
- Constraint: One user can create multiple orders

**5. Organization → Orders**
- Relationship: One-to-Many
- Foreign Key: `orders.organizationId → organizations._id`
- Constraint: One organization can have multiple orders

**6. Organization → Credit Transactions**
- Relationship: One-to-Many
- Foreign Key: `credit_transactions.organizationId → organizations._id`
- Constraint: One organization can have multiple transactions

**7. Order → Credit Transaction**
- Relationship: One-to-One (optional)
- Foreign Key: `credit_transactions.orderId → orders._id`
- Constraint: An order may have associated credit transaction(s)

**8. Account → Sessions**
- Relationship: One-to-Many
- Foreign Key: `sessions.accountId → accounts._id`
- Constraint: One account can have multiple active sessions

---

## Indexes

### Recommended Indexes

**accounts**:
```javascript
db.accounts.createIndex({ email: 1 }, { unique: true })
db.accounts.createIndex({ isActive: 1 })
```

**users**:
```javascript
db.users.createIndex({ accountId: 1 }, { unique: true })
db.users.createIndex({ organizationId: 1 })
db.users.createIndex({ email: 1 })
```

**organizations**:
```javascript
db.organizations.createIndex({ ownerId: 1 })
db.organizations.createIndex({ isActive: 1 })
```

**orders**:
```javascript
db.orders.createIndex({ organizationId: 1 })
db.orders.createIndex({ createdBy: 1 })
db.orders.createIndex({ status: 1 })
db.orders.createIndex({ channel: 1 })
db.orders.createIndex({ createdAt: -1 })
db.orders.createIndex({ organizationId: 1, status: 1 })
```

**credit_transactions**:
```javascript
db.credit_transactions.createIndex({ organizationId: 1 })
db.credit_transactions.createIndex({ type: 1 })
db.credit_transactions.createIndex({ createdAt: -1 })
db.credit_transactions.createIndex({ orderId: 1 })
```

**sessions**:
```javascript
db.sessions.createIndex({ token: 1 }, { unique: true })
db.sessions.createIndex({ accountId: 1 })
db.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
```

---

## Data Types

### MongoDB Field Types

| Schema Type | MongoDB Type | TypeScript Type | Example |
|-------------|-------------|----------------|---------|
| ObjectId | ObjectId | string | `"507f1f77bcf86cd799439011"` |
| string | String | string | `"John Doe"` |
| number | Double/Int32 | number | `123.45` |
| boolean | Boolean | boolean | `true` |
| Date | Date | Date | `ISODate("2024-10-07T10:00:00Z")` |
| enum | String | union type | `"pending"` |

### Zod Validation Types

All schemas use Zod for runtime validation:

```typescript
import { z } from "zod";

// Example: Order Schema
export const OrderSchema = z.object({
  _id: z.string().optional(),
  organizationId: z.string(),
  productCode: z.string().optional(),
  productName: z.string().min(1, "Product name is required"),
  price: z.number().positive("Price must be positive"),
  quantity: z.number().int().positive("Quantity must be positive"),
  // ... more fields
});

export type Order = z.infer<typeof OrderSchema>;
```

---

## Sample Data

### Development Seed Data

Use `npm run seed-admin` to create:

**Account**:
```json
{
  "email": "admin@test.com",
  "passwordHash": "$2a$10$...",
  "isVerified": false,
  "isActive": true
}
```

**Organization**:
```json
{
  "name": "Test Organization",
  "credits": 1000.00,
  "ownerId": "...",
  "isActive": true
}
```

**User**:
```json
{
  "accountId": "...",
  "organizationId": "...",
  "email": "admin@test.com",
  "name": "Admin User",
  "role": "owner",
  "isActive": true
}
```

---

## Database Maintenance

### Backup

```bash
# Backup entire database
mongodump --uri="mongodb://localhost:27017/supplement_management" --out=/backup

# Restore database
mongorestore --uri="mongodb://localhost:27017/supplement_management" /backup/supplement_management
```

### Cleanup Old Sessions

```bash
# Sessions are automatically cleaned up via TTL index
# Manual cleanup if needed:
db.sessions.deleteMany({ expiresAt: { $lt: new Date() } })
```

### Archive Old Orders

```bash
# Archive orders older than 1 year
db.orders_archive.insertMany(
  db.orders.find({ createdAt: { $lt: new Date("2023-01-01") } }).toArray()
)
db.orders.deleteMany({ createdAt: { $lt: new Date("2023-01-01") } })
```

---

## Migration Guide

When schema changes are needed:

1. Create migration script in `scripts/migrations/`
2. Update schema in `lib/types.ts`
3. Run migration on staging
4. Test thoroughly
5. Run migration on production
6. Update documentation

### Example Migration Script

```typescript
// scripts/migrations/001_add_product_code.ts
import { connectToDatabase } from "@/lib/mongodb";

async function migrate() {
  const client = await connectToDatabase();
  const db = client.db();

  // Add productCode field to all orders
  await db.collection("orders").updateMany(
    { productCode: { $exists: false } },
    { $set: { productCode: null } }
  );

  console.log("Migration completed");
}

migrate();
```

---

## Performance Considerations

1. **Use Indexes**: Ensure all frequently queried fields are indexed
2. **Denormalize When Needed**: Store organization name in transactions to avoid joins
3. **Archive Old Data**: Move old orders to archive collection
4. **Monitor Query Performance**: Use MongoDB profiler to identify slow queries
5. **Use Projection**: Only fetch required fields in queries
6. **Batch Operations**: Use `bulkWrite()` for multiple updates

---

## Security Considerations

1. **Never Store Plain Text Passwords**: Always use bcrypt hashing
2. **Sanitize Input**: Validate all input using Zod schemas
3. **Use Environment Variables**: Never hard-code connection strings
4. **Implement Access Control**: Check organization and user permissions
5. **Audit Trail**: Log all credit transactions
6. **Session Expiration**: Set reasonable expiration times
7. **Regular Backups**: Schedule automated backups

---

## Related Documentation

- [API Documentation](./api-documentation.md) - Learn about API endpoints
- [Getting Started](./getting-started.md) - Set up the database
- [Features](./features.md) - Understand data usage
