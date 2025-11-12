import { initTRPC } from "@trpc/server";
import { cache } from "react";
import { cookies } from "next/headers";
import client_promise from "@rnd-ai/shared-database";

export const createTRPCContext = cache(async () => {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;

  let userId: string | null = null;
  let organizationId: string | null = null;
  let user: any = null;

  if (token) {
    try {
      const client = await client_promise;
      const db = client.db();
      const session = await db.collection("sessions").findOne({
        token,
        expiresAt: { $gt: new Date() },
      });

      if (session) {
        // Get user by accountId from session
        user = await db.collection("users").findOne({ accountId: session.accountId });
        if (user) {
          userId = user._id.toString();
          organizationId = user.organizationId?.toString() || null;
        }
      }
    } catch (error) {
      console.error("Error getting user from token:", error);
    }
  }

  return { userId, organizationId, user };
});

const t = initTRPC.context<typeof createTRPCContext>().create();

export const createCallerFactory = t.createCallerFactory;
export const router = t.router;
export const publicProcedure = t.procedure;

// Protected procedure that requires authentication
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.userId || !ctx.user) {
    throw new Error("Unauthorized - Please log in");
  }

  return next({
    ctx: {
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      user: ctx.user,
    },
  });
});
