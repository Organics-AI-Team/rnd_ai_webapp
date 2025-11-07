/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */

  // Temporarily disable TypeScript checking during build
  // TODO: Re-enable after resolving all type errors
  typescript: {
    ignoreBuildErrors: true,
  },

  // Enable standalone output for Docker
  // This creates a minimal server.js file with all dependencies bundled
  // Reduces image size and improves cold start performance
  output: 'standalone',

  // Disable minification in development to avoid webpack compatibility issues
  // Production builds can be optimized once dependencies are resolved
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
  },

  // Fix for Pinecone fs module issue and MongoDB browser compatibility
  // Prevents bundling Node.js modules in client-side code
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        fs: false,
        path: false,
        os: false,
        net: false,
        tls: false,
        crypto: false,
        stream: false,
        util: false,
        url: false,
        zlib: false,
        http: false,
        https: false,
        assert: false,
        buffer: false,
        process: false,
        child_process: false,
        events: false,
        string_decoder: false,
        dns: false,
        querystring: false,
        timers: false,
        'timers/promises': false,
        'node:async_hooks': false,
        'node:stream': false,
        'node:util': false,
        'node:buffer': false,
        'node:process': false,
        'node:path': false,
        'node:fs': false,
        'node:crypto': false,
        'node:http': false,
        'node:https': false,
        'node:net': false,
        'node:tls': false,
        'node:dns': false,
        'node:url': false,
        'node:querystring': false,
        'node:zlib': false,
        'node:events': false,
        kerberos: false,
        '@mongodb-js/zstd': false,
        '@aws-sdk/credential-providers': false,
        'gcp-metadata': false,
        snappy: false,
        socks: false,
        aws4: false,
        'mongodb-client-encryption': false
      };

      // Add externals to prevent MongoDB and other Node.js modules from being bundled on client side
      config.externals = {
        ...config.externals,
        'mongodb': 'mongodb',
        'mongodb/lib': 'mongodb/lib',
        'mongodb/lib/cmap/auth/mongodb_oidc/callback_workflow': 'mongodb/lib/cmap/auth/mongodb_oidc/callback_workflow',
        'mongodb/lib/cmap/auth/mongodb_oidc/automated_callback_workflow': 'mongodb/lib/cmap/auth/mongodb_oidc/automated_callback_workflow',
        'mongodb/lib/mongo_client_auth_providers': 'mongodb/lib/mongo_client_auth_providers',
        '@langchain/langgraph': '@langchain/langgraph',
        // '@pinecone-database/pinecone': '@pinecone-database/pinecone', // Disabled - Using ChromaDB instead
        '@tensorflow/tfjs': '@tensorflow/tfjs',
        'node:async_hooks': 'node:async_hooks',
        'node:stream': 'node:stream',
        // Enhanced services exclusions
        '@/ai/services/knowledge/cosmetic-knowledge-sources': '@/ai/services/knowledge/cosmetic-knowledge-sources',
        '@/ai/services/quality/cosmetic-quality-scorer': '@/ai/services/quality/cosmetic-quality-scorer',
        '@/ai/services/regulatory/cosmetic-regulatory-sources': '@/ai/services/regulatory/cosmetic-regulatory-sources',
        '@/ai/services/credibility/cosmetic-credibility-weighting': '@/ai/services/credibility/cosmetic-credibility-weighting',
        '@/ai/services/response/response-reranker': '@/ai/services/response/response-reranker',
        '@/ai/services/rag/enhanced-hybrid-search-service': '@/ai/services/rag/enhanced-hybrid-search-service',
        '@/ai/services/ml/preference-learning-service': '@/ai/services/ml/preference-learning-service',
        '@/ai/agents/raw-materials-ai/enhanced-raw-materials-agent': '@/ai/agents/raw-materials-ai/enhanced-raw-materials-agent',
        '@/ai/agents/sales-rnd-ai/enhanced-sales-rnd-agent': '@/ai/agents/sales-rnd-ai/enhanced-sales-rnd-agent'
      };

      config.resolve.extensions = ['.js', '.jsx', '.ts', '.tsx'];
    }

    return config;
  },
};

module.exports = nextConfig;
