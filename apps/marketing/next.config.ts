import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lasyncro.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'www.lasyncro.com',
        pathname: '/**',
      },
    ],
  },
}

export default nextConfig