/**
 * Stable authorization failure codes shared by every principal resolver and
 * authorization assertion. Route and procedure layers map these to transport
 * status codes without parsing messages.
 */
export type AuthorizationErrorCode =
  | "UNAUTHENTICATED"
  | "MEMBERSHIP_INACTIVE"
  | "FORBIDDEN";

/**
 * Typed authorization failure carrying a stable code and a safe message.
 * Messages never include tokens, credentials, or record contents.
 */
export class AuthorizationError extends Error {
  readonly code: AuthorizationErrorCode;

  /**
   * Create a typed authorization failure.
   *
   * @param code - Stable machine-readable failure code.
   * @param message - Safe human-readable description without secrets.
   */
  constructor(code: AuthorizationErrorCode, message: string) {
    super(message);
    this.name = "AuthorizationError";
    this.code = code;
  }
}
