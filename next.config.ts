import type { NextConfig } from "next";

// Every product/swap/history photo comes from one of these two hosts. Routing them through
// Next's built-in image optimizer (see lib/image.ts's optimizedImageUrl) resizes each one to
// its actual on-screen size, re-encodes it as WebP/AVIF, and caches the transformed result at
// Vercel's edge — dramatically faster than hotlinking the original JPEG straight from Open
// Food Facts or Wikimedia on every load, especially once the edge cache is warm.
const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.openfoodfacts.org", pathname: "/**" },
      { protocol: "https", hostname: "upload.wikimedia.org", pathname: "/**" }
    ],
    formats: ["image/avif", "image/webp"]
  }
};

export default nextConfig;
