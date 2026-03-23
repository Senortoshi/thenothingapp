/**
 * Unit tests for src/lib/errors.ts
 *
 * Covers:
 *   - safeErrorMessage in production mode
 *   - safeErrorMessage in development mode
 *   - Custom fallback override
 *
 * The module reads NODE_ENV at import time via the module-level IS_PRODUCTION
 * constant, so we must use vi.resetModules() + dynamic import to re-evaluate
 * the module for each environment scenario.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("safeErrorMessage — production mode", () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it("returns the default fallback for an Error instance", async () => {
    const { safeErrorMessage } = await import("@/lib/errors");
    const result = safeErrorMessage(new Error("sensitive DB error"));
    expect(result).toBe("Internal server error");
  });

  it("returns the default fallback for a plain string error", async () => {
    const { safeErrorMessage } = await import("@/lib/errors");
    expect(safeErrorMessage("some raw string error")).toBe(
      "Internal server error"
    );
  });

  it("returns the default fallback for a non-Error object", async () => {
    const { safeErrorMessage } = await import("@/lib/errors");
    expect(safeErrorMessage({ code: 500 })).toBe("Internal server error");
  });

  it("returns the default fallback for null", async () => {
    const { safeErrorMessage } = await import("@/lib/errors");
    expect(safeErrorMessage(null)).toBe("Internal server error");
  });

  it("returns the default fallback for undefined", async () => {
    const { safeErrorMessage } = await import("@/lib/errors");
    expect(safeErrorMessage(undefined)).toBe("Internal server error");
  });

  it("returns a custom fallback when one is provided", async () => {
    const { safeErrorMessage } = await import("@/lib/errors");
    const result = safeErrorMessage(new Error("leak!"), "Something went wrong");
    expect(result).toBe("Something went wrong");
  });

  it("never leaks the actual error message even for Error instances", async () => {
    const { safeErrorMessage } = await import("@/lib/errors");
    const result = safeErrorMessage(new Error("top secret info"));
    expect(result).not.toContain("top secret info");
  });
});

describe("safeErrorMessage — development mode", () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
    process.env.NODE_ENV = "development";
  });

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it("returns err.message for an Error instance", async () => {
    const { safeErrorMessage } = await import("@/lib/errors");
    const result = safeErrorMessage(new Error("connection refused"));
    expect(result).toBe("connection refused");
  });

  it("returns String(err) for a plain string", async () => {
    const { safeErrorMessage } = await import("@/lib/errors");
    expect(safeErrorMessage("raw string")).toBe("raw string");
  });

  it("returns String(err) for a number", async () => {
    const { safeErrorMessage } = await import("@/lib/errors");
    expect(safeErrorMessage(42)).toBe("42");
  });

  it("returns String(err) for a plain object (non-Error)", async () => {
    const { safeErrorMessage } = await import("@/lib/errors");
    expect(safeErrorMessage({ code: 42 })).toBe("[object Object]");
  });

  it("returns String(null) for null", async () => {
    const { safeErrorMessage } = await import("@/lib/errors");
    expect(safeErrorMessage(null)).toBe("null");
  });

  it("returns String(undefined) for undefined", async () => {
    const { safeErrorMessage } = await import("@/lib/errors");
    expect(safeErrorMessage(undefined)).toBe("undefined");
  });

  it("custom fallback is ignored in development — actual message is used instead", async () => {
    const { safeErrorMessage } = await import("@/lib/errors");
    const result = safeErrorMessage(new Error("real dev error"), "Override");
    // In dev the real message wins; the fallback is only for production
    expect(result).toBe("real dev error");
  });
});
