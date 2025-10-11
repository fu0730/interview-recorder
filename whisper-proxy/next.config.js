/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // ビルド時に ESLint の警告で停止しないようにする
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;