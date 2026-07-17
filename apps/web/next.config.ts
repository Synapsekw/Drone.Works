import type { NextConfig } from 'next';

const localPersonaEnabled =
  process.env.DRONE_WORKS_ENV === 'local' &&
  process.env.DRONE_WORKS_LOCAL_IDENTITY_ENABLED === 'true';

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
  'report-uri /security/csp-report',
].join('; ');

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  transpilePackages: ['@drone-works/contracts'],
  turbopack: {
    resolveAlias: {
      '@drone-works/web-entry': localPersonaEnabled
        ? './src/app/workspace-entry.tsx'
        : './src/app/hosted-entry.tsx',
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
  async rewrites() {
    const apiUrl = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';
    const routes = [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
    ];
    if (localPersonaEnabled) {
      routes.push({
        source: '/_local/:path*',
        destination: `${apiUrl}/_local/:path*`,
      });
    }
    return routes;
  },
};

export default nextConfig;
