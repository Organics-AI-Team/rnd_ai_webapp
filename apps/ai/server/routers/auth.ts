import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc";
import client_promise from "@rnd-ai/shared-database";
import { SignupInputSchema, LoginInputSchema } from "@/lib/types";
import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { logActivity } from "@/lib/userLog";

export const authRouter = router({
  /**
   * Public self-signup is permanently closed (G0.5). Universities and their
   * managers are provisioned only by platform administration (G1.4).
   *
   * @throws TRPCError PRECONDITION_FAILED on every call (HTTP 412; the
   *         endpoint is gone as a business operation).
   */
  signup: publicProcedure
    .input(SignupInputSchema)
    .mutation(async () => {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "University sign-up is closed. Universities are provisioned by platform administration.",
      });
    }),

  // Login
  login: publicProcedure
    .input(LoginInputSchema)
    .mutation(async ({ input }) => {
      const client = await client_promise;
      const db = client.db();

      // Find account
      const account = await db.collection("accounts").findOne({ email: input.email });
      if (!account) {
        throw new Error("Invalid email or password");
      }

      if (!account.isActive) {
        throw new Error("Account is deactivated");
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(input.password, account.passwordHash);
      if (!isValidPassword) {
        throw new Error("Invalid email or password");
      }

      // Get user profile
      const user = await db.collection("users").findOne({ accountId: account._id.toString() });
      if (!user) {
        throw new Error("User profile not found");
      }

      // Create session
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      await db.collection("sessions").insertOne({
        accountId: account._id.toString(),
        token,
        expiresAt,
        createdAt: new Date(),
      });

      // Log login activity
      await logActivity({
        db,
        userId: user._id.toString(),
        userName: user.name,
        activity: "log-in",
        organizationId: user.organizationId,
      });

      return {
        success: true,
        token,
        user: {
          _id: user._id.toString(),
          accountId: account._id.toString(),
          organizationId: user.organizationId,
          email: user.email,
          name: user.name,
          role: user.role,
          status: user.status || "active",
        },
      };
    }),

  /**
   * Logout. Identity for the activity log is derived from the session record
   * itself — never from client-supplied identity fields.
   *
   * @param token - Session token to revoke.
   * @returns Success marker after the session is deleted.
   */
  logout: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input }) => {
      const client = await client_promise;
      const db = client.db();

      // Derive the acting identity from the session, not the request body.
      const session = await db.collection("sessions").findOne({ token: input.token });
      if (session) {
        const user = await db
          .collection("users")
          .findOne({ accountId: String(session.accountId) });
        if (user) {
          await logActivity({
            db,
            userId: user._id.toString(),
            userName: user.name,
            activity: "log-out",
            organizationId: user.organizationId?.toString(),
          });
        }
        await db.collection("sessions").deleteOne({ token: input.token });
      }

      return { success: true };
    }),

  // Get current user
  me: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const client = await client_promise;
      const db = client.db();

      // Find session
      const session = await db.collection("sessions").findOne({
        token: input.token,
        expiresAt: { $gt: new Date() },
      });
      if (!session) {
        throw new Error("Invalid or expired session");
      }

      // Get user
      const user = await db.collection("users").findOne({ accountId: session.accountId });
      if (!user) {
        throw new Error("User not found");
      }

      // Get organization
      const organization = await db.collection("organizations").findOne({
        _id: new ObjectId(user.organizationId),
      });

      return {
        user: {
          _id: user._id.toString(),
          accountId: user.accountId,
          organizationId: user.organizationId,
          email: user.email,
          name: user.name,
          role: user.role,
          status: user.status || "active",
        },
        organization: organization
          ? {
              _id: organization._id.toString(),
              name: organization.name,
              credits: organization.credits,
              ownerId: organization.ownerId,
            }
          : null,
      };
    }),
});
