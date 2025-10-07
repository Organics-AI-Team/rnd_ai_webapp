# Features Documentation

This document provides detailed information about all features in the Supplement Management System.

## Table of Contents

- [User Roles](#user-roles)
- [Authentication & User Management](#authentication--user-management)
- [Order Management](#order-management)
- [Shipping & Logistics](#shipping--logistics)
- [Credit System](#credit-system)
- [Analytics & Reporting](#analytics--reporting)
- [UI Components](#ui-components)

---

## User Roles

The system supports three user roles with different access levels:

### Owner
- **Full Access**: Complete control over the organization
- **Permissions**:
  - All Admin permissions
  - Delete organization
  - Transfer ownership
  - View all financial data
  - Manage all users in organization

### Admin
- **Management Access**: Can manage users and settings
- **Permissions**:
  - All Member permissions
  - Manage organization credits
  - Add/remove users
  - View credit transaction history
  - Access admin pages

### Member
- **Basic Access**: Can manage orders and view data
- **Permissions**:
  - Create orders
  - View own orders
  - Update order status
  - View dashboard
  - Manage shipping

---

## Authentication & User Management

### Signup Process

**Location**: `/signup`

**Features**:
- Email and password registration
- Organization creation during signup
- Automatic owner role assignment
- Password validation (minimum 6 characters)
- Email format validation

**Workflow**:
1. User enters email, password, name, and organization name
2. System validates input
3. Password is hashed using bcrypt
4. Account is created in `accounts` collection
5. Organization is created in `organizations` collection
6. User profile is created in `users` collection
7. Session token is generated
8. User is redirected to dashboard

**Validation Rules**:
- Email must be valid format
- Password must be at least 6 characters
- Name cannot be empty
- Organization name cannot be empty
- Email must be unique

### Login Process

**Location**: `/login`

**Features**:
- Email and password authentication
- Session token generation
- Remember me functionality (via browser storage)
- Error handling for invalid credentials

**Workflow**:
1. User enters email and password
2. System verifies account exists
3. Password is compared with hashed password
4. Session token is created
5. Token is stored in cookie
6. User is redirected to home page

**Security**:
- Passwords are never stored in plain text
- Bcrypt hashing with salt rounds
- Session tokens expire after period of inactivity
- Secure HTTP-only cookies (in production)

### Session Management

**Features**:
- Token-based authentication
- Automatic session refresh
- Session expiration
- Logout functionality

**Token Structure**:
```typescript
{
  _id: string,
  accountId: string,
  token: string,
  expiresAt: Date,
  createdAt: Date
}
```

**Session Storage**:
- Tokens stored in MongoDB `sessions` collection
- Client stores token in HTTP-only cookie
- Middleware validates token on protected routes

### Logout

**Location**: `/api/auth/logout`

**Features**:
- Clears session token from database
- Removes cookie from client
- Redirects to login page

### Auth Context

The application provides an `AuthContext` for accessing user data throughout the app:

```typescript
const { user, organization, loading } = useAuth();
```

**Available Data**:
- `user`: Current user profile (User object)
- `organization`: User's organization (Organization object)
- `loading`: Boolean indicating if auth data is loading

---

## Order Management

### Order Creation

**Location**: `/` (home page)

**Features**:
- Create new orders with product details
- Multi-channel support (LINE, Shopee, Lazada, Other)
- Customer information capture
- Real-time validation
- Optional product code
- Optional order date

**Form Fields**:
- **Product Code** (optional): SKU or product identifier
- **Product Name** (required): Name of the product
- **Price** (required): Unit price (must be positive)
- **Quantity** (required): Number of items (must be positive integer)
- **Channel** (required): Sales channel dropdown
- **Customer Name** (required): Recipient name
- **Customer Contact** (required): Phone or email
- **Shipping Address** (required): Full delivery address
- **Order Date** (optional): Date when order was placed

**Validation**:
- All required fields must be filled
- Price must be positive number
- Quantity must be positive integer
- Form uses Zod schema validation

**Workflow**:
1. User fills in order form
2. Form is validated in real-time
3. Submit button enabled when form is valid
4. Order is created with status "pending"
5. User is notified of success
6. Form is reset for next order

### Order Dashboard

**Location**: `/dashboard`

**Features**:
- View all orders for organization
- Real-time statistics
- Order table with filtering
- Status updates
- PDF export
- Search and filter capabilities

**Statistics Cards**:
1. **Total Orders**: Count of all orders
2. **Pending Orders**: Orders awaiting processing
3. **Sent to Logistic**: Orders in transit
4. **Total Revenue**: Sum of all order values

**Order Table Columns**:
- Product name and code
- Customer name and contact
- Channel badge (color-coded)
- Quantity and price
- Total amount
- Shipping costs
- Order status
- Order date
- Actions (edit status, export)

**Status Management**:
- Dropdown to update order status
- Real-time status updates
- Status options:
  - Pending (yellow)
  - Processing (blue)
  - Sent to Logistic (green)
  - Delivered (gray)
  - Cancelled (red)

### PDF Export

**Features**:
- Export single order to PDF
- Includes all order details
- Formatted for printing
- Customer information
- Shipping costs breakdown

**PDF Contents**:
- Order ID
- Order date
- Product details (code, name, price, quantity)
- Customer information
- Shipping address
- Channel
- Status
- Shipping costs itemized
- Total amount

**Export Process**:
1. Click "Export PDF" button
2. PDF is generated in browser
3. File downloads automatically
4. Filename: `order-{orderId}.pdf`

### Order Filtering

**Features**:
- Filter by organization
- Filter by user (creator)
- Filter by status
- Filter by channel
- Filter by date range

**Implementation**:
- Server-side filtering via tRPC
- Only shows orders for user's organization
- Multi-tenant data isolation

---

## Shipping & Logistics

### Shipping Page

**Location**: `/shipping`

**Overview**: Comprehensive shipping cost management and order fulfillment workflow.

### Shipping Rate Configuration

**Features**:
- Configurable rates for all cost types
- Real-time rate updates
- Per-order and per-item costs
- Percentage-based costs

**Rate Types**:

1. **Pick & Pack** (฿/order)
   - Fixed cost per order
   - Default: 20 THB
   - Applied once per order

2. **Bubble** (฿/item)
   - Bubble wrap cost
   - Default: 5 THB
   - Multiplied by quantity

3. **Paper Inside** (฿/item)
   - Packing paper cost
   - Default: 3 THB
   - Multiplied by quantity

4. **Cancel Order** (฿/order)
   - Cancellation fee
   - Default: 10 THB
   - Only applied if order is cancelled

5. **COD** (% of order total)
   - Cash on delivery fee
   - Default: 3%
   - Calculated as percentage of (price × quantity)

6. **Box** (฿/item)
   - Box or container cost
   - Default: 0 THB (configurable)
   - Multiplied by quantity

7. **Delivery Fee** (฿/item)
   - Shipping provider fee
   - Default: 0 THB (configurable)
   - Multiplied by quantity

**Rate Adjustment**:
- Rates can be changed on-the-fly
- Changes apply to new calculations only
- Existing orders retain their calculated costs
- Collapsible settings panel for clean UI

### Shipping Cost Calculation

**Features**:
- Real-time cost calculation
- Detailed cost breakdown
- Preview before confirmation
- Credit balance validation

**Calculation Formula**:
```
Total Shipping Cost =
  Pick & Pack +
  (Bubble × Quantity) +
  (Paper Inside × Quantity) +
  (Cancel Order if cancelled) +
  (Order Total × COD %) +
  (Box × Quantity) +
  (Delivery Fee × Quantity)
```

**Cost Breakdown View**:
- Each cost component displayed separately
- Shows calculation formula
- Displays individual amounts
- Highlights total in green

### Pending Orders Section

**Features**:
- Lists orders with status "pending" or "processing"
- Display shipping cost calculation
- Expandable cost breakdown
- Confirm and save shipping costs

**Table Columns**:
- Product name
- Customer info
- Channel
- Shipping address
- Quantity
- Order total
- Status
- Calculated shipping cost
- Actions

**Workflow**:
1. View pending orders
2. Click "ดูรายละเอียด" to see cost breakdown
3. Review all cost components
4. Click "บันทึกค่าส่ง" to proceed
5. Confirmation modal appears
6. System validates credit balance
7. If sufficient credits, proceed to confirmation
8. If insufficient, show error message

### Shipping Confirmation Modal

**Features**:
- Display order summary
- Show total shipping cost
- Display current credit balance
- Show balance after deduction
- Confirm or cancel action

**Confirmation Details**:
- Order information (product, customer, quantity)
- Shipping cost total
- Current organization credits
- Credits after deduction
- Actions that will be performed:
  - Deduct credits from organization
  - Save shipping costs to order
  - Change status to "sent_to_logistic"

**Validation**:
- Checks if organization has sufficient credits
- Prevents processing if insufficient balance
- Shows clear error message

### Shipped Orders Section

**Features**:
- Lists orders with status "sent_to_logistic"
- Track orders in transit
- Mark as delivered

**Table Columns**:
- Product name
- Customer info
- Channel
- Shipping address
- Quantity
- Mark as delivered button

**Mark as Delivered**:
1. Click "ส่งสำเร็จ" button
2. Status updates to "delivered"
3. Order moves to completed
4. Customer notified (if notifications enabled)

### Credit Integration

**Features**:
- Real-time credit balance display
- Automatic credit deduction
- Transaction logging
- Insufficient balance handling

**Credit Deduction Process**:
1. User confirms shipping cost
2. System validates balance
3. Credits deducted from organization
4. Transaction recorded with:
   - Type: "deduct"
   - Amount: shipping cost
   - Balance before
   - Balance after
   - Description: "Shipping cost for order {orderId}"
   - Order ID reference

---

## Credit System

### Credit Management Page

**Location**: `/admin/credits`

**Access**: Owner and Admin roles only

**Features**:
- View all organizations and users
- Display current credit balances
- Add credits to organizations
- Adjust credit balances
- View transaction history

### Organizations List

**Display Information**:
- Organization name
- Current credit balance
- Owner information
- Number of users
- Action buttons

**Actions**:
- Add credits
- Adjust credits

### Add Credits

**Features**:
- Add positive amount to existing balance
- Require description
- Record performer information

**Dialog Fields**:
- Amount (THB): Positive number
- Description: Reason for adding credits

**Process**:
1. Click "เพิ่ม Credits"
2. Enter amount and description
3. Click confirm
4. Credits added to organization balance
5. Transaction recorded with type "add"

**Transaction Record**:
```typescript
{
  organizationId: string,
  organizationName: string,
  type: "add",
  amount: number,
  balanceBefore: number,
  balanceAfter: number,
  description: string,
  performedBy: "admin",
  createdAt: Date
}
```

### Adjust Credits

**Features**:
- Set balance to specific amount
- Can increase or decrease
- Require description
- Record performer information

**Dialog Fields**:
- New Amount (THB): Target balance
- Description: Reason for adjustment

**Process**:
1. Click "ปรับ Credits"
2. Enter new amount and description
3. Click confirm
4. Balance updated to exact amount
5. Transaction recorded with type "adjust"

**Transaction Record**:
```typescript
{
  organizationId: string,
  organizationName: string,
  type: "adjust",
  amount: number, // difference (positive or negative)
  balanceBefore: number,
  balanceAfter: number,
  description: string,
  performedBy: "admin",
  createdAt: Date
}
```

### Transaction History

**Features**:
- Display last 100 transactions
- Show all organizations
- Sortable by date
- Color-coded by type

**Table Columns**:
- Date and time (Thai format)
- User (name and email)
- Transaction type badge
- Amount (with +/- indicator)
- Balance before
- Balance after
- Description

**Transaction Types**:
- **Add** (green badge): Credits added
- **Deduct** (red badge): Credits removed
- **Adjust** (gray badge): Balance adjusted
- **Refund** (blue badge): Credits refunded

**Color Coding**:
- Green for positive amounts (add)
- Red for negative amounts (deduct)
- Based on transaction type

### Credit Balance Display

**Navigation Bar**:
- Shows current organization credit balance
- Format: "Credits: ฿X,XXX.XX"
- Color: Green if positive, Red if zero/negative
- Real-time updates after transactions

---

## Analytics & Reporting

### Dashboard Statistics

**Real-time Metrics**:
1. **Total Orders**: Count of all orders
2. **Pending Orders**: Orders with status "pending"
3. **Sent to Logistic**: Orders with status "sent_to_logistic"
4. **Total Revenue**: Sum of (price × quantity) for all orders

**Update Frequency**:
- Updates on page load
- Updates after order creation
- Updates after status change
- Uses React Query for caching and updates

### Channel Analytics

**Features**:
- Breakdown by sales channel
- Visual color coding
- Order count per channel

**Channels**:
- LINE (green badge)
- Shopee (orange badge)
- Lazada (blue badge)
- Other (gray badge)

### Order Status Overview

**Visual Indicators**:
- Pending (yellow)
- Processing (blue)
- Sent to Logistic (green)
- Delivered (gray)
- Cancelled (red)

**Count Display**:
- Real-time count per status
- Percentage of total (optional)

### PDF Reports

**Order Report**:
- Individual order details
- Professional formatting
- Ready for printing

**Future Enhancements**:
- Bulk export to Excel
- Date range reports
- Revenue reports
- Channel performance reports

---

## UI Components

### Badge Component

**Usage**: Display status, channel, and other categorical data

**Variants**:
- `default`: Green (LINE, positive states)
- `shopee`: Orange
- `lazada`: Blue
- `other`: Gray
- `destructive`: Red (cancelled, errors)
- `secondary`: Light gray
- `pending`: Yellow
- `processing`: Blue
- `sent_to_logistic`: Green
- `delivered`: Gray
- `cancelled`: Red

**Example**:
```tsx
<Badge variant="line">LINE</Badge>
<Badge variant="pending">Pending</Badge>
```

### Navigation Bar

**Features**:
- Logo and app name
- User information display
- Credit balance display
- Navigation links
- Logout button

**Links**:
- Home (Order Form)
- Dashboard
- Shipping
- Admin Credits (if owner/admin)

**User Display**:
- User name
- Organization name
- Credit balance

### Conditional Layout

**Features**:
- Shows navigation for authenticated users
- Hides navigation for auth pages (login, signup)
- Automatic detection based on route

**Auth Pages** (no navigation):
- `/login`
- `/signup`

**App Pages** (with navigation):
- `/` (home)
- `/dashboard`
- `/shipping`
- `/admin/credits`

### Card Component

**Usage**: Container for content sections

**Features**:
- Header with title
- Content area
- Footer (optional)
- Rounded corners
- Shadow and border

**Variants**:
- Default (white background)
- Colored headers for emphasis

### Table Component

**Features**:
- Responsive design
- Sortable columns (optional)
- Pagination (optional)
- Row actions
- Cell formatting

**Usage**: Orders list, transactions, users list

### Dialog Component

**Usage**: Modal dialogs for actions

**Features**:
- Overlay backdrop
- Close on click outside
- Close button
- Header with title and description
- Content area
- Action buttons

**Used For**:
- Add credits
- Adjust credits
- Confirm shipping
- Delete confirmations

### Form Components

**Input**:
- Text input
- Number input
- Email input
- Password input
- Validation states
- Error messages

**Select**:
- Dropdown selection
- Single select
- Options list
- Custom styling

**Button**:
- Primary action
- Secondary action
- Destructive action
- Loading state
- Disabled state

---

## Workflow Summary

### Complete Order Workflow

1. **Create Order** (Member)
   - Fill order form
   - Submit order
   - Status: "pending"

2. **Review Order** (Dashboard)
   - View order in dashboard
   - Verify details
   - Update status to "processing" if needed

3. **Calculate Shipping** (Shipping Page)
   - View pending orders
   - Configure rates
   - Calculate costs
   - Review breakdown

4. **Confirm Shipping** (Shipping Page)
   - Click save shipping cost
   - Review confirmation modal
   - System checks credits
   - Confirm action
   - Credits deducted
   - Status: "sent_to_logistic"

5. **Track Delivery** (Shipping Page)
   - View shipped orders
   - Wait for delivery
   - Mark as delivered
   - Status: "delivered"

### Credit Management Workflow

1. **Check Balance** (Navigation)
   - View credit balance in navbar

2. **Add Credits** (Admin)
   - Go to admin credits page
   - Select organization
   - Add credits with description
   - Transaction recorded

3. **Use Credits** (Automatic)
   - Confirm shipping cost
   - Credits deducted automatically
   - Transaction recorded

4. **Monitor Transactions** (Admin)
   - View transaction history
   - Audit credit usage
   - Verify balances

---

## Best Practices

### For Users
- Keep credit balance sufficient for operations
- Review shipping costs before confirming
- Update order statuses promptly
- Use descriptive order notes
- Export PDFs for record keeping

### For Admins
- Monitor credit transactions regularly
- Add credits before balance runs out
- Use clear descriptions for transactions
- Review user activity
- Manage user roles appropriately

### For Owners
- Set up organization properly during signup
- Assign appropriate roles to users
- Monitor overall system usage
- Keep financial records
- Review and adjust shipping rates as needed

---

## Keyboard Shortcuts

### Global
- `Ctrl/Cmd + K`: Quick search (future feature)
- `Escape`: Close dialogs and modals

### Forms
- `Enter`: Submit form
- `Tab`: Navigate between fields

---

## Mobile Responsiveness

All features are fully responsive and work on:
- Desktop (1024px+)
- Tablet (768px - 1023px)
- Mobile (< 768px)

**Mobile Optimizations**:
- Touch-friendly buttons
- Responsive tables (scroll horizontally)
- Collapsible sections
- Bottom navigation (future)
- Swipe gestures (future)

---

## Accessibility

**Features**:
- Keyboard navigation
- ARIA labels
- Focus indicators
- Screen reader support
- High contrast mode compatible
- Semantic HTML

---

## Future Features

Planned enhancements:
- Bulk order import (CSV/Excel)
- Email notifications
- SMS notifications
- Inventory management
- Supplier management
- Multi-currency support
- Invoice generation
- Automated reporting
- Mobile app
- API for integrations
