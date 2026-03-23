/**
 * Production startup checks — called from next.config.mjs.
 *
 * These guards warn about missing critical configuration at build time
 * and fail hard at runtime when secrets are actually needed.
 * They run once at build/startup time, not per-request.
 */

export function runStartupChecks(): void {
  if (process.env.NODE_ENV !== "production") return;

  const warnings: string[] = [];

  // Core — the only hard-fail env var
  if (!process.env.BSV_FUNDING_KEY) {
    warnings.push("BSV_FUNDING_KEY is not set — the wallet private key (WIF format) is required at runtime.");
  }

  // Redis — required at runtime for tip persistence and rate limiting.
  // The redis.ts module enforces this at runtime; here we just warn.
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    warnings.push("UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — Redis is required at runtime for tip persistence and rate limiting.");
  }

  if (!process.env.RATE_LIMIT_SALT) {
    warnings.push("RATE_LIMIT_SALT not set — required at runtime for IP hashing.");
  }

  if (!process.env.OPENAI_API_KEY) {
    warnings.push("OPENAI_API_KEY not set — keyword fallback will be used for moderation.");
  }

  if (warnings.length > 0) {
    console.warn("");
    console.warn("=== STARTUP WARNINGS ===");
    for (const w of warnings) {
      console.warn(`  - ${w}`);
    }
    console.warn("========================");
    console.warn("These env vars must be set at runtime in Vercel.");
    console.warn("");
  }
}
