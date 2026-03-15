/** @type {import('next').NextConfig} */
const nextConfig = {
  // postgres driver uses Node.js native TLS — must run in Node runtime, not Edge.
  // Drizzle and @bsv/sdk are also Node-only.
  serverExternalPackages: ["postgres"],

  // Vercel serverless function configuration lives in vercel.json.
  // The maxDuration for broadcast routes is set there (30s).

  // Strict mode for catching issues early in development.
  reactStrictMode: true,

  // Prevent the BSV_FUNDING_KEY (and any other server secret) from
  // accidentally leaking into the client bundle via publicRuntimeConfig.
  // Only NEXT_PUBLIC_ vars should reach the browser.
  // This is a belt-and-suspenders check — do not add secrets here.

  async headers() {
    return [
      {
        // Apply security headers to all routes.
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        // Cron routes must only be called by Vercel's cron infrastructure.
        // The Authorization header check in each route is the real guard;
        // this Cache-Control header prevents CDN caching of cron responses.
        source: "/api/cron/(.*)",
        headers: [
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
