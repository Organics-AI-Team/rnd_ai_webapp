/**
 * Conditional Logging Utility
 *
 * Provides centralized logging functionality that is automatically
 * disabled in production environments unless explicitly enabled.
 *
 * Benefits:
 * - No debug logs in production by default
 * - Consistent log formatting
 * - Easy to enable debug mode when needed
 * - Better performance (no runtime overhead in production)
 *
 * @module logger
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger class for conditional logging based on environment
 *
 * Automatically disables debug and info logs in production unless
 * DEBUG_AI environment variable is set to 'true'.
 */
class Logger {
  private is_dev = process.env.NODE_ENV === 'development';
  private is_debug_enabled = process.env.DEBUG_AI === 'true';

  /**
   * Log debug information (development only or when DEBUG_AI=true)
   *
   * @param message - The debug message
   * @param args - Additional data to log
   */
  debug(message: string, ...args: any[]): void {
    if (this.is_dev || this.is_debug_enabled) {
      console.debug(`[DEBUG] ${message}`, ...args);
    }
  }

  /**
   * Log informational messages (development only)
   *
   * @param message - The info message
   * @param args - Additional data to log
   */
  info(message: string, ...args: any[]): void {
    if (this.is_dev) {
      console.info(`[INFO] ${message}`, ...args);
    }
  }

  /**
   * Log warnings (always enabled)
   *
   * Warnings indicate potential issues that don't prevent operation
   * but should be investigated.
   *
   * @param message - The warning message
   * @param args - Additional data to log
   */
  warn(message: string, ...args: any[]): void {
    console.warn(`[WARN] ${message}`, ...args);
  }

  /**
   * Log errors (always enabled)
   *
   * Errors indicate failures that need immediate attention.
   *
   * @param message - The error message
   * @param args - Additional data to log (e.g., error objects, stack traces)
   */
  error(message: string, ...args: any[]): void {
    console.error(`[ERROR] ${message}`, ...args);
  }

  /**
   * Conditional logging based on level
   *
   * @param level - The log level (debug, info, warn, error)
   * @param message - The log message
   * @param args - Additional data to log
   */
  log(level: LogLevel, message: string, ...args: any[]): void {
    this[level](message, ...args);
  }

  /**
   * Log with emoji prefix for better visibility (development only)
   *
   * @param emoji - The emoji to prefix the message with
   * @param message - The log message
   * @param args - Additional data to log
   */
  with_emoji(emoji: string, message: string, ...args: any[]): void {
    if (this.is_dev || this.is_debug_enabled) {
      console.log(`${emoji} ${message}`, ...args);
    }
  }

  /**
   * Check if debug logging is enabled
   *
   * @returns True if debug logging is active
   */
  is_debug_active(): boolean {
    return this.is_dev || this.is_debug_enabled;
  }
}

/**
 * Singleton logger instance
 */
export const logger = new Logger();

/**
 * Convenience exports for direct use
 */
export const { debug, info, warn, error, log, with_emoji } = logger;

/**
 * Check if debug mode is active
 */
export const is_debug_mode = () => logger.is_debug_active();
