/**
 * Prisma Client Singleton
 *
 * Provides a single PrismaClient instance across the application.
 * In development, attaches to globalThis to survive HMR reloads.
 *
 * @returns PrismaClient — cached singleton instance
 */

import { PrismaClient } from '@prisma/client';

const global_for_prisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Cached Prisma client — reused across hot reloads in dev, single instance in prod.
 */
export const prisma =
  global_for_prisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global_for_prisma.prisma = prisma;
}

export { PrismaClient };
export default prisma;
