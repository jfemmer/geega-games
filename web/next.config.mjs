/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cards.scryfall.io' },
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
};
export default nextConfig;
