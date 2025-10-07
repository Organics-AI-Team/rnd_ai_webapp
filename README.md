# Supplement Management System

A stock management web application built with Next.js 15, TypeScript, MongoDB, and tRPC for managing supplement orders and tracking logistics.

## Features

- **Order Entry**: Add new orders with product details, pricing, and customer information
- **Multi-Channel Support**: Track orders from LINE, Shopee, Lazada, and other channels
- **Admin Dashboard**: View all orders with real-time statistics
- **Status Management**: Update order status (pending, processing, sent to logistic, delivered, cancelled)
- **Analytics**: Track total orders, pending items, and total revenue

## Tech Stack

- **Frontend**: Next.js 15 (App Router), React 19, TypeScript
- **Styling**: Tailwind CSS, shadcn/ui components
- **Backend**: tRPC for type-safe API
- **Database**: MongoDB
- **State Management**: TanStack Query (React Query)

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
MONGODB_URI=mongodb://localhost:27017/supplement_management
```

Or update with your MongoDB connection string.

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

### 4. Build for Production

```bash
npm run build
npm start
```

## Project Structure

```
├── app/                    # Next.js app directory
│   ├── api/trpc/          # tRPC API routes
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Home page
│   ├── providers.tsx      # React Query & tRPC providers
│   └── globals.css        # Global styles
├── components/            # React components
│   ├── ui/               # shadcn/ui components
│   ├── order-form.tsx    # Order entry form
│   └── dashboard.tsx     # Admin dashboard
├── lib/                  # Utilities and configurations
│   ├── mongodb.ts        # MongoDB client
│   ├── trpc-client.ts    # tRPC client setup
│   ├── types.ts          # TypeScript types and Zod schemas
│   └── utils.ts          # Utility functions
└── server/               # tRPC server
    ├── index.ts          # Main router
    ├── trpc.ts           # tRPC initialization
    └── routers/          # API route handlers
        └── orders.ts     # Orders API

```

## Database Schema

### Orders Collection

```typescript
{
  _id: ObjectId,
  productName: string,
  price: number,
  quantity: number,
  channel: "line" | "shopee" | "lazada" | "other",
  customerName: string,
  customerContact: string,
  shippingAddress: string,
  status: "pending" | "processing" | "sent_to_logistic" | "delivered" | "cancelled",
  createdAt: Date,
  updatedAt: Date
}
```

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint

## Features Breakdown

### Order Form
- Product name and pricing input
- Quantity selection
- Sales channel dropdown (LINE, Shopee, Lazada, Other)
- Customer information (name, contact, shipping address)
- Real-time form validation using Zod

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
  - Order date

### Status Management
Admin can update order status through dropdown:
- Pending (initial status)
- Processing
- Sent to Logistic
- Delivered
- Cancelled

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

## License

ISC
# supplement_management
