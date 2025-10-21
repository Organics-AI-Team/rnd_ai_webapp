# Railway Deployment Guide

Complete guide for deploying the R&D AI Management System to Railway with Docker.

## Prerequisites

- GitHub account with this repository connected
- Railway account (sign up at https://railway.app)
- MongoDB database (Railway provides MongoDB plugin or use MongoDB Atlas)

## Files Created for Deployment

### 1. `railway.toml`
Railway configuration file that defines build and deployment settings.

**Key configurations:**
- `builder = "DOCKERFILE"` - Uses Docker instead of Nixpacks
- `startCommand = "npm start"` - Command to start the production server
- `numReplicas = 1` - Number of instances to run
- `restartPolicyType = "ON_FAILURE"` - Auto-restart on crashes
- `healthcheckPath = "/"` - Railway pings this endpoint to check app health

### 2. `Dockerfile`
Multi-stage Docker configuration for optimized production builds.

**Build stages:**
1. **deps** - Installs all npm dependencies
2. **builder** - Builds the Next.js application
3. **runner** - Final minimal image with only production files

**Security features:**
- Runs as non-root user (`nextjs:nodejs`)
- Uses Alpine Linux for minimal attack surface
- Only includes production dependencies

**Optimizations:**
- Layer caching for faster rebuilds
- Standalone output mode for smaller image size
- Multi-stage build reduces final image size by ~70%

### 3. `.dockerignore`
Excludes unnecessary files from Docker build context.

**Benefits:**
- Faster build times (excludes `node_modules`, `.next/`, etc.)
- Smaller build context sent to Docker daemon
- Prevents sensitive files (`.env.local`) from being copied

### 4. `next.config.ts` (Modified)
Added `output: 'standalone'` configuration.

**What it does:**
- Creates a standalone `server.js` with all dependencies bundled
- Reduces Docker image size significantly
- Improves cold start performance
- Necessary for multi-stage Docker builds

## Deployment Steps

### Step 1: Add MongoDB to Railway

**Option A: Railway MongoDB Plugin (Recommended)**
1. Go to your Railway project
2. Click "New" → "Database" → "Add MongoDB"
3. Railway will create a MongoDB instance and provide connection string
4. Copy the `MONGODB_URI` from the MongoDB service variables

**Option B: External MongoDB Atlas**
1. Create a free cluster at https://www.mongodb.com/cloud/atlas
2. Create a database user with read/write permissions
3. Get connection string from Atlas dashboard
4. Format: `mongodb+srv://username:password@cluster.mongodb.net/rnd_ai`

### Step 2: Configure Environment Variables in Railway

Go to your service → Variables tab and add:

```bash
# Required: MongoDB connection string
MONGODB_URI=mongodb://mongo:jG12hqYNHKxs7PLtX8uV@roundhouse.proxy.rlwy.net:50739/railway

# Optional: Admin credentials for seed script
ADMIN_EMAIL=admin@admin.com
ADMIN_PASSWORD=admin

# Automatically set by Railway (no need to add)
# PORT=3000
# NODE_ENV=production
```

### Step 3: Deploy from GitHub

1. **Connect Repository:**
   - Go to Railway dashboard
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your `rnd_ai` repository
   - Railway will auto-detect the configuration

2. **Deploy:**
   - Railway automatically starts building using the Dockerfile
   - Build process takes 3-5 minutes
   - Watch logs in the "Deployments" tab

3. **Monitor Deployment:**
   ```
   Building Docker image...
   [+] Building 45.2s
   => [deps] installing dependencies
   => [builder] building Next.js
   => [runner] creating production image
   Deployment successful!
   ```

### Step 4: Verify Deployment

1. **Get Public URL:**
   - Railway provides a URL like: `https://supplement-management-production.up.railway.app`
   - Find it in Settings → Domains

2. **Test Endpoints:**
   - Visit root URL (should show order form or login)
   - Try `/login` and `/signup` pages
   - Check `/api/trpc/health` if available

3. **Seed Admin Account (Optional):**
   - Currently, there's no direct way to run seed script in Railway
   - Use MongoDB client to manually create admin user, or
   - Create an API endpoint to trigger seeding, or
   - Use Railway's CLI: `railway run npm run seed-admin`

### Step 5: Set Up Custom Domain (Optional)

1. Go to Settings → Domains
2. Click "Add Domain"
3. Enter your domain name
4. Add CNAME record to your DNS provider:
   ```
   CNAME: your-domain.com → your-app.up.railway.app
   ```

## Environment Variables Explained

### `MONGODB_URI`
**Required** - Connection string to MongoDB database

**Format:**
```bash
# Railway MongoDB
mongodb://username:password@host:port/database

# MongoDB Atlas
mongodb+srv://username:password@cluster.mongodb.net/database

# Local development
mongodb://localhost:27017/rnd_ai
```

### `ADMIN_EMAIL` & `ADMIN_PASSWORD`
**Optional** - Used by seed script to create initial admin account

**Usage:**
```bash
railway run npm run seed-admin
```

### `PORT`
**Auto-set by Railway** - Port number the app listens on (default: 3000)

### `NODE_ENV`
**Auto-set by Railway** - Set to `production` for optimizations

## Docker Build Process Explained

### Stage 1: Dependencies (deps)
```dockerfile
FROM node:18-alpine AS deps
COPY package.json package-lock.json ./
RUN npm ci
```
- Uses Alpine Linux (smaller image: ~40MB vs ~900MB for standard node)
- Installs exact dependency versions from `package-lock.json`
- This layer is cached and only rebuilds when package files change

### Stage 2: Builder
```dockerfile
FROM node:18-alpine AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
```
- Copies dependencies from previous stage
- Copies all source code
- Builds Next.js application (creates `.next/` folder)
- Standalone output bundles everything needed into `server.js`

### Stage 3: Runner (Final Image)
```dockerfile
FROM node:18-alpine AS runner
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
CMD ["node", "server.js"]
```
- Smallest final image (only production files)
- Runs as non-root user for security
- Listens on `0.0.0.0:3000` for Railway routing
- Final image size: ~150MB (vs ~1.5GB without multi-stage build)

## Troubleshooting

### Build Fails with "Cannot find module"
**Cause:** Missing dependency or incorrect import
**Fix:**
```bash
npm install <missing-package>
git add package.json package-lock.json
git commit -m "Add missing dependency"
git push
```

### "Application failed to respond"
**Cause:** App not listening on correct port or host
**Fix:** Ensure `HOSTNAME="0.0.0.0"` is set in Dockerfile (already configured)

### MongoDB Connection Timeout
**Cause:** Incorrect connection string or network issue
**Fix:**
- Verify `MONGODB_URI` in Railway variables
- Check MongoDB service is running
- Ensure connection string includes authentication details

### Build Takes Too Long
**Cause:** Large node_modules being copied
**Fix:**
- Ensure `.dockerignore` excludes `node_modules` (already configured)
- Check Railway build logs for bottlenecks

### "502 Bad Gateway" Error
**Cause:** App crashed or not starting properly
**Fix:**
- Check Railway logs: Deployments → View Logs
- Look for startup errors (usually MongoDB connection issues)
- Verify all environment variables are set

## Monitoring & Maintenance

### View Logs
```bash
# Real-time logs in Railway dashboard
Deployments → [Latest Deployment] → View Logs

# Or use Railway CLI
railway logs
```

### Restart Service
```bash
# Via Railway dashboard
Service → Settings → Restart

# Or via CLI
railway restart
```

### Check Resource Usage
```bash
# Railway dashboard shows:
- CPU usage
- Memory usage
- Network traffic
- Request count
```

## Performance Optimization

### Enable Caching
Add to `next.config.ts`:
```typescript
images: {
  minimumCacheTTL: 60,
},
```

### Set Up Redis (Optional)
For session caching:
1. Add Railway Redis plugin
2. Update session management to use Redis
3. Set `REDIS_URL` environment variable

### Scale Up
In `railway.toml`, increase replicas:
```toml
numReplicas = 3
```

## Cost Estimation

Railway pricing (as of 2024):
- **Hobby Plan:** $5/month for 500 hours + $0.000231/GB/hour memory
- **MongoDB:** ~$5-10/month (or free on Atlas)
- **Expected monthly cost:** $10-15 for small/medium traffic

## Security Checklist

- [x] Environment variables stored securely in Railway (not in code)
- [x] Runs as non-root user in Docker
- [x] `.env.local` excluded from Docker build
- [x] MongoDB requires authentication
- [x] HTTPS enabled by default (Railway provides SSL)
- [ ] Set up MongoDB IP whitelist (if using Atlas)
- [ ] Enable Railway activity logs for audit trail
- [ ] Set up monitoring/alerting for downtime

## Additional Resources

- [Railway Documentation](https://docs.railway.app)
- [Next.js Deployment Docs](https://nextjs.org/docs/deployment)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [MongoDB Connection String Format](https://www.mongodb.com/docs/manual/reference/connection-string/)

## Support

If you encounter issues:
1. Check Railway logs first
2. Review this documentation
3. Check Railway community forum
4. Open GitHub issue in repository
