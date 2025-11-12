/**
 * @rnd-ai/shared-utils
 *
 * Shared utility functions for RND AI Management monorepo
 *
 * Provides:
 * - Structured logging with context propagation
 * - CSS class name utilities (Tailwind)
 * - Common helper functions
 *
 * @module @rnd-ai/shared-utils
 */

// Logger
export {
  Logger,
  LogLevel,
  type LogContext,
  type LogEntry
} from './logger';

// CSS utilities
export { cn } from './cn';
