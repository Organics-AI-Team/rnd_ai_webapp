# Deployment Guide - R&D AI Management Monorepo

This guide covers deployment strategies for the monorepo structure with separate Web and AI services.

## Table of Contents

- [Deployment Options](#deployment-options)
- [Railway Deployment](#railway-deployment)
- [Docker Deployment](#docker-deployment)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

## Deployment Options

The monorepo can be deployed in three ways:

1. **Single Service Deployment** - Deploy web app only (recommended for Railway)
2. **Separate Services** - Deploy web and AI as independent services
3. **Local Docker** - Run both services in containers locally

## Railway Deployment

### Option 1: Deploy Web App (Recommended)

Railway configuration for deploying the web app which includes all AI functionality:

**Using Root Dockerfile:**
```bash
# Railway will use the root Dockerfile by default
railway up
```

**Using Web-Specific Dockerfile:**
```bash
# Update railway.json to use apps/web/Dockerfile
railway up --service web
```

**Railway Configuration Files:**
- `railway.json` - Default configuration (uses root Dockerfile)
- `railway.web.json` - Web-specific configuration (uses apps/web/Dockerfile)

### Option 2: Deploy as Microservices

Deploy web and AI as separate Railway services:

1. **Web Service:**
   ```bash
   railway service create web
   railway up --dockerfile apps/web/Dockerfile
   ```

2. **AI Service:**
   ```bash
   railway service create ai
   # Configure AI service deployment
   ```

### Required Environment Variables for Railway

Set these in Railway Dashboard → Variables:

```bash
# Database
MONGODB_URI=mongodb+srv://...
RAW_MATERIALS_REAL_STOCK_MONGODB_URI=mongodb+srv://...

# AI Keys
GEMINI_API_KEY=AIza...
OPENAI_API_KEY=sk-...
PINECONE_API_KEY=pcsk_... (optional)

# Admin Credentials
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your_secure_password

# Public Variables
NEXT_PUBLIC_GEMINI_API_KEY=AIza...
NEXT_PUBLIC_OPENAI_API_KEY=sk-...

# Vector DB Provider
VECTOR_DB_PROVIDER=chroma
```

## Docker Deployment

### Build and Run Web App

```bash
# Build from root
docker build -t rnd-ai-web -f Dockerfile .

# Or build from web app directory
docker build -t rnd-ai-web -f apps/web/Dockerfile .

# Run the container
docker run -p 3000:3000 \
  --env-file .env \
  rnd-ai-web
```

### Build and Run AI Service

```bash
# Build AI service
docker build -t rnd-ai-service -f apps/ai/Dockerfile .

# Run the container
docker run -p 3001:3001 \
  --env-file apps/ai/.env \
  rnd-ai-service
```

### Docker Compose (Coming Soon)

For running both services together with Docker Compose, create a `docker-compose.yml`:

```yaml
version: '3.8'

services:
  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    ports:
      - "3000:3000"
    env_file:
      - apps/web/.env
    depends_on:
      - ai

  ai:
    build:
      context: .
      dockerfile: apps/ai/Dockerfile
    ports:
      - "3001:3001"
    env_file:
      - apps/ai/.env
    volumes:
      - chromadb-data:/app/.chromadb

volumes:
  chromadb-data:
```

Run with:
```bash
docker-compose up -d
```

## Environment Variables

### Web App (.env in apps/web/)

```bash
# API Endpoints
NEXT_PUBLIC_API_URL=http://localhost:3000/api
NEXT_PUBLIC_TRPC_URL=http://localhost:3000/api/trpc

# Database
MONGODB_URI=mongodb+srv://...

# AI Service URL (if running separately)
AI_SERVICE_URL=http://localhost:3001

# Public Variables
NEXT_PUBLIC_GEMINI_API_KEY=AIza...
```

### AI Service (.env in apps/ai/)

```bash
# Database
MONGODB_URI=mongodb+srv://...
RAW_MATERIALS_REAL_STOCK_MONGODB_URI=mongodb+srv://...

# AI APIs
GEMINI_API_KEY=AIza...
OPENAI_API_KEY=sk-...
PINECONE_API_KEY=pcsk_...

# Vector Database
VECTOR_DB_PROVIDER=chroma
CHROMA_URL=http://localhost:8000

# Service Configuration
AI_SERVICE_PORT=3001
WEB_APP_URL=http://localhost:3000
```

## Deployment Checklist

### Pre-Deployment

- [ ] Run `npm run build:web` to test production build
- [ ] Verify all environment variables are set
- [ ] Test Docker build locally
- [ ] Run `npm run lint` to check for issues
- [ ] Verify database connections

### Railway Deployment

- [ ] Set all environment variables in Railway Dashboard
- [ ] Configure Dockerfile path in railway.json
- [ ] Enable healthcheck endpoint
- [ ] Set restart policy to ON_FAILURE
- [ ] Configure custom domain (optional)

### Post-Deployment

- [ ] Verify app is accessible
- [ ] Test AI chat functionality
- [ ] Check database connections
- [ ] Monitor logs for errors
- [ ] Test API endpoints

## Troubleshooting

### Build Fails with Module Not Found

**Issue:** Cannot resolve `@/ai/*` or `@/server/*` imports

**Solution:**
1. Ensure both `apps/web` and `apps/ai` are copied in Dockerfile
2. Verify tsconfig.json path aliases are correct
3. Check webpack aliases in next.config.js

### Railway Build Timeout

**Issue:** Build takes too long and times out

**Solution:**
1. Use `.dockerignore` to exclude unnecessary files
2. Leverage Docker layer caching
3. Consider using Railway's build cache

### Environment Variables Not Loading

**Issue:** App can't connect to MongoDB or AI services

**Solution:**
1. Verify variables are set in Railway Dashboard
2. Check variable names match exactly
3. Ensure ARG/ENV are properly set in Dockerfile
4. For local development, use `.env` files in respective app directories

### ChromaDB Connection Issues

**Issue:** AI service can't connect to ChromaDB

**Solution:**
1. Ensure `.chromadb` directory exists in apps/ai
2. Set `VECTOR_DB_PROVIDER=chroma` in environment
3. For production, consider external ChromaDB service
4. Check ChromaDB service logs

### CORS Errors Between Services

**Issue:** Web app can't communicate with AI service

**Solution:**
1. Configure CORS in AI service
2. Set `WEB_APP_URL` environment variable
3. Update `AI_SERVICE_URL` in web app
4. Verify network connectivity between services

## Performance Optimization

### Production Build Optimization

1. **Enable Next.js Standalone Output:**
   - Already configured in `next.config.js`
   - Reduces Docker image size by 80%

2. **Optimize Dependencies:**
   ```bash
   # Remove dev dependencies in production
   npm prune --production
   ```

3. **Use CDN for Static Assets:**
   - Configure Next.js Image Optimization
   - Use Vercel Edge Network (if using Vercel)

4. **Database Optimization:**
   - Use connection pooling
   - Add database indexes
   - Enable MongoDB Atlas auto-scaling

### Monitoring

1. **Railway Metrics:**
   - Monitor CPU and memory usage
   - Check request/response times
   - Set up alerts for errors

2. **Application Logs:**
   ```bash
   # View Railway logs
   railway logs --service web
   railway logs --service ai
   ```

3. **Database Monitoring:**
   - MongoDB Atlas monitoring
   - Track query performance
   - Monitor connection pool

## Scaling

### Horizontal Scaling

**Web App:**
- Increase Railway replicas in dashboard
- Configure load balancer
- Ensure session state is stateless

**AI Service:**
- Deploy multiple instances
- Use message queue for job processing
- Implement caching layer

### Vertical Scaling

- Upgrade Railway plan for more resources
- Optimize database queries
- Implement Redis caching

## Rollback Strategy

### Railway Rollback

```bash
# List deployments
railway deployments

# Rollback to previous deployment
railway rollback <deployment-id>
```

### Manual Rollback

```bash
# Checkout previous commit
git checkout <previous-commit-hash>

# Deploy
railway up
```

## Security Best Practices

1. **Environment Variables:**
   - Never commit `.env` files
   - Use Railway's secret management
   - Rotate API keys regularly

2. **Database Security:**
   - Use strong passwords
   - Enable IP whitelisting
   - Use SSL/TLS connections

3. **API Security:**
   - Implement rate limiting
   - Use authentication middleware
   - Validate all inputs

4. **Docker Security:**
   - Run as non-root user (already configured)
   - Keep base images updated
   - Scan for vulnerabilities

## Support

For deployment issues:
1. Check Railway logs: `railway logs`
2. Review CHANGELOG.md for recent changes
3. Consult MONOREPO_README.md for structure details
4. Open an issue on GitHub

## References

- [Railway Documentation](https://docs.railway.app)
- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [MongoDB Atlas](https://docs.atlas.mongodb.com/)
