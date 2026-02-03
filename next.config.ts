/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (
    config: any, // or webpack.Configuration if you have @types/webpack installed
    { isServer }: { isServer: boolean }
  ) => {
    if (!isServer) {
      config.resolve.fallback = {
        fs: false,
        tls: false,
        net: false,
        util: false,
      };
    }

    return config;
  },
};

module.exports = nextConfig;
