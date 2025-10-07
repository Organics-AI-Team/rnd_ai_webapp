# Getting Started Guide

This guide will help you set up and run the Supplement Management System on your local machine.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Tech Stack](#tech-stack)
- [Installation](#installation)
- [Environment Configuration](#environment-configuration)
- [Database Setup](#database-setup)
- [Seeding Initial Data](#seeding-initial-data)
- [Running the Application](#running-the-application)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)

---

## Prerequisites

Before you begin, ensure you have the following installed on your system:

### Required
- **Node.js** 18.0 or higher
- **npm** 9.0 or higher (comes with Node.js)
- **MongoDB** 6.0 or higher

### Optional
- **Git** for version control
- **VS Code** or your preferred code editor

### Checking Prerequisites

```bash
# Check Node.js version
node --version
# Should output v18.x.x or higher

# Check npm version
npm --version
# Should output 9.x.x or higher

# Check MongoDB version
mongod --version
# Should output 6.x.x or higher
```

---

## Tech Stack

### Frontend
- **Next.js 15** - React framework with App Router
- **React 19** - UI library
- **TypeScript 5.9.3** - Type-safe JavaScript
- **Tailwind CSS** - Utility-first CSS framework
- **shadcn/ui** - Re-usable component library
- **Lucide React** - Icon library

### Backend
- **tRPC 11.6.0** - End-to-end typesafe API
- **Zod** - TypeScript-first schema validation
- **bcryptjs** - Password hashing

### Database
- **MongoDB 6.20.0** - NoSQL database
- **MongoDB Native Driver** - Direct MongoDB connection

### State Management
- **TanStack Query (React Query)** - Server state management
- **React Context** - Client state management

### Additional Tools
- **jsPDF** - PDF generation
- **jspdf-autotable** - Table plugin for jsPDF

---

## Installation

### Step 1: Clone the Repository

```bash
git clone <repository-url>
cd supplement_management
```

### Step 2: Install Dependencies

```bash
npm install
```

This will install all required dependencies listed in `package.json`.

### Step 3: Verify Installation

```bash
# Check if all dependencies are installed
npm list --depth=0
```

---

## Environment Configuration

### Step 1: Create Environment File

Create a `.env.local` file in the root directory:

```bash
touch .env.local
```

### Step 2: Configure Environment Variables

Add the following configuration to `.env.local`:

```env
# MongoDB Connection String
MONGODB_URI=mongodb://localhost:27017/supplement_management

# Optional: MongoDB Atlas Connection String
# MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/supplement_management?retryWrites=true&w=majority
```

### Environment Variables Explained

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `MONGODB_URI` | MongoDB connection string | Yes | - |

### Security Notes

- **Never commit** `.env.local` to version control
- The `.env.local` file is already in `.gitignore`
- Use strong passwords for production databases
- For production, use environment variables provided by your hosting platform

---

## Database Setup

### Option 1: Local MongoDB

#### Step 1: Start MongoDB Service

**macOS (Homebrew):**
```bash
brew services start mongodb-community
```

**Linux (systemd):**
```bash
sudo systemctl start mongod
```

**Windows:**
```bash
net start MongoDB
```

#### Step 2: Verify MongoDB is Running

```bash
mongosh
# Should connect to MongoDB shell
```

#### Step 3: Create Database (Optional)

MongoDB will automatically create the database on first use, but you can manually create it:

```bash
mongosh
use supplement_management
db.createCollection("users")
exit
```

### Option 2: MongoDB Atlas (Cloud)

#### Step 1: Create MongoDB Atlas Account

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Sign up for a free account
3. Create a new cluster (free tier available)

#### Step 2: Get Connection String

1. Click "Connect" on your cluster
2. Choose "Connect your application"
3. Copy the connection string
4. Replace `<password>` with your database password
5. Update `MONGODB_URI` in `.env.local`

#### Step 3: Whitelist IP Address

1. Go to "Network Access" in Atlas
2. Add your IP address or use `0.0.0.0/0` for development (not recommended for production)

---

## Seeding Initial Data

### Create Test Admin Account

To create a test admin account with initial credits:

```bash
npm run seed-admin
```

This script will create:
- **Email**: admin@test.com
- **Password**: admin123
- **Organization**: Test Organization
- **Initial Credits**: 1000 THB
- **Role**: Owner

### Verify Seeding

```bash
mongosh
use supplement_management
db.accounts.find()
db.users.find()
db.organizations.find()
```

### Clean Up Test Data (Optional)

To remove test data:

```bash
npx tsx scripts/cleanup-admin.ts
```

---

## Running the Application

### Development Mode

Start the development server with hot-reloading:

```bash
npm run dev
```

The application will be available at:
- **URL**: http://localhost:3000
- **Port**: 3000 (default)

### Production Build

Build the application for production:

```bash
npm run build
```

### Start Production Server

After building, start the production server:

```bash
npm start
```

### Other Commands

```bash
# Run ESLint
npm run lint

# Test password hashing
npx tsx scripts/test-password.ts
```

---

## Project Structure

```
supplement_management/
├── app/                          # Next.js App Router
│   ├── api/                     # API Routes
│   │   ├── auth/               # Auth endpoints
│   │   │   ├── login/          # POST /api/auth/login
│   │   │   ├── logout/         # POST /api/auth/logout
│   │   │   └── verify/         # GET /api/auth/verify
│   │   └── trpc/               # tRPC handler
│   │       └── [trpc]/
│   │           └── route.ts    # tRPC HTTP handler
│   ├── admin/                   # Admin pages
│   │   └── credits/            # Credit management
│   │       └── page.tsx
│   ├── dashboard/              # Dashboard page
│   │   └── page.tsx
│   ├── login/                  # Login page
│   │   └── page.tsx
│   ├── shipping/               # Shipping management
│   │   └── page.tsx
│   ├── signup/                 # Signup page
│   │   └── page.tsx
│   ├── layout.tsx              # Root layout
│   ├── page.tsx                # Home page (order form)
│   ├── providers.tsx           # React Query & tRPC providers
│   └── globals.css             # Global styles
│
├── components/                  # React Components
│   ├── ui/                     # shadcn/ui components
│   │   ├── badge.tsx
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── input.tsx
│   │   ├── label.tsx
│   │   ├── select.tsx
│   │   └── table.tsx
│   ├── conditional-layout.tsx  # Layout switcher
│   ├── dashboard.tsx           # Dashboard component
│   ├── navigation.tsx          # Navigation bar
│   └── order-form.tsx          # Order form component
│
├── lib/                         # Utilities & Configurations
│   ├── auth-context.tsx        # Auth context provider
│   ├── mongodb.ts              # MongoDB client
│   ├── trpc-client.ts          # tRPC client setup
│   ├── types.ts                # TypeScript types & Zod schemas
│   └── utils.ts                # Utility functions
│
├── server/                      # tRPC Server
│   ├── routers/                # API route handlers
│   │   ├── auth.ts            # Authentication API
│   │   ├── orders.ts          # Orders API
│   │   ├── users.ts           # Users API
│   │   └── organizations.ts   # Organizations API
│   ├── index.ts                # Main router
│   └── trpc.ts                 # tRPC initialization
│
├── scripts/                     # Utility Scripts
│   ├── cleanup-admin.ts        # Clean test data
│   └── test-password.ts        # Test password hashing
│
├── docs/                        # Documentation
│   ├── README.md               # Documentation index
│   ├── getting-started.md      # This file
│   ├── features.md             # Feature documentation
│   ├── database-schema.md      # Database schema
│   ├── api-documentation.md    # API reference
│   ├── deployment.md           # Deployment guide
│   └── prd.md                  # Product requirements
│
├── middleware.ts                # Auth middleware
├── next.config.ts               # Next.js configuration
├── tailwind.config.ts           # Tailwind configuration
├── tsconfig.json                # TypeScript configuration
├── package.json                 # Dependencies & scripts
├── .env.local                   # Environment variables (not committed)
├── .gitignore                   # Git ignore rules
└── README.md                    # Project README
```

---

## Development Workflow

### 1. Start Development Server

```bash
npm run dev
```

### 2. Access the Application

Open your browser and navigate to:
- **Home (Order Form)**: http://localhost:3000
- **Login**: http://localhost:3000/login
- **Signup**: http://localhost:3000/signup
- **Dashboard**: http://localhost:3000/dashboard
- **Shipping**: http://localhost:3000/shipping
- **Admin Credits**: http://localhost:3000/admin/credits

### 3. First-time Setup Flow

1. **Create an Account**: Go to http://localhost:3000/signup
   - Enter email, password, name, and organization name
   - This creates an account, user, and organization

2. **Login**: Go to http://localhost:3000/login
   - Use your email and password

3. **Create an Order**: Go to http://localhost:3000 (home page)
   - Fill in product details
   - Select channel
   - Enter customer information

4. **View Dashboard**: Go to http://localhost:3000/dashboard
   - See all orders
   - View statistics
   - Update order statuses
   - Export to PDF

5. **Manage Shipping**: Go to http://localhost:3000/shipping
   - Configure shipping rates
   - Calculate shipping costs
   - Confirm shipments

6. **Manage Credits**: Go to http://localhost:3000/admin/credits (owner/admin only)
   - Add credits to organizations
   - Adjust credit balances
   - View transaction history

### 4. Making Changes

When developing:

1. **Edit Files**: Make changes to any file
2. **Hot Reload**: Changes are automatically reflected in the browser
3. **Check Console**: Monitor browser console and terminal for errors
4. **Test Changes**: Verify functionality works as expected

### 5. Database Inspection

To inspect the database during development:

```bash
mongosh
use supplement_management

# View all collections
show collections

# Query data
db.users.find().pretty()
db.orders.find().pretty()
db.organizations.find().pretty()
```

---

## Troubleshooting

### MongoDB Connection Issues

**Error**: `MongoServerError: connect ECONNREFUSED`

**Solution**:
1. Ensure MongoDB is running: `brew services list` (macOS)
2. Check MongoDB port: Default is 27017
3. Verify connection string in `.env.local`

### Port Already in Use

**Error**: `Port 3000 is already in use`

**Solution**:
```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9

# Or use a different port
PORT=3001 npm run dev
```

### Module Not Found

**Error**: `Cannot find module...`

**Solution**:
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### TypeScript Errors

**Solution**:
```bash
# Check TypeScript configuration
npx tsc --noEmit

# Restart TypeScript server in VS Code
# Command Palette: TypeScript: Restart TS Server
```

---

## Next Steps

Now that you have the application running:

1. **Read the [Features Documentation](./features.md)** to understand all capabilities
2. **Review the [Database Schema](./database-schema.md)** to understand data structure
3. **Check the [API Documentation](./api-documentation.md)** to understand API endpoints
4. **Prepare for [Deployment](./deployment.md)** when ready for production

---

## Need Help?

If you encounter issues:
1. Check the [Troubleshooting](#troubleshooting) section above
2. Review error messages in terminal and browser console
3. Verify all prerequisites are installed correctly
4. Ensure MongoDB is running and accessible
5. Check that `.env.local` is configured correctly
