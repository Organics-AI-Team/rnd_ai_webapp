"use client";

/**
 * Compatibility adapter for checkouts that still use the legacy auth context.
 * The deployed application provides the Clerk-backed module at this path;
 * keeping the same narrow exports here lets shared console components use one
 * auth import during the transition.
 */
export { useAuth } from "./auth-context";
