import type { Permission } from "@rnd-ai/shared-types";
import {
  SUPPORT_DIAGNOSTIC_PERMISSIONS,
  SUPPORT_GRANT_MAX_DURATION_HOURS,
} from "@rnd-ai/shared-types";

/**
 * Validate a support-access request's permissions and duration against the
 * platform ceiling. Content permissions outside the diagnostic allowlist and
 * durations above the maximum are rejected.
 *
 * @param permissions - Requested diagnostic permissions.
 * @param duration_hours - Requested grant duration in hours.
 * @throws Error describing the first violated constraint.
 */
export function validate_support_request(
  permissions: readonly Permission[],
  duration_hours: number,
): void {
  if (permissions.length === 0) {
    throw new Error("At least one diagnostic permission must be requested.");
  }
  for (const permission of permissions) {
    if (!SUPPORT_DIAGNOSTIC_PERMISSIONS.includes(permission)) {
      throw new Error(
        `Permission is not grantable through support access: ${permission}`,
      );
    }
  }
  if (
    !Number.isFinite(duration_hours) ||
    duration_hours <= 0 ||
    duration_hours > SUPPORT_GRANT_MAX_DURATION_HOURS
  ) {
    throw new Error(
      `Duration must be between 1 and ${SUPPORT_GRANT_MAX_DURATION_HOURS} hours.`,
    );
  }
}
