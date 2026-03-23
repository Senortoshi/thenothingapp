/**
 * src/lib/redis.ts
 *
 * Shared Upstash Redis client — singleton per serverless invocation.
 * All modules that need Redis import from here.
 *
 * In development without Redis env vars, returns null (callers must handle).
 * In production, missing env vars cause a hard error at startup.
 */

import { Redis } from "@upstash/redis";

let _redis: Redis | null = null;
let _initialized = false;

/**
 * Returns the shared Upstash Redis client.
 * Returns null if Redis is not configured (dev-only — production throws).
 */
export function getRedis(): Redis | null {
  if (_initialized) return _redis;
  _initialized = true;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production"
      );
    }
    console.warn("[redis] Upstash Redis not configured — using in-memory fallback (dev only)");
    return null;
  }

  _redis = new Redis({ url, token });
  return _redis;
}

/**
 * Returns the Redis client or throws. Use in code paths that require Redis.
 */
export function requireRedis(): Redis {
  const redis = getRedis();
  if (!redis) {
    throw new Error("Redis is required but not configured");
  }
  return redis;
}
