/**
 * src/lib/rate-limiter.ts
 *
 * Redis-backed rate limiting, spend cap, and circuit breaker.
 * All state persists in Upstash Redis across Vercel serverless isolates.
 *
 * Checks (in order — first failure wins):
 * 1. Circuit breaker  — pause if too many consecutive broadcast failures
 * 2. Per-IP per-minute — default 5 req / 60 s
 * 3. Per-IP per-day    — default 100 req / 24 h
 * 4. Global per-hour   — default 500 req / 3600 s
 * 5. Daily spend cap   — reject when cumulative sats hits cap
 *
 * Dev fallback: when Redis is not configured, uses in-memory state (not safe
 * for production — counters reset on cold start).
 */

import { Ratelimit } from "@upstash/ratelimit";
import { hashIp } from "./ip";
import { getRedis } from "./redis";
import {
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_SECONDS,
  GLOBAL_RATE_LIMIT_MAX,
  GLOBAL_RATE_LIMIT_WINDOW,
  DAILY_SPEND_CAP_SATS,
  RATE_LIMIT_DAILY_MAX,
  CIRCUIT_BREAKER_THRESHOLD,
  CIRCUIT_BREAKER_COOLDOWN_SECONDS,
} from "./constants";

export {
  GLOBAL_RATE_LIMIT_MAX,
  GLOBAL_RATE_LIMIT_WINDOW,
  DAILY_SPEND_CAP_SATS,
  CIRCUIT_BREAKER_THRESHOLD,
  CIRCUIT_BREAKER_COOLDOWN_SECONDS,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RateLimitResult =
  | { allowed: true; headers: Record<string, string> }
  | { allowed: false; status: 429 | 503; reason: string; headers: Record<string, string> };

// ---------------------------------------------------------------------------
// Redis keys
// ---------------------------------------------------------------------------

const CB_FAILURES_KEY = "nothing_app:cb:failures";
const CB_OPEN_KEY = "nothing_app:cb:open";

function dailySpendKey(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `nothing_app:spend:daily:${today}`;
}

// ---------------------------------------------------------------------------
// Upstash Ratelimit instances (lazy-initialized)
// ---------------------------------------------------------------------------

let _ipMinuteRl: Ratelimit | null = null;
let _ipDailyRl: Ratelimit | null = null;
let _globalRl: Ratelimit | null = null;
let _rlInitialized = false;

function initRatelimiters(): void {
  if (_rlInitialized) return;
  _rlInitialized = true;

  const redis = getRedis();
  if (!redis) return; // dev fallback — skip Ratelimit init

  _ipMinuteRl = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(RATE_LIMIT_MAX, `${RATE_LIMIT_WINDOW_SECONDS} s`),
    prefix: "nothing_app:rl:ip:min",
    analytics: false,
  });

  _ipDailyRl = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(RATE_LIMIT_DAILY_MAX, "1 d"),
    prefix: "nothing_app:rl:ip:day",
    analytics: false,
  });

  _globalRl = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(GLOBAL_RATE_LIMIT_MAX, `${GLOBAL_RATE_LIMIT_WINDOW} s`),
    prefix: "nothing_app:rl:global",
    analytics: false,
  });
}

// ---------------------------------------------------------------------------
// In-memory fallback (dev only)
// ---------------------------------------------------------------------------

const _memIpRequests = new Map<string, number[]>();
const _memGlobalRequests: number[] = [];
let _memConsecutiveFailures = 0;
let _memCircuitOpenUntil = 0;
let _memDailySpend = { date: "", sats: 0 };

function memSlidingWindowCount(timestamps: number[], windowMs: number, now: number): number {
  const cutoff = now - windowMs;
  while (timestamps.length > 0 && timestamps[0] <= cutoff) {
    timestamps.shift();
  }
  return timestamps.length;
}

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

export async function recordBroadcastSuccess(): Promise<void> {
  const redis = getRedis();

  if (!redis) {
    _memConsecutiveFailures = 0;
    return;
  }

  // Reset failure counter
  await redis.del(CB_FAILURES_KEY);
}

