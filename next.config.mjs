/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['192.168.0.16'],
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 's4.anilist.co',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'img1.ak.crunchyroll.com',
        pathname: '/**',
      },
    ],
  },
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
