/**
 * Tests — in-memory rate limiter
 *
 * Tests checkRateLimit, recordBroadcastSuccess/Failure, recordSpend.
 * No Redis mocks needed — everything is in-memory.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock hashIp to return predictable values
vi.mock("@/lib/ip", () => ({
  hashIp: vi.fn((ip: string) => `hash_${ip}`),
}));

// Import after mocks
import {
  checkRateLimit,
  recordBroadcastSuccess,
  recordBroadcastFailure,
  recordSpend,
} from "@/lib/rate-limiter";

// ---------------------------------------------------------------------------
// Setup — reset module between tests to clear in-memory state
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetModules();
  // Set required env vars
  process.env.RATE_LIMIT_SALT = "test-salt-32-bytes-xxxxxxxxxx12345";
  process.env.NODE_ENV = "test";
});

// ---------------------------------------------------------------------------
// Basic allow/deny
// ---------------------------------------------------------------------------

describe("checkRateLimit — basic", () => {
  it("allows the first request", async () => {
    const { checkRateLimit: check } = await import("@/lib/rate-limiter");
    const result = await check("192.168.1.1");
    expect(result.allowed).toBe(true);
  });

  it("returns rate limit headers on success", async () => {
    const { checkRateLimit: check } = await import("@/lib/rate-limiter");
    const result = await check("192.168.1.1");
    expect(result.headers).toHaveProperty("X-RateLimit-Limit");
  });

  it("rejects after exceeding per-minute limit (5 requests)", async () => {
    const { checkRateLimit: check } = await import("@/lib/rate-limiter");
    const ip = "10.0.0.1";

    // Make 5 requests (all allowed)
    for (let i = 0; i < 5; i++) {
      const r = await check(ip);
      expect(r.allowed).toBe(true);
    }

    // 6th request should be rejected
    const result = await check(ip);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.status).toBe(429);
      expect(result.reason).toMatch(/too many/i);
    }
  });

  it("allows requests from different IPs independently", async () => {
    const { checkRateLimit: check } = await import("@/lib/rate-limiter");

    const r1 = await check("10.0.0.1");
    const r2 = await check("10.0.0.2");

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

describe("checkRateLimit — circuit breaker", () => {
  it("trips after 10 consecutive broadcast failures", async () => {
    const mod = await import("@/lib/rate-limiter");

    // Record 10 failures
    for (let i = 0; i < 10; i++) {
      await mod.recordBroadcastFailure();
    }

    const result = await mod.checkRateLimit("192.168.1.1");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.status).toBe(503);
      expect(result.headers).toHaveProperty("Retry-After");
    }
  });

  it("resets the breaker on a successful broadcast", async () => {
    const mod = await import("@/lib/rate-limiter");

    // Record 9 failures (not enough to trip)
    for (let i = 0; i < 9; i++) {
      await mod.recordBroadcastFailure();
    }

    // One success resets
    await mod.recordBroadcastSuccess();

    const result = await mod.checkRateLimit("192.168.1.1");
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Daily spend cap
// ---------------------------------------------------------------------------

describe("checkRateLimit — daily spend cap", () => {
  it("rejects when daily spend cap is reached", async () => {
    const mod = await import("@/lib/rate-limiter");

    // Record 50000 sats of spending (the default cap)
    await mod.recordSpend(50000);

    const result = await mod.checkRateLimit("192.168.1.1");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.status).toBe(503);
      expect(result.reason).toMatch(/spend cap/i);
    }
  });

  it("allows when spend is below cap", async () => {
    const mod = await import("@/lib/rate-limiter");

    await mod.recordSpend(100);

    const result = await mod.checkRateLimit("192.168.1.1");
    expect(result.allowed).toBe(true);
  });
});
