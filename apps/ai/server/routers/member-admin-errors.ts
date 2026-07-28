// apps/ai/server/routers/member-admin-errors.ts
import { TRPCError } from "@trpc/server";

import {
  DuplicatePendingInvitationError,
  InvitationNotFoundError,
  InvitationNotPendingError,
  LastManagerError,
  ManagerActionForbiddenError,
  MemberNotFoundError,
  ProfileInactiveError,
} from "../services/provisioning/member-admin-ports";

/**
 * Translate a typed member-admin domain failure into the equivalent tRPC
 * transport error. Unknown errors are rethrown untouched so unexpected
 * failures still surface as 500s.
 *
 * @param error - Error thrown by a member-admin service call.
 * @returns Never returns; always throws.
 * @throws TRPCError for typed domain failures, otherwise the original error.
 */
export function throw_member_admin_error(error: unknown): never {
  if (
    error instanceof MemberNotFoundError ||
    error instanceof InvitationNotFoundError
  ) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  if (error instanceof ManagerActionForbiddenError) {
    throw new TRPCError({ code: "FORBIDDEN", message: error.message });
  }
  if (
    error instanceof ProfileInactiveError ||
    error instanceof InvitationNotPendingError ||
    error instanceof DuplicatePendingInvitationError ||
    error instanceof LastManagerError
  ) {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  throw error;
}
