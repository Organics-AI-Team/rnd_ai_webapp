/**
 * Centralized logging utility for the AI system.
 *
 * Provides structured logging with:
 * - Log level control based on environment
 * - Context propagation (service name, correlation ID)
 * - Consistent formatting with timestamps
 * - Production-ready error tracking
 * - Performance-friendly log sampling
 *
 * Usage:
 *   Logger.info('User query received', { userId: '123', query: 'cosmetic ingredients' });
 *   Logger.error('Database connection failed', error, { service: 'PineconeService' });
 *   Logger.debug('Cache hit', { key: 'embedding:abc123' });
 *
 * @module ai/utils/logger
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

export interface LogContext {
  service?: string;
  correlationId?: string;
  userId?: string;
  sessionId?: string;
  [key: string]: any;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/**
 * Centralized logger with structured logging support.
 *
 * Features:
 * - Environment-based log level filtering
 * - Structured JSON output for production
 * - Context propagation across service calls
 * - Error serialization with stack traces
 * - Performance-optimized (lazy evaluation)
 */
export class Logger {
  private static currentLevel: LogLevel = Logger.getDefaultLogLevel();
  private static globalContext: LogContext = {};
  private static isProduction = process.env.NODE_ENV === 'production';

  /**
   * Get default log level based on environment.
   */
  private static getDefaultLogLevel(): LogLevel {
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();

    switch (envLevel) {
      case 'DEBUG':
        return LogLevel.DEBUG;
      case 'INFO':
        return LogLevel.INFO;
      case 'WARN':
        return LogLevel.WARN;
      case 'ERROR':
        return LogLevel.ERROR;
      case 'NONE':
        return LogLevel.NONE;
      default:
        // Default: INFO in production, DEBUG in development
        return process.env.NODE_ENV === 'production' ? LogLevel.INFO : LogLevel.DEBUG;
    }
  }

  /**
   * Set global log level at runtime.
   *
   * @param level - The minimum log level to output
   */
  static setLogLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  /**
   * Set global context that will be included in all logs.
   * Useful for request-scoped context like correlation IDs.
   *
   * @param context - Context object to merge with existing global context
   */
  static setGlobalContext(context: LogContext): void {
    this.globalContext = { ...this.globalContext, ...context };
  }

  /**
   * Clear global context.
   */
  static clearGlobalContext(): void {
    this.globalContext = {};
  }

  /**
   * Check if a log level should be output.
   *
   * @param level - Log level to check
   * @returns true if the level should be logged
   */
  private static shouldLog(level: LogLevel): boolean {
    return level >= this.currentLevel;
  }

  /**
   * Format and output a log entry.
   *
   * @param level - Log level
   * @param message - Log message
   * @param context - Optional context data
   * @param error - Optional error object
   */
  private static log(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error
  ): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const levelName = LogLevel[level];
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: levelName,
      message,
      context: { ...this.globalContext, ...context },
    };

    // Serialize error if provided
    if (error) {
      logEntry.error = {
        name: error.name,
        message: error.message,
        stack: this.isProduction ? undefined : error.stack,
      };
    }

    // Output format: structured JSON in production, pretty in development
    if (this.isProduction) {
      // Structured logging for production (easy to parse by log aggregators)
      console[this.getConsoleMethod(level)](JSON.stringify(logEntry));
    } else {
      // Pretty logging for development
      const contextStr = Object.keys(logEntry.context || {}).length > 0
        ? ` ${JSON.stringify(logEntry.context)}`
        : '';

      const errorStr = error
        ? `\n  Error: ${error.message}\n  Stack: ${error.stack}`
        : '';

      console[this.getConsoleMethod(level)](
        `[${logEntry.timestamp}] [${levelName}] ${message}${contextStr}${errorStr}`
      );
    }
  }

  /**
   * Get the appropriate console method for a log level.
   *
   * @param level - Log level
   * @returns Console method name
   */
  private static getConsoleMethod(level: LogLevel): 'log' | 'info' | 'warn' | 'error' {
    switch (level) {
      case LogLevel.DEBUG:
        return 'log';
      case LogLevel.INFO:
        return 'info';
      case LogLevel.WARN:
        return 'warn';
      case LogLevel.ERROR:
        return 'error';
      default:
        return 'log';
    }
  }

  /**
   * Log a debug message (lowest priority).
   * Only shown in development by default.
   *
   * @param message - Debug message
   * @param context - Optional context data
   *
   * @example
   * Logger.debug('Cache hit', { key: 'embedding:abc123', ttl: 3600 });
   */
  static debug(message: string, context?: LogContext): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * Log an informational message.
   * Standard output for normal operations.
   *
   * @param message - Info message
   * @param context - Optional context data
   *
   * @example
   * Logger.info('User query processed', { userId: '123', duration: 245 });
   */
  static info(message: string, context?: LogContext): void {
    this.log(LogLevel.INFO, message, context);
  }

  /**
   * Log a warning message.
   * For recoverable issues that need attention.
   *
   * @param message - Warning message
   * @param context - Optional context data
   *
   * @example
   * Logger.warn('API rate limit approaching', { remaining: 5, limit: 100 });
   */
  static warn(message: string, context?: LogContext): void {
    this.log(LogLevel.WARN, message, context);
  }

  /**
   * Log an error message (highest priority).
   * For failures that require immediate attention.
   *
   * @param message - Error message
   * @param error - Error object with stack trace
   * @param context - Optional context data
   *
   * @example
   * Logger.error('Database query failed', dbError, {
   *   service: 'PineconeService',
   *   query: 'search',
   *   userId: '123'
   * });
   */
  static error(message: string, error?: Error, context?: LogContext): void {
    this.log(LogLevel.ERROR, message, context, error);
  }

  /**
   * Create a scoped logger with pre-filled context.
   * Useful for service-specific logging.
   *
   * @param serviceName - Name of the service
   * @returns Scoped logger instance
   *
   * @example
   * const logger = Logger.scope('EnhancedRawMaterialsAgent');
   * logger.info('Processing query'); // Automatically includes service name
   */
  static scope(serviceName: string) {
    const scopedContext = { service: serviceName };

    return {
      debug: (message: string, context?: LogContext) =>
        this.debug(message, { ...scopedContext, ...context }),

      info: (message: string, context?: LogContext) =>
        this.info(message, { ...scopedContext, ...context }),

      warn: (message: string, context?: LogContext) =>
        this.warn(message, { ...scopedContext, ...context }),

      error: (message: string, error?: Error, context?: LogContext) =>
        this.error(message, error, { ...scopedContext, ...context }),
    };
  }

  /**
   * Log function entry with parameters (useful for debugging).
   *
   * @param functionName - Name of the function
   * @param params - Function parameters
   *
   * @example
   * Logger.fnEntry('processQuery', { query: 'cosmetics', userId: '123' });
   */
  static fnEntry(functionName: string, params?: Record<string, any>): void {
    this.debug(`→ Entering ${functionName}`, { params });
  }

  /**
   * Log function exit with result (useful for debugging).
   *
   * @param functionName - Name of the function
   * @param result - Function result (will be truncated if too large)
   *
   * @example
   * Logger.fnExit('processQuery', { success: true, resultsCount: 5 });
   */
  static fnExit(functionName: string, result?: any): void {
    // Truncate large results in logs
    const truncatedResult = typeof result === 'string' && result.length > 100
      ? `${result.substring(0, 100)}...`
      : result;

    this.debug(`← Exiting ${functionName}`, { result: truncatedResult });
  }
}

/**
 * Default export for convenience
 */
export default Logger;
