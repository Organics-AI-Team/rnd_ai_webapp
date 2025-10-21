# R&D AI Management System

A comprehensive multi-tenant order and logistics management web application built with Next.js 15, TypeScript, MongoDB, and tRPC. Features user authentication, organization-based access control, credit system for shipping costs, and complete order lifecycle management.

## Features

### Authentication & User Management
- **User Registration & Login**: Secure authentication with bcrypt password hashing
- **Multi-tenant Architecture**: Organization-based user isolation
- **Role-based Access**: Owner, Admin, and Member roles
- **Session Management**: Token-based authentication with middleware protection

### Order Management
- **Order Entry**: Create orders with product details, pricing, and customer information
- **Multi-Channel Support**: Track orders from LINE, Shopee, Lazada, and other channels
- **Dashboard**: View all orders with real-time statistics and analytics
- **Status Management**: Update order status (pending, processing, sent to logistic, delivered, cancelled)
- **Order Filtering**: Filter orders by user and organization for data isolation
- **PDF Export**: Export orders to PDF with detailed information

### Shipping & Logistics
- **Shipping Cost Calculator**: Detailed cost breakdown including:
  - Pick & Pack costs (per order)
  - Bubble wrap (per item)
  - Paper inside (per item)
  - Cancel order fees
  - COD fees (percentage-based)
  - Box costs (per item)
  - Delivery fees (per item)
- **Configurable Rates**: Adjust shipping rates in real-time
- **Cost Preview**: Preview shipping costs before confirming
- **Shipping Workflow**: Manage pending → shipped → delivered workflow

### Credit System
- **Organization Credits**: Each organization has a credit balance for shipping costs
- **Credit Management**: Admin can add or adjust credits for organizations
- **Transaction History**: Complete audit trail of all credit transactions
- **Credit Deduction**: Automatic credit deduction when shipping costs are confirmed
- **Insufficient Balance Handling**: Prevents orders from proceeding without adequate credits

### Analytics & Reporting
- **Real-time Statistics**: Track total orders, pending items, and total revenue
- **Channel Analytics**: Breakdown of orders by sales channel
- **Status Overview**: Visual representation of order statuses
- **Transaction Reports**: Detailed credit transaction history

## Tech Stack

- **Frontend**: Next.js 15 (App Router), React 19, TypeScript
- **Styling**: Tailwind CSS, shadcn/ui components, Lucide icons
- **Backend**: tRPC for type-safe API
- **Database**: MongoDB with native driver
- **Authentication**: bcrypt, custom session management
- **Validation**: Zod schemas
- **State Management**: TanStack Query (React Query)
- **PDF Generation**: jsPDF with autotable plugin

## Prerequisites

- Node.js 18+ installed
- MongoDB running locally or a MongoDB connection string

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create a `.env.local` file in the root directory:

```env
MONGODB_URI=mongodb://localhost:27017/rnd_ai
```

### 3. Seed Admin Account (Optional)

Create an admin account for testing:

```bash
npm run seed-admin
```

This creates a test admin account with:
- Email: admin@test.com
- Password: admin123
- Organization: Test Organization
- Initial Credits: 1000 THB

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

### 5. Build for Production

```bash
npm run build
npm start
```

## Project Structure

```
├── app/                      # Next.js app directory
│   ├── api/                 # API routes
│   │   ├── auth/           # Authentication endpoints (login, logout, verify)
│   │   └── trpc/           # tRPC API routes
│   ├── admin/              # Admin-only pages
│   │   └── credits/        # Credit management page
│   ├── dashboard/          # Dashboard page
│   ├── shipping/           # Shipping management page
│   ├── login/              # Login page
│   ├── signup/             # Signup page
│   ├── layout.tsx          # Root layout with navigation
│   ├── page.tsx            # Home page (order form)
│   ├── providers.tsx       # React Query & tRPC providers
│   └── globals.css         # Global styles
├── components/             # React components
│   ├── ui/                # shadcn/ui components
│   ├── conditional-layout.tsx  # Auth-based layout switcher
│   ├── dashboard.tsx      # Order dashboard with analytics
│   ├── navigation.tsx     # Top navigation bar
│   └── order-form.tsx     # Order entry form
├── lib/                   # Utilities and configurations
│   ├── auth-context.tsx   # Auth context provider
│   ├── mongodb.ts         # MongoDB client
│   ├── trpc-client.ts     # tRPC client setup
│   ├── types.ts           # TypeScript types and Zod schemas
│   └── utils.ts           # Utility functions
├── server/                # tRPC server
│   ├── index.ts          # Main router
│   ├── trpc.ts           # tRPC initialization with context
│   └── routers/          # API route handlers
│       ├── auth.ts       # Authentication API
│       ├── orders.ts     # Orders API
│       ├── users.ts      # Users API
│       └── organizations.ts  # Organizations API
├── scripts/              # Utility scripts
│   ├── cleanup-admin.ts  # Clean up test data
│   └── test-password.ts  # Test password hashing
├── middleware.ts         # Auth middleware for protected routes
└── docs/                 # Documentation
    └── prd.md           # Product requirements document
```

