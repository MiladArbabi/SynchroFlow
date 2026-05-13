import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lasyncro.com', pathname: '/**' },
      { protocol: 'https', hostname: 'www.lasyncro.com', pathname: '/**' },
    ],
  },

  // 301 redirects — add new entries here when consolidating duplicate content.
  // Format: { source: '/old-path', destination: '/new-path', permanent: true }
  async redirects() {
    return [
      {
        source: '/blog/does-shopify-have-built-in-warehouse-management',
        destination: '/blog/shopify-warehouse-management',
        permanent: true, // 301 — passes link equity to the canonical post
      },
    ]
  },
}

export default nextConfig
