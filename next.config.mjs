// Production startup checks — fail fast on missing critical config
if (process.env.NODE_ENV === "production") {
  const { runStartupChecks } = await import("./src/lib/startup-checks.ts");
  runStartupChecks();
}

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
          {
            // 2-year max-age; tells browsers to always use HTTPS for this origin.
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            // 'unsafe-inline' is required for the inline theme-detection script
            // injected in layout.tsx that runs before hydration to avoid FOUC.
            // connect-src allows the WhatsOnChain API used for BSV lookups.
            // font-src and the googleapis style-src entry allow Next.js to load
            // Inter and JetBrains Mono from Google Fonts. Without these the
            // font CSS fetch is blocked, which in strict webviews (e.g. Cursor
            // Simple Browser) can stall chunk loading and prevent React hydration.
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data:",
              "connect-src 'self' https://api.whatsonchain.com ws://localhost:* http://localhost:*",
              "frame-ancestors 'none'",
            ].join("; "),
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
