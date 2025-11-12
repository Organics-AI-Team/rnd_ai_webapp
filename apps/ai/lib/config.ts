/**
 * Application Configuration Constants
 *
 * Centralizes all configurable values for easy maintenance and reusability.
 * Eliminates hard-coded values scattered throughout the codebase.
 *
 * Benefits:
 * - Single source of truth for all configuration
 * - Type-safe constant access
 * - Easy to update values in one place
 * - Clear documentation of all configurable options
 *
 * @module config
 */

/**
 * Application-wide configuration constants
 */
export const APP_CONFIG = {
  /**
   * Base URLs
   */
  base_url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  api_url: process.env.NEXT_PUBLIC_API_URL || '/api',

  /**
   * AI Service Configuration
   */
  ai: {
    /**
     * Default number of results to return from RAG search
     */
    default_top_k: 5,

    /**
     * Default temperature for AI model responses (0.0 - 1.0)
     * Lower = more deterministic, Higher = more creative
     */
    default_temperature: 0.7,

    /**
     * Maximum number of results for RAG search
     */
    max_top_k: 10,

    /**
     * Vector dimensions for different embedding models
     */
    vector_dimensions: {
      gemini: 768,
      openai: 1536,
    },
  },

  /**
   * Session Configuration
   */
  session: {
    /**
     * Maximum age for session cookies (in seconds)
     * Default: 7 days
     */
    max_age: 7 * 24 * 60 * 60,

    /**
     * Session cookie name
     */
    cookie_name: 'rnd-ai-auth-session',
  },

  /**
   * Pagination Configuration
   */
  pagination: {
    /**
     * Default number of items per page
     */
    default_page_size: 10,

    /**
     * Maximum number of items per page
     */
    max_page_size: 100,
  },

  /**
   * Code Generation Configuration
   */
  code_generation: {
    /**
     * Default padding for generated codes (e.g., PROD000001)
     */
    default_padding: 6,

    /**
     * Code prefixes for different entity types
     */
    prefixes: {
      product: 'PROD',
      formula: 'FORM',
      order: 'ORD',
      shipment: 'SHIP',
    },
  },
} as const;

/**
 * Application route constants
 *
 * Centralized route definitions to prevent hard-coded URLs
 */
export const ROUTES = {
  /**
   * Public routes
   */
  home: '/',
  login: '/login',
  signup: '/signup',

  /**
   * Dashboard routes
   */
  dashboard: '/dashboard',
  shipping: '/shipping',
  formulas: '/formulas',

  /**
   * AI-related routes
   */
  ai: {
    home: '/ai',
    analytics: '/ai/analytics',
    agents: '/ai/agents',
    raw_materials: '/ai/raw-materials-ai',
    sales_rnd: '/ai/sales-rnd-ai',
  },

  /**
   * Admin routes
   */
  admin: {
    products: '/products',
    credits: '/admin/credits',
    formulas: '/formulas/create',
    vector_indexing: '/admin/vector-indexing',
  },

  /**
   * API routes
   */
  api: {
    trpc: '/api/trpc',
    auth: {
      login: '/api/auth/login',
      logout: '/api/auth/logout',
      session: '/api/auth/session',
    },
    agents: {
      list: '/api/agents',
      chat: (agent_id: string) => `/api/agents/${agent_id}/chat`,
    },
    rag: {
      search: '/api/rag/search',
    },
  },
} as const;

/**
 * Environment helpers
 */
export const ENV = {
  /**
   * Check if running in development mode
   */
  is_development: () => process.env.NODE_ENV === 'development',

  /**
   * Check if running in production mode
   */
  is_production: () => process.env.NODE_ENV === 'production',

  /**
   * Check if running in test mode
   */
  is_test: () => process.env.NODE_ENV === 'test',

  /**
   * Check if debug mode is enabled
   */
  is_debug: () => process.env.DEBUG_AI === 'true',
} as const;

/**
 * Database collection names
 *
 * Centralizes database collection names to prevent typos and inconsistencies
 */
export const COLLECTIONS = {
  users: 'users',
  products: 'products',
  formulas: 'formulas',
  orders: 'orders',
  shipments: 'shipments',
  raw_materials: 'raw_materials',
  credits: 'credits',
  feedback: 'ai_feedback',
  conversations: 'ai_conversations',
} as const;

/**
 * Error messages
 *
 * Centralized error messages for consistency
 */
export const ERROR_MESSAGES = {
  auth: {
    invalid_credentials: 'Invalid credentials',
    missing_credentials: 'Email and password are required',
    server_config_error: 'Server configuration error',
    unauthorized: 'Unauthorized',
  },
  database: {
    connection_failed: 'Database connection failed',
    not_found: 'Resource not found',
    duplicate_key: 'Duplicate key error',
  },
  ai: {
    provider_not_found: 'AI provider not found',
    generation_failed: 'AI generation failed',
    invalid_prompt: 'Invalid prompt',
  },
} as const;
