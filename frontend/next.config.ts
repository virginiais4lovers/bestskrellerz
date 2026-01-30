import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        pathname: '/du-prd/**',
      },
      {
        protocol: 'https',
        hostname: '*.nyt.com',
      },
    ],
  },
};

export default nextConfig;
