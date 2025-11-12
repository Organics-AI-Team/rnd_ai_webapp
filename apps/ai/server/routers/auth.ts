import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import client_promise from "@rnd-ai/shared-database";
import { SignupInputSchema, LoginInputSchema } from "@/lib/types";
import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { logActivity } from "@/lib/userLog";

export const authRouter = router({
  // Signup - Creates account, organization, and user
  signup: publicProcedure
    .input(SignupInputSchema)
    .mutation(async ({ input }) => {
      const client = await client_promise;
      const db = client.db();

      // Check if account already exists
      const existingAccount = await db.collection("accounts").findOne({ email: input.email });
      if (existingAccount) {
        throw new Error("An account with this email already exists");
      }

      // Hash password
      const passwordHash = await bcrypt.hash(input.password, 10);

      // Create account
      const accountResult = await db.collection("accounts").insertOne({
        email: input.email,
        passwordHash,
        isVerified: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const accountId = accountResult.insertedId.toString();

      // Create organization
      const organizationResult = await db.collection("organizations").insertOne({
        name: input.organizationName,
        credits: 0,
        ownerId: accountId,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const organizationId = organizationResult.insertedId.toString();

      // Create user profile
      const userResult = await db.collection("users").insertOne({
        accountId,
        organizationId,
        email: input.email,
        name: input.name,
        role: "admin",
        status: "active",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Create session
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      await db.collection("sessions").insertOne({
        accountId,
        token,
        expiresAt,
        createdAt: new Date(),
      });

      // Log signup activity
      await logActivity({
        db,
        userId: userResult.insertedId.toString(),
        userName: input.name,
        activity: "sign-up",
        organizationId,
      });

      return {
        success: true,
        token,
        user: {
          _id: userResult.insertedId.toString(),
          accountId,
          organizationId,
          email: input.email,
          name: input.name,
          role: "admin",
          status: "active",
        },
      };
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

  // Logout
  logout: publicProcedure
    .input(z.object({ token: z.string(), userId: z.string().optional(), userName: z.string().optional(), organizationId: z.string().optional() }))
    .mutation(async ({ input }) => {
      const client = await client_promise;
      const db = client.db();

      // Log logout activity before deleting session
      if (input.userId) {
        await logActivity({
          db,
          userId: input.userId,
          userName: input.userName,
          activity: "log-out",
          organizationId: input.organizationId,
        });
      }

      // Delete session
      await db.collection("sessions").deleteOne({ token: input.token });

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
