import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lasyncro.com',
        pathname: '/**',
      },
    ],
  },
}

export default nextConfig