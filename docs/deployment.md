# Deployment Guide

This guide provides comprehensive instructions for deploying the Supplement Management System to production.

## Table of Contents

- [Pre-Deployment Checklist](#pre-deployment-checklist)
- [Build Process](#build-process)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [Hosting Options](#hosting-options)
  - [Vercel](#vercel-recommended)
  - [Railway](#railway)
  - [DigitalOcean](#digitalocean)
  - [AWS](#aws)
- [MongoDB Atlas Setup](#mongodb-atlas-setup)
- [Security Considerations](#security-considerations)
- [Performance Optimization](#performance-optimization)
- [Monitoring & Maintenance](#monitoring--maintenance)
- [Troubleshooting](#troubleshooting)

---

## Pre-Deployment Checklist

Before deploying to production, ensure:

### Code Quality
- [ ] All TypeScript errors resolved
- [ ] ESLint warnings addressed
- [ ] Code reviewed and tested
- [ ] No console.log statements in production code
- [ ] Error handling implemented

### Security
- [ ] Environment variables configured
- [ ] No sensitive data in code
- [ ] CORS properly configured
- [ ] Rate limiting considered
- [ ] Input validation on all endpoints

### Database
- [ ] MongoDB connection string ready
- [ ] Database indexes created
- [ ] Backup strategy planned
- [ ] Migration scripts tested

### Testing
- [ ] All features tested manually
- [ ] Edge cases handled
- [ ] Error messages user-friendly
- [ ] Mobile responsiveness verified

### Documentation
- [ ] README updated
- [ ] API documentation current
- [ ] Environment variables documented
- [ ] Deployment steps documented

---

## Build Process

### 1. Test Production Build Locally

```bash
# Build the application
npm run build

# Test the production build
npm start
```

### 2. Verify Build Output

Check `.next` folder for:
- Optimized JavaScript bundles
- Static assets
- Server-side rendering files

### 3. Build Optimization

The Next.js build process automatically:
- Minifies JavaScript and CSS
- Optimizes images
- Generates static pages where possible
- Creates optimized bundles
- Tree-shakes unused code

**Expected Output**:
```
Route (app)                              Size     First Load JS
┌ ○ /                                    5.2 kB         95.3 kB
├ ○ /api/auth/login                      0 B                0 B
├ ○ /api/auth/logout                     0 B                0 B
├ ○ /api/auth/verify                     0 B                0 B
├ λ /api/trpc/[trpc]                     0 B                0 B
├ ○ /dashboard                           8.1 kB         98.2 kB
├ ○ /login                               3.5 kB         93.6 kB
├ ○ /shipping                            12.3 kB        102.4 kB
└ ○ /signup                              4.2 kB         94.3 kB

○ (Static)  prerendered as static content
λ (Dynamic) server-rendered on demand
```

---

## Environment Variables

### Production Environment Variables

Create a `.env.production` file or configure in your hosting platform:

```env
# MongoDB Connection
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<database>?retryWrites=true&w=majority

# Node Environment
NODE_ENV=production

# Application URL (for redirects, etc.)
NEXT_PUBLIC_APP_URL=https://yourdomain.com

# Session Configuration (optional)
SESSION_SECRET=your-secure-random-string-here
SESSION_EXPIRY_DAYS=30

# CORS Origin (optional)
CORS_ORIGIN=https://yourdomain.com
```

### Security Best Practices

1. **Never commit** `.env.production` to version control
2. **Use strong passwords** for MongoDB
3. **Rotate secrets** regularly
4. **Use environment-specific** values
5. **Restrict database access** by IP

### Environment Variable Validation

Add validation in `lib/config.ts`:

```typescript
export const config = {
  mongodb: {
    uri: process.env.MONGODB_URI || '',
  },
  app: {
    url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    env: process.env.NODE_ENV || 'development',
  },
};

// Validate required variables
if (!config.mongodb.uri) {
  throw new Error('MONGODB_URI is required');
}
```

---

## Database Setup

### MongoDB Atlas (Recommended)

#### 1. Create Cluster

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create account or log in
3. Create new cluster (Free tier available)
4. Choose region closest to your hosting
5. Wait for cluster provisioning (5-10 minutes)

#### 2. Configure Security

**Network Access**:
1. Go to "Network Access"
2. Click "Add IP Address"
3. Options:
   - Add current IP
   - Add 0.0.0.0/0 (allow from anywhere - less secure)
   - Add specific hosting provider IPs

**Database User**:
1. Go to "Database Access"
2. Click "Add New Database User"
3. Choose authentication method (password recommended)
4. Set username and password
5. Set role to "Read and write to any database"

#### 3. Get Connection String

1. Click "Connect" on cluster
2. Choose "Connect your application"
3. Copy connection string
4. Replace `<password>` with your password
5. Replace `<database>` with `supplement_management`

**Example**:
```
mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/supplement_management?retryWrites=true&w=majority
```

#### 4. Create Indexes

Connect to your database and run:

```javascript
use supplement_management

// Accounts
db.accounts.createIndex({ email: 1 }, { unique: true })
db.accounts.createIndex({ isActive: 1 })

// Users
db.users.createIndex({ accountId: 1 }, { unique: true })
db.users.createIndex({ organizationId: 1 })
db.users.createIndex({ email: 1 })

// Organizations
db.organizations.createIndex({ ownerId: 1 })
db.organizations.createIndex({ isActive: 1 })

// Orders
db.orders.createIndex({ organizationId: 1 })
db.orders.createIndex({ createdBy: 1 })
db.orders.createIndex({ status: 1 })
db.orders.createIndex({ channel: 1 })
db.orders.createIndex({ createdAt: -1 })
db.orders.createIndex({ organizationId: 1, status: 1 })

// Credit Transactions
db.credit_transactions.createIndex({ organizationId: 1 })
db.credit_transactions.createIndex({ type: 1 })
db.credit_transactions.createIndex({ createdAt: -1 })
db.credit_transactions.createIndex({ orderId: 1 })

// Sessions (with TTL)
db.sessions.createIndex({ token: 1 }, { unique: true })
db.sessions.createIndex({ accountId: 1 })
db.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
```

#### 5. Set Up Backup

MongoDB Atlas provides automatic backups:
1. Go to cluster settings
2. Navigate to "Backup" tab
3. Enable "Continuous Cloud Backup" (M10+ clusters)
4. Or use "Serverless Backups" (free tier)

---

## Hosting Options

## Vercel (Recommended)

### Why Vercel?

- Built for Next.js
- Zero configuration
- Automatic deployments
- Global CDN
- Free tier available
- Excellent performance

### Deployment Steps

#### 1. Install Vercel CLI

```bash
npm install -g vercel
```

#### 2. Login to Vercel

```bash
vercel login
```

#### 3. Deploy

```bash
# From project root
vercel

# For production
vercel --prod
```

#### 4. Configure Environment Variables

**Via Dashboard**:
1. Go to project settings
2. Navigate to "Environment Variables"
3. Add `MONGODB_URI`
4. Add other variables as needed

**Via CLI**:
```bash
vercel env add MONGODB_URI production
```

#### 5. Custom Domain (Optional)

1. Go to project settings
2. Navigate to "Domains"
3. Add your domain
4. Update DNS records as instructed
5. Wait for SSL certificate (automatic)

### Vercel Configuration

Create `vercel.json`:

```json
{
  "buildCommand": "npm run build",
  "devCommand": "npm run dev",
  "framework": "nextjs",
  "regions": ["sin1"],
  "env": {
    "MONGODB_URI": "@mongodb_uri"
  }
}
```

---

## Railway

### Why Railway?

- Simple deployment
- Database hosting included
- Auto-scaling
- Affordable pricing

### Deployment Steps

1. Go to [Railway.app](https://railway.app)
2. Connect GitHub repository
3. Configure environment variables
4. Deploy automatically on push

### Railway Configuration

Create `railway.json`:

```json
{
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "npm start",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

---

## DigitalOcean

### Deployment via App Platform

1. Create DigitalOcean account
2. Go to App Platform
3. Connect GitHub repository
4. Configure build settings:
   - Build Command: `npm run build`
   - Run Command: `npm start`
5. Add environment variables
6. Deploy

### DigitalOcean Droplet (Manual)

```bash
# Connect to droplet
ssh root@your_droplet_ip

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Clone repository
git clone your-repo-url
cd supplement_management

# Install dependencies
npm install

# Build
npm run build

# Install PM2
npm install -g pm2

# Start with PM2
pm2 start npm --name "supplement-app" -- start
pm2 save
pm2 startup
```

---

## AWS

### AWS Amplify

1. Go to AWS Amplify Console
2. Connect repository
3. Configure build settings
4. Add environment variables
5. Deploy

### AWS EC2

Similar to DigitalOcean Droplet setup.

### AWS ECS (Docker)

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
```

---

## Security Considerations

### 1. HTTPS/SSL

**Vercel/Railway**: Automatic HTTPS
**Custom Server**: Use Let's Encrypt

```bash
# Using certbot
sudo certbot --nginx -d yourdomain.com
```

### 2. Environment Variables

- Never expose in client-side code
- Use `NEXT_PUBLIC_` prefix only for public variables
- Rotate secrets regularly

### 3. Database Security

- Use strong passwords
- Whitelist IPs
- Enable MongoDB authentication
- Use connection string with SSL

### 4. Rate Limiting

Install and configure:

```bash
npm install express-rate-limit
```

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP
  message: 'Too many requests'
});
```

### 5. CORS Configuration

Configure in Next.js API routes:

```typescript
// middleware.ts
export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  response.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  return response;
}
```

### 6. Security Headers

Add to `next.config.ts`:

```typescript
const securityHeaders = [
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on'
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload'
  },
  {
    key: 'X-Frame-Options',
    value: 'SAMEORIGIN'
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff'
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block'
  },
  {
    key: 'Referrer-Policy',
    value: 'origin-when-cross-origin'
  }
];

module.exports = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};
```

---

## Performance Optimization

### 1. Caching Strategy

**React Query** (already configured):
```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      cacheTime: 1000 * 60 * 30, // 30 minutes
    },
  },
});
```

### 2. Database Connection Pooling

MongoDB driver handles this automatically, but you can configure:

```typescript
const client = new MongoClient(uri, {
  maxPoolSize: 10,
  minPoolSize: 2,
  maxIdleTimeMS: 30000,
});
```

### 3. Image Optimization

Next.js Image component (if you add images):

```typescript
import Image from 'next/image';

<Image
  src="/product.jpg"
  alt="Product"
  width={500}
  height={300}
  quality={75}
  loading="lazy"
/>
```

### 4. Code Splitting

Lazy load components:

```typescript
import dynamic from 'next/dynamic';

const HeavyComponent = dynamic(() => import('./HeavyComponent'), {
  loading: () => <p>Loading...</p>,
  ssr: false
});
```

### 5. Compression

Enable gzip in production:

```bash
# Vercel handles this automatically

# For custom servers
npm install compression
```

---

## Monitoring & Maintenance

### 1. Logging

Implement structured logging:

```bash
npm install winston
```

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});
```

### 2. Error Tracking

Consider implementing:
- **Sentry**: Error tracking and monitoring
- **LogRocket**: Session replay
- **Datadog**: Application monitoring

```bash
npm install @sentry/nextjs
```

### 3. Uptime Monitoring

Use services like:
- **UptimeRobot**: Free uptime monitoring
- **Pingdom**: Advanced monitoring
- **StatusCake**: Website monitoring

### 4. Database Monitoring

MongoDB Atlas provides:
- Performance metrics
- Query analytics
- Alert configuration
- Slow query identification

### 5. Analytics

Consider adding:
- **Google Analytics**: User analytics
- **Mixpanel**: Product analytics
- **Plausible**: Privacy-friendly analytics

---

## Troubleshooting

### Build Failures

**Error**: TypeScript errors
```bash
# Check for errors
npx tsc --noEmit

# Fix type issues
```

**Error**: Missing dependencies
```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
```

### Database Connection Issues

**Error**: Connection timeout
- Check MongoDB URI
- Verify IP whitelist
- Check network access rules

**Error**: Authentication failed
- Verify username and password
- Check user permissions
- Ensure database name is correct

### Performance Issues

**Slow queries**:
1. Check MongoDB Atlas performance tab
2. Identify slow queries
3. Add missing indexes
4. Optimize query patterns

**High memory usage**:
1. Check for memory leaks
2. Review connection pooling
3. Optimize component rendering
4. Use React Query caching

### Session Issues

**Sessions not persisting**:
- Check cookie configuration
- Verify domain settings
- Check HTTPS/secure cookie settings

---

## Rollback Strategy

### Quick Rollback

**Vercel**:
1. Go to project dashboard
2. Navigate to "Deployments"
3. Find previous working deployment
4. Click "Promote to Production"

**Railway**:
1. Go to project deployments
2. Select previous version
3. Redeploy

### Database Rollback

**MongoDB Atlas**:
1. Go to cluster
2. Navigate to "Backup"
3. Select restore point
4. Restore to cluster or download

---

## Continuous Deployment

### GitHub Actions

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Production

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Build
        run: npm run build

      - name: Deploy to Vercel
        run: vercel --prod --token ${{ secrets.VERCEL_TOKEN }}
```

---

## Post-Deployment

### 1. Verify Deployment

- [ ] Visit production URL
- [ ] Test user registration
- [ ] Test user login
- [ ] Create test order
- [ ] Verify dashboard
- [ ] Test shipping workflow
- [ ] Test credit management

### 2. Monitor First 24 Hours

- Check error logs
- Monitor response times
- Watch database performance
- Review user feedback

### 3. Set Up Alerts

Configure alerts for:
- Application downtime
- High error rates
- Database connection issues
- High response times

---

## Scaling Considerations

### Horizontal Scaling

- Use serverless platforms (Vercel, Railway)
- Database connection pooling
- CDN for static assets

### Database Scaling

- MongoDB Atlas auto-scaling
- Read replicas for read-heavy operations
- Sharding for large datasets

### Caching

- Implement Redis for session storage
- CDN caching for static content
- Application-level caching with React Query

---

## Related Documentation

- [Getting Started](./getting-started.md) - Development setup
- [Database Schema](./database-schema.md) - Database structure
- [API Documentation](./api-documentation.md) - API reference
- [Features](./features.md) - Application features
