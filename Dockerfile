# Multi-stage Dockerfile for Next.js 15 Application
# This creates an optimized production build with minimal image size

# Stage 1: Dependencies
# Install all dependencies needed for building
FROM node:18-alpine AS deps

# Add libc6-compat for compatibility with certain npm packages on Alpine Linux
RUN apk add --no-cache libc6-compat

# Set working directory for all subsequent commands
WORKDIR /app

# Copy package files first (for Docker layer caching)
# If package.json hasn't changed, Docker reuses this layer
COPY package.json package-lock.json ./

# Install dependencies
# --frozen-lockfile ensures exact versions from package-lock.json
# Uses npm ci for faster, more reliable installs in CI/CD
RUN npm ci

# Stage 2: Builder
# Build the Next.js application
FROM node:18-alpine AS builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy all source code
COPY . .

# Set environment to production for optimized build
ENV NODE_ENV=production

# Disable Next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# Accept build arguments from Railway (these are injected during build)
# These are needed for Next.js to build properly
ARG MONGODB_URI
ARG RAW_MATERIALS_REAL_STOCK_MONGODB_URI
ARG ADMIN_EMAIL
ARG ADMIN_PASSWORD
ARG GEMINI_API_KEY
ARG OPENAI_API_KEY
ARG PINECONE_API_KEY
ARG NEXT_PUBLIC_GEMINI_API_KEY
ARG NEXT_PUBLIC_OPENAI_API_KEY

# Make build args available as environment variables during build
ENV MONGODB_URI=$MONGODB_URI
ENV RAW_MATERIALS_REAL_STOCK_MONGODB_URI=$RAW_MATERIALS_REAL_STOCK_MONGODB_URI
ENV ADMIN_EMAIL=$ADMIN_EMAIL
ENV ADMIN_PASSWORD=$ADMIN_PASSWORD
ENV GEMINI_API_KEY=$GEMINI_API_KEY
ENV OPENAI_API_KEY=$OPENAI_API_KEY
ENV PINECONE_API_KEY=$PINECONE_API_KEY
ENV NEXT_PUBLIC_GEMINI_API_KEY=$NEXT_PUBLIC_GEMINI_API_KEY
ENV NEXT_PUBLIC_OPENAI_API_KEY=$NEXT_PUBLIC_OPENAI_API_KEY

# Build the Next.js app
# This generates optimized production bundles in .next folder
RUN npm run build

# Stage 3: Runner
# Final stage with minimal size for running the app
FROM node:18-alpine AS runner

WORKDIR /app

# Set environment to production
ENV NODE_ENV=production

# Disable telemetry in production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user for security
# Running as root in containers is a security risk
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy Next.js build output
# Set correct permissions for nextjs user
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy public assets (images, fonts, etc.) if they exist
# Public folder is optional - Next.js works without it
# Create empty public directory as fallback
RUN mkdir -p ./public
# Note: If you have a public folder with assets, uncomment the line below and comment out mkdir
# COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Switch to non-root user
USER nextjs

# Expose port 3000
# Railway will map this to a public URL
EXPOSE 3000

# Set port environment variable
ENV PORT=3000

# Set hostname to listen on all network interfaces
# Required for Railway to properly route traffic
ENV HOSTNAME="0.0.0.0"

# Start the Next.js application
# Uses the standalone output from build for faster cold starts
CMD ["node", "server.js"]
