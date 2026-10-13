import type { NextConfig } from 'next'

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Keeps invite tokens in the URL from leaking to other origins.
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

const nextConfig: NextConfig = {
  serverExternalPackages: ['@electric-sql/pglite'],
  experimental: {
    // Vercel caps function request bodies at 4.5 MB.
    serverActions: { bodySizeLimit: '4.5mb' },
  },
  async rewrites() {
    return [{ source: '/', destination: '/index.html' }]
  },
  async headers() {
    return [{ source: '/sign/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