export async function recordBroadcastFailure(): Promise<void> {
  const redis = getRedis();

  if (!redis) {
    _memConsecutiveFailures++;
    if (_memConsecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      _memCircuitOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_SECONDS * 1000;
      _memConsecutiveFailures = 0;
      console.error(`[rate-limiter] Circuit breaker TRIPPED (in-memory). Pausing for ${CIRCUIT_BREAKER_COOLDOWN_SECONDS}s.`);
    }
    return;
  }

  const failures = await redis.incr(CB_FAILURES_KEY);
  // Set a TTL so the key doesn't live forever if broadcasts resume
  await redis.expire(CB_FAILURES_KEY, CIRCUIT_BREAKER_COOLDOWN_SECONDS * 2);

  if (failures >= CIRCUIT_BREAKER_THRESHOLD) {
    await redis.set(CB_OPEN_KEY, "1", { ex: CIRCUIT_BREAKER_COOLDOWN_SECONDS });
    await redis.del(CB_FAILURES_KEY);
    console.error(`[rate-limiter] Circuit breaker TRIPPED. Pausing for ${CIRCUIT_BREAKER_COOLDOWN_SECONDS}s.`);
  }
}

async function isCircuitOpen(): Promise<{ open: boolean; retryAfter?: number }> {
  const redis = getRedis();

  if (!redis) {
    const now = Date.now();
    if (now < _memCircuitOpenUntil) {
      return { open: true, retryAfter: Math.ceil((_memCircuitOpenUntil - now) / 1000) };
    }
    return { open: false };
  }

  const ttl = await redis.ttl(CB_OPEN_KEY);
  if (ttl > 0) {
    return { open: true, retryAfter: ttl };
  }
  return { open: false };
}

// ---------------------------------------------------------------------------
// Daily spend cap
// ---------------------------------------------------------------------------

export async function recordSpend(sats: number): Promise<void> {
  const redis = getRedis();

  if (!redis) {
    const today = new Date().toISOString().slice(0, 10);
    if (_memDailySpend.date !== today) {
      _memDailySpend = { date: today, sats: 0 };
    }
    _memDailySpend.sats += sats;
    return;
  }

  const key = dailySpendKey();
  await redis.incrby(key, sats);
  // Auto-expire after 25 hours so yesterday's key cleans up
  await redis.expire(key, 90_000);
}

async function getDailySpend(): Promise<number> {
  const redis = getRedis();

  if (!redis) {
    const today = new Date().toISOString().slice(0, 10);
    if (_memDailySpend.date !== today) return 0;
    return _memDailySpend.sats;
  }

  const sats = await redis.get<number>(dailySpendKey());
  return sats ?? 0;
}

// ---------------------------------------------------------------------------
// Main gate
// ---------------------------------------------------------------------------