## Database Schema

### Accounts Collection
```typescript
{
  _id: ObjectId,
  email: string,
  passwordHash: string,
  isVerified: boolean,
  isActive: boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### Users Collection
```typescript
{
  _id: ObjectId,
  accountId: string,
  organizationId: string,
  email: string,
  name: string,
  role: "owner" | "admin" | "member",
  isActive: boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### Organizations Collection
```typescript
{
  _id: ObjectId,
  name: string,
  credits: number,
  ownerId: string,
  isActive: boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### Orders Collection
```typescript
{
  _id: ObjectId,
  organizationId: string,
  productName: string,
  price: number,
  quantity: number,
  channel: "line" | "shopee" | "lazada" | "other",
  customerName: string,
  customerContact: string,
  shippingAddress: string,
  status: "pending" | "processing" | "sent_to_logistic" | "delivered" | "cancelled",
  createdBy: string,
  // Shipping cost fields
  pickPackCost: number,
  bubbleCost: number,
  paperInsideCost: number,
  cancelOrderCost: number,
  codCost: number,
  boxCost: number,
  deliveryFeeCost: number,
  totalShippingCost: number,
  createdAt: Date,
  updatedAt: Date
}
```

### Credit Transactions Collection
```typescript
{
  _id: ObjectId,
  organizationId: string,
  organizationName: string,
  type: "add" | "deduct" | "adjust" | "refund",
  amount: number,
  balanceBefore: number,
  balanceAfter: number,
  description: string,
  orderId?: string,
  performedBy?: string,
  performedByName?: string,
  createdAt: Date
}
```

### Sessions Collection
```typescript
{
  _id: ObjectId,
  accountId: string,
  token: string,
  expiresAt: Date,
  createdAt: Date
}
```

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint
- `npm run seed-admin` - Create test admin account

## Features Breakdown

### Authentication
- Signup page with email, password, name, and organization name
- Login page with email and password
- Session-based authentication with tokens
- Protected routes using Next.js middleware
- Auth context provider for accessing user data throughout the app
- Logout functionality

### Order Form
- Product name and pricing input
- Quantity selection
- Sales channel dropdown (LINE, Shopee, Lazada, Other)
- Customer information (name, contact, shipping address)
- Real-time form validation using Zod
- Organization validation before order creation

### Dashboard
- Statistics cards showing:
  - Total orders
  - Pending orders
  - Sent to logistic count
  - Total revenue
- Orders table with:
  - Product and customer details
  - Channel badges (color-coded)
  - Status dropdown for quick updates
  - Total price calculation
  - Shipping cost display
  - Order date
  - PDF export functionality
- Filter orders by organization and user

### Shipping Management
- Pending orders section with:
  - Configurable shipping rate settings
  - Real-time cost calculation
  - Detailed cost breakdown view
  - Confirmation modal before processing
  - Credit balance validation
- Shipped orders section for tracking deliveries
- Status update workflow

### Admin Credit Management
- View all users and their organizations
- Display current credit balances
- Add credits with description
- Adjust credits to specific amounts
- Transaction history with:
  - Date and time
  - User information
  - Transaction type (add, deduct, adjust, refund)
  - Amount and balance changes
  - Description

### Badge Component
- Variant-based styling for channels (line, shopee, lazada, other)
- Variant-based styling for order statuses
- Consistent color scheme across the application

## Customization

### Colors
LINE brand color (#00B900) is used as primary. Update in `tailwind.config.ts`:

```typescript
colors: {
  line: {
    DEFAULT: "#00B900",
    dark: "#009900",
  },
}
```

### Adding More Channels
Update `lib/types.ts`:

```typescript
export const Channel = z.enum(["line", "shopee", "lazada", "other", "facebook"]);
```

Then update badge variants in `components/ui/badge.tsx` to include the new channel styling.

### Shipping Cost Configuration
Default shipping rates can be adjusted in the shipping page:
- Pick & Pack: 20 THB per order
- Bubble: 5 THB per item
- Paper inside: 3 THB per item
- Cancel order: 10 THB per order
- COD: 3% of order total
- Box: Configurable per item
- Delivery fee: Configurable per item

## Security Considerations

- Passwords are hashed using bcrypt before storage
- Sessions expire after a set period
- Middleware protects authenticated routes
- Organization-based data isolation prevents cross-tenant data access
- Credit transactions are logged for audit purposes

## License

ISC
