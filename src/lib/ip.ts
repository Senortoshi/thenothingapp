/**
 * src/lib/ip.ts
 *
 * Shared IP extraction and hashing utilities.
 * Single source of truth — imported by all routes that need client IP.
 *
 * IP Extraction (Vercel-specific)
 * -----------------------------------------------------------------------
 * On Vercel, `x-real-ip` is always set by the edge network and is the
 * trusted client IP. The `x-forwarded-for` fallback uses the FIRST entry
 * (the original client per RFC 7239), not the last.
 *
 * IP Hashing (REM-06)
 * -----------------------------------------------------------------------
 * Raw IPs are never stored or used as keys. Each IP is HMAC-hashed with
 * a site-specific salt to prevent rainbow-table attacks.
 */

import { createHmac } from "crypto";
import type { NextRequest } from "next/server";

/**
 * Extract the client IP from a Next.js request.
 *
 * Priority:
 *   1. `x-real-ip` — set by Vercel's edge network (most reliable)
 *   2. `x-forwarded-for` first entry — original client per RFC 7239
 *   3. "unknown" — fail-safe fallback (shares a single rate-limit bucket)
 */
export function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ||
    "unknown"
  );
}

/**
 * Hash an IP address so raw IPs never appear in Redis keys or logs.
 * Uses a site-specific salt to prevent rainbow-table attacks.
 *
 * In production, RATE_LIMIT_SALT must be set — throws if missing.
 * In development, uses a weak fallback so local runs work without config.
 */
export function hashIp(ip: string): string {
  const salt =
    process.env.RATE_LIMIT_SALT ??
    (process.env.NODE_ENV === "development"
      ? "dev-salt-not-for-production"
      : (() => {
          throw new Error(
            "[ip] RATE_LIMIT_SALT is not set in production. " +
              "Set it to a random 32-byte hex string. Failing closed."
          );
        })());

  return createHmac("sha256", salt)
    .update(ip)
    .digest("hex")
    .slice(0, 16);
}
