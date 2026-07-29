# Multi-stage Dockerfile for Next.js Web App (Monorepo)
# This creates an optimized production build with minimal image size

# Stage 1: Dependencies
# Install all dependencies needed for building
FROM node:24-alpine AS deps

# Add libc6-compat for compatibility with certain npm packages on Alpine Linux
RUN apk add --no-cache libc6-compat

# Set working directory
WORKDIR /app

# Copy root workspace package files
COPY package.json package-lock.json ./
# Copy workspace package files
COPY apps/web/package.json ./apps/web/
COPY apps/ai/package.json ./apps/ai/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-config/package.json ./packages/shared-config/
COPY packages/shared-utils/package.json ./packages/shared-utils/
COPY packages/shared-database/package.json ./packages/shared-database/
COPY packages/server-config/package.json ./packages/server-config/
COPY packages/ai-orchestration/package.json ./packages/ai-orchestration/

# Install all workspace dependencies
RUN npm ci --legacy-peer-deps

# Stage 2: Builder
# Build the Next.js application
FROM node:24-alpine AS builder

WORKDIR /app

# Copy dependencies from deps stage (npm workspaces hoists to root node_modules)
COPY --from=deps /app/node_modules ./node_modules

# Copy workspace configuration
COPY package.json package-lock.json ./
COPY packages ./packages

# Copy web app source code
COPY apps/web ./apps/web

# Copy AI service (needed for imports)
COPY apps/ai ./apps/ai

# Copy Prisma schema and config, then generate client
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

# Set environment to production for optimized build
ENV NODE_ENV=production

# Disable Next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# Public URLs and the Clerk publishable key are inlined by Next.js at build
# time. Provider credentials are injected only into the runtime container.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_APP_URL

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

# Build the Next.js app from web workspace
WORKDIR /app/apps/web
RUN npm run build

# Stage 3: Runner
# Final stage with minimal size for running the app
FROM node:24-alpine AS runner

WORKDIR /app

# Set environment to production
ENV NODE_ENV=production

# Disable telemetry in production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy Next.js build output
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

# Capability cards are runtime-read markdown (not traced by standalone output
# tracing); without them the run API fails closed with CARDS_ROOT_NOT_FOUND.
COPY --from=builder --chown=nextjs:nodejs /app/apps/ai/server/services/ai-control/cards ./apps/ai/server/services/ai-control/cards

# Copy Prisma client (engine binaries + generated types)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

# Copy public assets if they exist
RUN mkdir -p ./apps/web/public

# Switch to non-root user
USER nextjs

# Expose port 3000
EXPOSE 3000

# Set port environment variable
ENV PORT=3000

# Set hostname to listen on all network interfaces
ENV HOSTNAME="0.0.0.0"

# Start the Next.js application
CMD ["node", "apps/web/server.js"]
