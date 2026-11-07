import type { NextConfig } from 'next';
const config: NextConfig = { transpilePackages: ['@dima/ui', '@dima/client', '@dima/contracts'], poweredByHeader: false, images: { unoptimized: true }, experimental: { cpus: 1 } };
export default config;
