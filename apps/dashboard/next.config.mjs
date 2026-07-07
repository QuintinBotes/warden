/** @type {import('next').NextConfig} */
export default {
  output: 'export',
  reactStrictMode: true,
  images: { unoptimized: true },
  transpilePackages: [
    '@warden/design-system',
    '@warden/dashboard-api',
    '@warden/core',
    '@warden/test-management',
  ],
};
