import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  transpilePackages: ['@drone-works/contracts'],
  async rewrites() {
    const apiUrl = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
