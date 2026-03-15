/**
 * Shared authentication utilities.
 *
 * Centralises the timing-safe secret comparison, admin key guard, and cron
 * secret guard so every route uses an identical, audited implementation.
 *
 * Why timingSafeEqual?
 * String equality (===) short-circuits on the first mismatched character,
 * leaking information about how many characters match via response-time
 * differences.  timingSafeEqual always runs in constant time regardless of
 * where the mismatch occurs, closing that side channel.
 */

import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Primitive: constant-time string comparison
// ---------------------------------------------------------------------------

/**
 * Compare two strings in constant time.
 *
 * Returns false immediately (without leaking length) only when the lengths
 * differ — callers should ensure secrets are always the same length or pad
 * them before comparing.  For our use-case (comparing a user-supplied token
 * against a fixed env-var secret) this is the standard safe approach.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ---------------------------------------------------------------------------
// Admin API guard
// ---------------------------------------------------------------------------

/**
 * requireAdmin — validate the "Authorization: Bearer <ADMIN_API_KEY>" header.
 *
 * Returns null when the request is authorised, or a NextResponse with the
 * appropriate error status when it is not.
 *
 * Usage:
 *   const authError = requireAdmin(req);
 *   if (authError) return authError;
 */
export function requireAdmin(req: NextRequest): NextResponse | null {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    return NextResponse.json(
      { error: "Admin API is not configured (ADMIN_API_KEY not set)." },
      { status: 503 }
    );
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!token || !timingSafeCompare(token, adminKey)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return null; // authorised
}

// ---------------------------------------------------------------------------
// Cron secret guard
// ---------------------------------------------------------------------------

/**
 * verifyCronSecret — validate the "Authorization: Bearer <CRON_SECRET>" header.
 *
 * Returns true when the request is authorised.
 *
 * If CRON_SECRET is not set the function falls back to allowing requests only
 * in the development environment (consistent with prior behaviour).
 *
 * Usage:
 *   if (!verifyCronSecret(req)) {
 *     return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 *   }
 */
export function verifyCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret configured — only allow in development
    return process.env.NODE_ENV === "development";
  }
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return token.length > 0 && timingSafeCompare(token, secret);
}
