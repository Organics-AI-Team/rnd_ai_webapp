/**
 * Environment Variable Validation Utility
 *
 * Validates required environment variables at application startup.
 * Provides clear error messages if critical variables are missing.
 *
 * @module validate-env
 */

/**
 * List of required environment variables for the application
 */
const REQUIRED_ENV_VARS = [
  'MONGODB_URI',
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD',
] as const;

/**
 * List of recommended but optional environment variables
 */
const RECOMMENDED_ENV_VARS = [
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'PINECONE_API_KEY',
  'RAW_MATERIALS_REAL_STOCK_MONGODB_URI',
] as const;

/**
 * Validates required environment variables at application startup
 *
 * Throws an error if any critical variables are missing, preventing
 * the application from starting with incomplete configuration.
 *
 * @throws {Error} If any required environment variables are missing
 */
export function validate_required_env_vars(): void {
  console.log('🔍 Validating environment variables...');

  const missing = REQUIRED_ENV_VARS.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error('\n❌ Missing required environment variables:\n');
    missing.forEach(key => {
      console.error(`   - ${key}`);
    });
    console.error('\nPlease set these variables in your .env.local file');
    console.error('See .env.example for reference\n');

    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }

  // Check recommended variables
  const missing_recommended = RECOMMENDED_ENV_VARS.filter(key => !process.env[key]);

  if (missing_recommended.length > 0) {
    console.warn('\n⚠️  Missing recommended environment variables:');
    missing_recommended.forEach(key => {
      console.warn(`   - ${key}`);
    });
    console.warn('Some features may not work without these variables\n');
  }

  console.log('✅ All required environment variables are set\n');
}

/**
 * Checks if a specific environment variable is set
 *
 * @param key - The environment variable name to check
 * @returns True if the variable is set, false otherwise
 */
export function has_env(key: string): boolean {
  return !!process.env[key];
}

/**
 * Gets an environment variable with type safety
 *
 * @param key - The environment variable name
 * @param fallback - Optional fallback value if not set
 * @returns The environment variable value or fallback
 */
export function get_env(key: string, fallback: string = ''): string {
  return process.env[key] || fallback;
}

/**
 * Gets a required environment variable or throws an error
 *
 * @param key - The environment variable name
 * @returns The environment variable value
 * @throws {Error} If the variable is not set
 */
export function get_required_env(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}\n` +
      `Please set ${key} in your .env.local file`
    );
  }
  return value;
}
