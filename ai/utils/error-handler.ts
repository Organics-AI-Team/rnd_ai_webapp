/**
 * Centralized error handling utility for the AI system.
 *
 * Provides:
 * - Standardized error classification
 * - Consistent error logging
 * - Error serialization for API responses
 * - Recovery suggestions
 * - Error wrapping with context
 *
 * @module ai/utils/error-handler
 */

import Logger, { LogContext } from './logger';

/**
 * Standard error types for classification
 */
export enum ErrorType {
  // External service errors
  API_ERROR = 'API_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',

  // Input/validation errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',

  // Business logic errors
  NOT_FOUND = 'NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',

  // System errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',

  // AI-specific errors
  MODEL_ERROR = 'MODEL_ERROR',
  EMBEDDING_ERROR = 'EMBEDDING_ERROR',
  KNOWLEDGE_BASE_ERROR = 'KNOWLEDGE_BASE_ERROR',

  // Unknown errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Severity levels for error classification
 */
export enum ErrorSeverity {
  LOW = 'LOW',           // Expected errors, part of normal flow
  MEDIUM = 'MEDIUM',     // Unexpected but recoverable errors
  HIGH = 'HIGH',         // Serious errors requiring attention
  CRITICAL = 'CRITICAL', // System-level failures
}

/**
 * Structured error result
 */
export interface ErrorResult {
  success: false;
  error: {
    type: ErrorType;
    message: string;
    severity: ErrorSeverity;
    originalError?: string;
    context?: LogContext;
    timestamp: string;
    recoverySuggestion?: string;
  };
}

/**
 * Custom application error with metadata
 */
export class AppError extends Error {
  public readonly type: ErrorType;
  public readonly severity: ErrorSeverity;
  public readonly context?: LogContext;
  public readonly recoverySuggestion?: string;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    type: ErrorType = ErrorType.INTERNAL_ERROR,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    context?: LogContext,
    recoverySuggestion?: string,
    isOperational: boolean = true
  ) {
    super(message);
    this.name = 'AppError';
    this.type = type;
    this.severity = severity;
    this.context = context;
    this.recoverySuggestion = recoverySuggestion;
    this.isOperational = isOperational;

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Centralized error handler with consistent logging and formatting.
 */
export class ErrorHandler {
  /**
   * Handle an error with logging and return standardized error result.
   *
   * @param error - Error to handle (can be Error, AppError, or unknown)
   * @param context - Service context for logging
   * @returns Standardized error result
   *
   * @example
   * try {
   *   await riskyOperation();
   * } catch (error) {
   *   return ErrorHandler.handle(error, 'PineconeService');
   * }
   */
  static handle(error: unknown, context: string): ErrorResult {
    const errorInfo = this.classifyError(error);

    // Log with appropriate level based on severity
    this.logError(errorInfo, context);

    return {
      success: false,
      error: {
        type: errorInfo.type,
        message: errorInfo.message,
        severity: errorInfo.severity,
        originalError: errorInfo.originalMessage,
        context: errorInfo.context,
        timestamp: new Date().toISOString(),
        recoverySuggestion: errorInfo.recoverySuggestion,
      },
    };
  }

  /**
   * Handle error and throw AppError with additional context.
   * Useful for wrapping errors with service-specific information.
   *
   * @param error - Original error
   * @param message - Custom error message
   * @param type - Error type classification
   * @param context - Additional context
   * @throws AppError with wrapped information
   *
   * @example
   * try {
   *   await database.query();
   * } catch (error) {
   *   ErrorHandler.wrap(error, 'Failed to query database', ErrorType.DATABASE_ERROR, {
   *     service: 'PineconeService',
   *     query: 'search'
   *   });
   * }
   */
  static wrap(
    error: unknown,
    message: string,
    type: ErrorType,
    context?: LogContext
  ): never {
    const originalError = error instanceof Error ? error : new Error(String(error));

    const wrappedError = new AppError(
      `${message}: ${originalError.message}`,
      type,
      this.inferSeverity(type),
      context
    );

    // Preserve original stack trace
    if (originalError.stack) {
      wrappedError.stack = `${wrappedError.stack}\n\nCaused by: ${originalError.stack}`;
    }

    throw wrappedError;
  }

  /**
   * Classify and extract information from an error.
   *
   * @param error - Error to classify
   * @returns Classified error information
   */
  private static classifyError(error: unknown): {
    type: ErrorType;
    message: string;
    severity: ErrorSeverity;
    originalMessage?: string;
    context?: LogContext;
    recoverySuggestion?: string;
  } {
    // Handle AppError
    if (error instanceof AppError) {
      return {
        type: error.type,
        message: error.message,
        severity: error.severity,
        context: error.context,
        recoverySuggestion: error.recoverySuggestion,
      };
    }

    // Handle standard Error
    if (error instanceof Error) {
      const type = this.inferErrorType(error);
      return {
        type,
        message: error.message,
        severity: this.inferSeverity(type),
        originalMessage: error.message,
        recoverySuggestion: this.getSuggestion(type),
      };
    }

    // Handle unknown error types
    return {
      type: ErrorType.UNKNOWN_ERROR,
      message: String(error),
      severity: ErrorSeverity.MEDIUM,
      originalMessage: String(error),
      recoverySuggestion: 'Check logs for more details',
    };
  }

  /**
   * Infer error type from Error object.
   *
   * @param error - Error object
   * @returns Inferred error type
   */
  private static inferErrorType(error: Error): ErrorType {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // Network errors
    if (
      message.includes('network') ||
      message.includes('fetch') ||
      message.includes('econnrefused') ||
      name.includes('networkerror')
    ) {
      return ErrorType.NETWORK_ERROR;
    }

    // API errors
    if (
      message.includes('api') ||
      message.includes('rate limit') ||
      message.includes('quota')
    ) {
      return ErrorType.API_ERROR;
    }

    // Database errors
    if (
      message.includes('database') ||
      message.includes('mongodb') ||
      message.includes('pinecone') ||
      message.includes('connection')
    ) {
      return ErrorType.DATABASE_ERROR;
    }

    // Validation errors
    if (
      message.includes('invalid') ||
      message.includes('validation') ||
      name.includes('validationerror')
    ) {
      return ErrorType.VALIDATION_ERROR;
    }

    // Timeout errors
    if (message.includes('timeout') || message.includes('timed out')) {
      return ErrorType.TIMEOUT_ERROR;
    }

    // AI-specific errors
    if (message.includes('embedding') || message.includes('vector')) {
      return ErrorType.EMBEDDING_ERROR;
    }

    if (message.includes('model') || message.includes('openai') || message.includes('anthropic')) {
      return ErrorType.MODEL_ERROR;
    }

    // Default to internal error
    return ErrorType.INTERNAL_ERROR;
  }

  /**
   * Infer severity from error type.
   *
   * @param type - Error type
   * @returns Error severity
   */
  private static inferSeverity(type: ErrorType): ErrorSeverity {
    switch (type) {
      case ErrorType.VALIDATION_ERROR:
      case ErrorType.INVALID_INPUT:
      case ErrorType.NOT_FOUND:
        return ErrorSeverity.LOW;

      case ErrorType.RATE_LIMIT_ERROR:
      case ErrorType.TIMEOUT_ERROR:
      case ErrorType.UNAUTHORIZED:
      case ErrorType.FORBIDDEN:
        return ErrorSeverity.MEDIUM;

      case ErrorType.API_ERROR:
      case ErrorType.MODEL_ERROR:
      case ErrorType.EMBEDDING_ERROR:
      case ErrorType.NETWORK_ERROR:
        return ErrorSeverity.HIGH;

      case ErrorType.DATABASE_ERROR:
      case ErrorType.KNOWLEDGE_BASE_ERROR:
      case ErrorType.INTERNAL_ERROR:
        return ErrorSeverity.CRITICAL;

      default:
        return ErrorSeverity.MEDIUM;
    }
  }

  /**
   * Get recovery suggestion for error type.
   *
   * @param type - Error type
   * @returns Human-readable recovery suggestion
   */
  private static getSuggestion(type: ErrorType): string {
    switch (type) {
      case ErrorType.NETWORK_ERROR:
        return 'Check network connectivity and try again';
      case ErrorType.RATE_LIMIT_ERROR:
        return 'Wait a moment and retry the request';
      case ErrorType.TIMEOUT_ERROR:
        return 'The operation took too long. Try with a simpler query';
      case ErrorType.VALIDATION_ERROR:
      case ErrorType.INVALID_INPUT:
        return 'Check input parameters and try again';
      case ErrorType.NOT_FOUND:
        return 'The requested resource does not exist';
      case ErrorType.UNAUTHORIZED:
        return 'Authentication required. Check credentials';
      case ErrorType.FORBIDDEN:
        return 'You do not have permission to perform this action';
      case ErrorType.DATABASE_ERROR:
        return 'Database connection issue. Contact support if this persists';
      case ErrorType.API_ERROR:
        return 'External API error. Try again or contact support';
      case ErrorType.MODEL_ERROR:
        return 'AI model error. Try rephrasing your query';
      default:
        return 'An unexpected error occurred. Contact support if this persists';
    }
  }

  /**
   * Log error with appropriate level based on severity.
   *
   * @param errorInfo - Classified error information
   * @param context - Service context
   */
  private static logError(
    errorInfo: ReturnType<typeof ErrorHandler.classifyError>,
    context: string
  ): void {
    const logContext: LogContext = {
      service: context,
      errorType: errorInfo.type,
      ...errorInfo.context,
    };

    // Create error object for logging
    const errorObj = new Error(errorInfo.message);

    // Log based on severity
    switch (errorInfo.severity) {
      case ErrorSeverity.LOW:
        Logger.warn(errorInfo.message, logContext);
        break;

      case ErrorSeverity.MEDIUM:
      case ErrorSeverity.HIGH:
      case ErrorSeverity.CRITICAL:
        Logger.error(errorInfo.message, errorObj, logContext);
        break;

      default:
        Logger.error(errorInfo.message, errorObj, logContext);
    }
  }

  /**
   * Check if an error is operational (expected/recoverable).
   *
   * @param error - Error to check
   * @returns true if error is operational
   */
  static isOperational(error: unknown): boolean {
    if (error instanceof AppError) {
      return error.isOperational;
    }
    return false;
  }

  /**
   * Create a standardized error response for APIs.
   *
   * @param error - Error to format
   * @param includeStack - Whether to include stack trace (only in dev)
   * @returns Formatted error response
   */
  static toApiResponse(error: unknown, includeStack: boolean = false): Record<string, any> {
    const errorInfo = this.classifyError(error);
    const isDevelopment = process.env.NODE_ENV !== 'production';

    return {
      success: false,
      error: {
        message: errorInfo.message,
        type: errorInfo.type,
        ...(isDevelopment && includeStack && error instanceof Error && { stack: error.stack }),
      },
    };
  }
}

/**
 * Default export for convenience
 */
export default ErrorHandler;
