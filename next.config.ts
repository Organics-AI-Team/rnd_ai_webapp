import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */

  // Enable standalone output for Docker
  // This creates a minimal server.js file with all dependencies bundled
  // Reduces image size and improves cold start performance
  output: 'standalone',

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
        kerberos: false,
        '@mongodb-js/zstd': false,
        '@aws-sdk/credential-providers': false,
        'gcp-metadata': false,
        snappy: false,
        socks: false,
        aws4: false,
        'mongodb-client-encryption': false
      };

      // Add externals to prevent MongoDB from being bundled on client side
      config.externals = {
        ...config.externals,
        'mongodb': 'mongodb',
        'mongodb/lib': 'mongodb/lib',
        'mongodb/lib/cmap/auth/mongodb_oidc/callback_workflow': 'mongodb/lib/cmap/auth/mongodb_oidc/callback_workflow',
        'mongodb/lib/cmap/auth/mongodb_oidc/automated_callback_workflow': 'mongodb/lib/cmap/auth/mongodb_oidc/automated_callback_workflow',
        'mongodb/lib/mongo_client_auth_providers': 'mongodb/lib/mongo_client_auth_providers'
      };

      config.resolve.extensions = ['.js', '.jsx', '.ts', '.tsx'];
    }

    return config;
  },

  // Configure external packages for server-side only
  serverExternalPackages: [
    '@pinecone-database/pinecone',
    'mongodb',
    'mongodb/lib',
    'kerberos',
    '@mongodb-js/zstd',
    '@aws-sdk/credential-providers',
    'gcp-metadata',
    'snappy',
    'socks',
    'aws4',
    'mongodb-client-encryption'
  ],
};

export default nextConfig;