export async function checkRateLimit(rawIp: string): Promise<RateLimitResult> {
  try {
    const hashedIp = hashIp(rawIp);
    initRatelimiters();

    // 1. Circuit breaker
    const cb = await isCircuitOpen();
    if (cb.open) {
      return {
        allowed: false,
        status: 503,
        reason: "Service temporarily paused due to repeated broadcast failures. Please try again shortly.",
        headers: { "Retry-After": String(cb.retryAfter ?? CIRCUIT_BREAKER_COOLDOWN_SECONDS) },
      };
    }

    const redis = getRedis();

    // --- Redis path (production) ---
    if (redis && _ipMinuteRl && _ipDailyRl && _globalRl) {
      // 2. Per-IP per-minute
      const ipMinResult = await _ipMinuteRl.limit(hashedIp);
      if (!ipMinResult.success) {
        return {
          allowed: false,
          status: 429,
          reason: "Too many requests. Please wait before posting again.",
          headers: {
            "X-RateLimit-Limit": String(ipMinResult.limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Window": "minute",
            "Retry-After": String(Math.ceil((ipMinResult.reset - Date.now()) / 1000)),
          },
        };
      }

      // 3. Per-IP per-day
      const ipDayResult = await _ipDailyRl.limit(hashedIp);
      if (!ipDayResult.success) {
        return {
          allowed: false,
          status: 429,
          reason: "Daily comment limit reached. Please try again tomorrow.",
          headers: {
            "X-RateLimit-Limit": String(ipDayResult.limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Window": "day",
            "Retry-After": "3600",
          },
        };
      }

      // 4. Global per-hour
      const globalResult = await _globalRl.limit("global");
      if (!globalResult.success) {
        return {
          allowed: false,
          status: 429,
          reason: "Global comment rate limit reached. Please try again later.",
          headers: {
            "X-RateLimit-Limit": String(globalResult.limit),
            "X-RateLimit-Remaining": "0",
            "Retry-After": "60",
          },
        };
      }

      // 5. Daily spend cap
      const spent = await getDailySpend();
      if (spent >= DAILY_SPEND_CAP_SATS) {
        return {
          allowed: false,
          status: 503,
          reason: "Daily on-chain spend cap reached. New comments are paused until midnight UTC.",
          headers: {},
        };
      }

      return {
        allowed: true,
        headers: {
          "X-RateLimit-Limit": String(ipMinResult.limit),
          "X-RateLimit-Remaining": String(ipMinResult.remaining),
          "X-RateLimit-Reset": String(ipMinResult.reset),
        },
      };
    }

    // --- In-memory fallback (dev only) ---
    const now = Date.now();

    // Per-IP per-minute
    if (!_memIpRequests.has(hashedIp)) _memIpRequests.set(hashedIp, []);
    const ipTimestamps = _memIpRequests.get(hashedIp)!;
    const minuteCount = memSlidingWindowCount(ipTimestamps, RATE_LIMIT_WINDOW_SECONDS * 1000, now);
    if (minuteCount >= RATE_LIMIT_MAX) {
      return {
        allowed: false,
        status: 429,
        reason: "Too many requests. Please wait before posting again.",
        headers: {
          "X-RateLimit-Limit": String(RATE_LIMIT_MAX),
          "X-RateLimit-Remaining": "0",
          "Retry-After": String(RATE_LIMIT_WINDOW_SECONDS),
        },
      };
    }

    // Per-IP per-day
    const dayCount = memSlidingWindowCount([...ipTimestamps], 86400_000, now);
    if (dayCount >= RATE_LIMIT_DAILY_MAX) {
      return {
        allowed: false,
        status: 429,
        reason: "Daily comment limit reached. Please try again tomorrow.",
        headers: {
          "X-RateLimit-Limit": String(RATE_LIMIT_DAILY_MAX),
          "X-RateLimit-Remaining": "0",
          "Retry-After": "3600",
        },
      };
    }

    // Global per-hour
    const globalCount = memSlidingWindowCount(_memGlobalRequests, GLOBAL_RATE_LIMIT_WINDOW * 1000, now);
    if (globalCount >= GLOBAL_RATE_LIMIT_MAX) {
      return {
        allowed: false,
        status: 429,
        reason: "Global comment rate limit reached. Please try again later.",
        headers: {
          "X-RateLimit-Limit": String(GLOBAL_RATE_LIMIT_MAX),
          "X-RateLimit-Remaining": "0",
          "Retry-After": "60",
        },
      };
    }

    // Daily spend cap
    const spent = await getDailySpend();
    if (spent >= DAILY_SPEND_CAP_SATS) {
      return {
        allowed: false,
        status: 503,
        reason: "Daily on-chain spend cap reached. New comments are paused until midnight UTC.",
        headers: {},
      };
    }

    // All checks passed — record the request
    ipTimestamps.push(now);
    _memGlobalRequests.push(now);

    return {
      allowed: true,
      headers: {
        "X-RateLimit-Limit": String(RATE_LIMIT_MAX),
        "X-RateLimit-Remaining": String(Math.max(0, RATE_LIMIT_MAX - minuteCount - 1)),
        "X-RateLimit-Reset": String(now + RATE_LIMIT_WINDOW_SECONDS * 1000),
      },
    };
  } catch (err) {
    console.error("[rate-limiter] Error — failing closed:", err);
    return {
      allowed: false,
      status: 503,
      reason: "Rate limiting service unavailable. Please try again shortly.",
      headers: {},
    };
  }
}
