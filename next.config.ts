import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Resource-Policy", value: "same-site" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  compress: true,
  // Free OpenRouter model slugs are intentionally not pinned here: they can
  // disappear or move to paid-only without notice. The official free router
  // selects a currently available free model and prevents the Telegram bot
  // from falling over when an individual :free slug is retired.
  env: {
    OPENROUTER_FAST_MODELS: "openrouter/free",
  },
  images: { formats: ["image/avif", "image/webp"], minimumCacheTTL: 86400 },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [{ source: "/admin", destination: "/admin/ops", permanent: false }];
  },
};

export default nextConfig;
