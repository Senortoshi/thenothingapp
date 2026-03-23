/**
 * Production startup checks — called from next.config.mjs.
 *
 * These guards prevent deploying with missing critical configuration.
 * They run once at build/startup time, not per-request.
 */

export function runStartupChecks(): void {
  if (process.env.NODE_ENV !== "production") return;

  const missing: string[] = [];

  // Core — the only required env var for the on-chain MVP
  if (!process.env.BSV_FUNDING_KEY) {
    missing.push("BSV_FUNDING_KEY is required — the wallet private key (WIF format).");
  }

  // Required for production — Redis backs the tip, mutex, rate limiting, and spend cap
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    missing.push("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required for rate limiting and tip persistence.");
  }

  if (!process.env.RATE_LIMIT_SALT) {
    missing.push("RATE_LIMIT_SALT is required — IP hashing will fail without it.");
  }

  // Optional but recommended for production
  if (!process.env.OPENAI_API_KEY) {
    console.warn("[startup] OPENAI_API_KEY not set — keyword fallback will be used for moderation.");
  }

  if (missing.length > 0) {
    const msg = [
      "",
      "=== STARTUP CHECK FAILED ===",
      ...missing.map((m) => `  - ${m}`),
      "============================",
      "",
    ].join("\n");

    console.error(msg);
    throw new Error(`Startup checks failed: ${missing.length} issue(s). See logs above.`);
  }
}
