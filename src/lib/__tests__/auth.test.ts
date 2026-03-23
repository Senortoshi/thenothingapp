/**
 * Unit tests for src/lib/auth.ts
 *
 * Covers:
 *   - timingSafeCompare: constant-time string equality
 *   - requireAdmin: admin API key guard
 *   - verifyCronSecret: cron secret guard
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) {
    headers["authorization"] = authHeader;
  }
  return new NextRequest("http://localhost/api/test", { headers });
}

// ---------------------------------------------------------------------------
// timingSafeCompare
// ---------------------------------------------------------------------------

describe("timingSafeCompare", () => {
  // Import after each env mutation to pick up fresh module state where needed.
  // For this pure function, a single import is fine.
  it("returns true for two identical strings", async () => {
    const { timingSafeCompare } = await import("@/lib/auth");
    expect(timingSafeCompare("secret", "secret")).toBe(true);
  });

  it("returns false when strings differ in content but share length", async () => {
    const { timingSafeCompare } = await import("@/lib/auth");
    expect(timingSafeCompare("aaaaaa", "aaaaab")).toBe(false);
  });

  it("returns false when strings have different lengths", async () => {
    const { timingSafeCompare } = await import("@/lib/auth");
    expect(timingSafeCompare("short", "longer")).toBe(false);
  });

  it("returns true for two empty strings", async () => {
    const { timingSafeCompare } = await import("@/lib/auth");
    expect(timingSafeCompare("", "")).toBe(true);
  });

  it("returns false when one string is empty and the other is not", async () => {
    const { timingSafeCompare } = await import("@/lib/auth");
    expect(timingSafeCompare("", "x")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// requireAdmin
// ---------------------------------------------------------------------------

describe("requireAdmin", () => {
  const ORIGINAL_ADMIN_KEY = process.env.ADMIN_API_KEY;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original env state
    if (ORIGINAL_ADMIN_KEY === undefined) {
      delete process.env.ADMIN_API_KEY;
    } else {
      process.env.ADMIN_API_KEY = ORIGINAL_ADMIN_KEY;
    }
  });

  it("returns 503 when ADMIN_API_KEY is not set", async () => {
    delete process.env.ADMIN_API_KEY;
    const { requireAdmin } = await import("@/lib/auth");

    const req = makeRequest("Bearer anything");
    const res = requireAdmin(req);

    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
    const body = await res!.json();
    expect(body.error).toMatch(/not configured/i);
  });

  it("returns 401 when authorization header is missing", async () => {
    process.env.ADMIN_API_KEY = "my-secret-key";
    const { requireAdmin } = await import("@/lib/auth");

    const res = requireAdmin(makeRequest());

    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    const body = await res!.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  it("returns 401 when the bearer token is wrong", async () => {
    process.env.ADMIN_API_KEY = "correct-key";
    const { requireAdmin } = await import("@/lib/auth");

    const res = requireAdmin(makeRequest("Bearer wrong-key-x"));

    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("returns 401 when the header is present but has no Bearer prefix", async () => {
    process.env.ADMIN_API_KEY = "correct-key";
    const { requireAdmin } = await import("@/lib/auth");

    const res = requireAdmin(makeRequest("correct-key"));

    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("returns null (authorised) when the correct token is supplied", async () => {
    process.env.ADMIN_API_KEY = "correct-key";
    const { requireAdmin } = await import("@/lib/auth");

    const res = requireAdmin(makeRequest("Bearer correct-key"));

    expect(res).toBeNull();
  });

  it("trims trailing whitespace from the bearer token before comparing", async () => {
    process.env.ADMIN_API_KEY = "trimmed-key";
    const { requireAdmin } = await import("@/lib/auth");

    // The implementation calls .trim() on the extracted token
    const res = requireAdmin(makeRequest("Bearer trimmed-key  "));

    expect(res).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// verifyCronSecret
// ---------------------------------------------------------------------------

describe("verifyCronSecret", () => {
  const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL_CRON_SECRET === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
    }
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it("returns true when the correct token is supplied", async () => {
    process.env.CRON_SECRET = "cron-secret";
    const { verifyCronSecret } = await import("@/lib/auth");

    expect(verifyCronSecret(makeRequest("Bearer cron-secret"))).toBe(true);
  });

  it("returns false when the token is wrong", async () => {
    process.env.CRON_SECRET = "cron-secret";
    const { verifyCronSecret } = await import("@/lib/auth");

    expect(verifyCronSecret(makeRequest("Bearer wrong"))).toBe(false);
  });

  it("returns false when no authorization header is sent but secret is set", async () => {
    process.env.CRON_SECRET = "cron-secret";
    const { verifyCronSecret } = await import("@/lib/auth");

    expect(verifyCronSecret(makeRequest())).toBe(false);
  });

  it("returns true when CRON_SECRET is not set and NODE_ENV is development", async () => {
    delete process.env.CRON_SECRET;
    process.env.NODE_ENV = "development";
    const { verifyCronSecret } = await import("@/lib/auth");

    // No secret configured in dev — all requests pass
    expect(verifyCronSecret(makeRequest())).toBe(true);
  });

  it("returns false when CRON_SECRET is not set and NODE_ENV is production", async () => {
    delete process.env.CRON_SECRET;
    process.env.NODE_ENV = "production";
    const { verifyCronSecret } = await import("@/lib/auth");

    expect(verifyCronSecret(makeRequest("Bearer anything"))).toBe(false);
  });

  it("returns false when CRON_SECRET is not set and NODE_ENV is test", async () => {
    delete process.env.CRON_SECRET;
    process.env.NODE_ENV = "test";
    const { verifyCronSecret } = await import("@/lib/auth");

    expect(verifyCronSecret(makeRequest("Bearer anything"))).toBe(false);
  });
});
