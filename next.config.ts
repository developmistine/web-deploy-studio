import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // Server-only packages that must not be bundled for the edge/client.
  serverExternalPackages: ['yauzl', 'yazl', 'mariadb'],
}

export default nextConfig
