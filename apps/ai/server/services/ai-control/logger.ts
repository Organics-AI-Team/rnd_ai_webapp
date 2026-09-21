/**
 * Structured console logger for the AI control plane.
 *
 * Emits timestamped, correlation-aware entry/exit/error logs in the same
 * `[module] message` style used across the AI workspace, without ever
 * logging raw model arguments, evidence content, or credentials.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

/** Safe structured fields attached to a log line. */
export type LogFields = Record<
  string,
  string | number | boolean | null | undefined
>;

/**
 * Render one structured log line.
 *
 * @param module_name - Short module tag, e.g. "tool-executor".
 * @param message - Event description, e.g. "execute — start".
 * @param fields - Optional safe structured fields (ids, counts, codes).
 * @returns Formatted single-line log string.
 */
function format_line(
  module_name: string,
  message: string,
  fields?: LogFields,
): string {
  const timestamp = new Date().toISOString();
  const suffix =
    fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
  return `${timestamp} [${module_name}] ${message}${suffix}`;
}

/**
 * Log an informational control-plane event.
 *
 * @param module_name - Short module tag.
 * @param message - Event description.
 * @param fields - Optional safe structured fields.
 */
export function log_info(
  module_name: string,
  message: string,
  fields?: LogFields,
): void {
  console.log(format_line(module_name, message, fields));
}

/**
 * Log a control-plane error event.
 *
 * @param module_name - Short module tag.
 * @param message - Event description.
 * @param fields - Optional safe structured fields (never raw payloads).
 */
export function log_error(
  module_name: string,
  message: string,
  fields?: LogFields,
): void {
  console.error(format_line(module_name, message, fields));
}
